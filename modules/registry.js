import { apiUrl } from './socket.js';

const windowRef = typeof window !== 'undefined' ? window : globalThis;
const safeStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
  clear() {},
};
const localStorageRef = typeof windowRef.localStorage !== 'undefined' ? windowRef.localStorage : safeStorage;

const KEY = 'dama_players_v1';

export async function fetchWithToken(url, options = {}) {
  const authReady = windowRef.DAMA_AUTH_READY;
  if (authReady) {
    try {
      await authReady;
    } catch (err) {
      throw new Error(`Authentication failed before request: ${err?.message || err}`);
    }
  }

  const apiToken = windowRef.DAMA_API_TOKEN || localStorageRef.getItem('dama_api_token') || null;
  if (!apiToken) {
    throw new Error('Authentication token is not ready yet.');
  }

  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  headers['X-API-Token'] = apiToken;
  return fetch(url, { ...options, headers });
}

function load() {
  try { return JSON.parse(localStorageRef.getItem(KEY)) || []; }
  catch { return []; }
}

function save(list) {
  try { localStorageRef.setItem(KEY, JSON.stringify(list)); } catch {}
}

const THEME_IDS = ['classic','fire','ocean','forest','royal','gold'];

function randomThemeId() {
  return THEME_IDS[Math.floor(Math.random() * THEME_IDS.length)];
}

function register(player) {
  const list = load();
  list.forEach(p => { if (p.isMe && p.id !== player.id) p.isMe = false; });
  const idx = list.findIndex(p => p.id === player.id);

  const localPlayer = idx === -1 ? {
    id:           player.id,
    name:         player.name,
    photo:        player.photo || null,
    isMe:         !!player.isMe,
    online:       true,
    wins:         0,
    losses:       0,
    draws:        0,
    balance:      windowRef.DAMA_BALANCE ?? player.balance ?? 500,
    bet:          player.bet || 100,
    pieceThemeId: player.pieceThemeId || randomThemeId(),
    lastSeen:     Date.now(),
  } : {
    ...list[idx],
    name:         player.name,
    photo:        player.photo || list[idx].photo,
    isMe:         !!player.isMe,
    online:       true,
    lastSeen:     Date.now(),
    pieceThemeId: player.pieceThemeId || list[idx].pieceThemeId || randomThemeId(),
  };

  if (idx === -1) {
    list.push(localPlayer);
  } else {
    list[idx] = localPlayer;
  }
  save(list);

  // Sync asynchronously with backend API
  syncWithBackend(localPlayer);

  return list;
}

async function syncWithBackend(player) {
  try {
    const res = await fetchWithToken(`${apiUrl}/players`, {
      method: 'POST',
      body: JSON.stringify({
        id: player.id,
        name: player.name,
        photo: player.photo,
        phone: windowRef.DAMA_PHONE || null,
        bet: player.bet,
        pieceThemeId: player.pieceThemeId,
        isDemo: !!player.isDemo,
        isReady: !!player.isReady,
      })
    });
    if (res.ok) {
      const respObj = await res.json();
      const dbPlayer = respObj.data;

      const list = load();
      const idx = list.findIndex(p => p.id === player.id);
      if (idx !== -1) {
        list[idx] = {
          ...list[idx],
          // ── Never overwrite balance from Dama DB for the current user ──
          // The real balance comes from the owner backend via urlAuth.refreshBalance()
          balance: list[idx].isMe
            ? (windowRef.DAMA_BALANCE ?? list[idx].balance ?? dbPlayer.balance)
            : dbPlayer.balance,
          wins:       dbPlayer.wins,
          losses:     dbPlayer.losses,
          draws:      dbPlayer.draws,
          lastIp:     dbPlayer.last_ip,
          lastDevice: dbPlayer.last_device,
        };
        save(list);
        if (typeof windowRef.renderPlayerList === 'function') {
          windowRef.renderPlayerList();
        }
      }
    }
  } catch (err) {
    console.error('Failed to sync player registration with backend:', err);
  }
}

async function setReadyOnBackend(playerId, betAmount) {
  try {
    const res = await fetchWithToken(`${apiUrl}/players/${playerId}/ready`, {
      method: 'PATCH',
      body: JSON.stringify({ bet: betAmount }),
    });
    if (res.ok) {
      const respObj = await res.json();
      const dbPlayer = respObj.data;
      // Update local cache
      const list = load();
      const idx  = list.findIndex(p => p.id === playerId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], isReady: true, bet: betAmount, ready_bet: betAmount };
        save(list);
      }
      return dbPlayer;
    }
  } catch (err) {
    console.error('Failed to set ready on backend:', err);
  }
  return null;
}

async function clearReadyOnBackend(playerId) {
  try {
    const res = await fetchWithToken(`${apiUrl}/players/${playerId}/unready`, {
      method: 'PATCH',
    });
    if (res.ok) {
      const list = load();
      const idx  = list.findIndex(p => p.id === playerId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], isReady: false, ready_bet: 0 };
        save(list);
      }
    }
  } catch (err) {
    console.error('Failed to clear ready on backend:', err);
  }
}

async function fetchReadyPlayers(betAmount, excludeId) {
  try {
    const params = new URLSearchParams();
    if (betAmount) params.set('bet', betAmount);
    if (excludeId) params.set('excludeId', excludeId);
    const url = `${apiUrl}/players/ready${params.toString() ? '?' + params.toString() : ''}`;
    const res = await fetchWithToken(url);
    if (res.ok) {
      const respObj = await res.json();
      return respObj.data || [];
    }
  } catch (err) {
    console.error('Failed to fetch ready players:', err);
  }
  return [];
}

async function fetchPlayers() {
  try {
    const res = await fetchWithToken(`${apiUrl}/players`);
    if (res.ok) {
      const respObj = await res.json();
      const dbPlayers = respObj.data;

      // Update local storage caching, keeping 'isMe' flag intact
      const list = load();
      const me = list.find(p => p.isMe);
      const updatedList = dbPlayers.map(dp => {
        const local = list.find(p => p.id === dp.id);
        const isMe  = me ? me.id === dp.id : false;
        return {
          id:         dp.id,
          name:       dp.name,
          photo:      dp.photo,
          isMe,
          online:     dp.online === 1,
          wins:       dp.wins,
          losses:     dp.losses,
          draws:      dp.draws,
          // ── For current user: always use owner-backend balance, not Dama DB ──
          balance:    isMe
            ? (windowRef.DAMA_BALANCE ?? local?.balance ?? dp.balance)
            : dp.balance,
          bet:        dp.bet,
          pieceThemeId: dp.piece_theme,
          isReady:    dp.is_ready === 1,
          readyBet:   dp.ready_bet || 0,
          lastSeen:   dp.last_seen * 1000 || Date.now(),
          lastIp:     dp.last_ip,
          lastDevice: dp.last_device,
          isAi:       dp.is_ai === 1,
          difficulty: dp.difficulty || 'medium',
          aiDepth:    dp.is_ai === 1 ? (dp.ai_depth ?? 10) : undefined,
          aiPct:      dp.is_ai === 1 ? (dp.ai_pct   ?? 50) : undefined,
        };
      });

      // Keep local 'me' user if not in database yet
      if (me && !updatedList.find(p => p.id === me.id)) {
        updatedList.unshift(me);
      }

      save(updatedList);
      if (typeof window.renderPlayerList === 'function') {
        window.renderPlayerList();
      }
    }
  } catch (err) {
    console.error('Failed to fetch players from backend:', err);
  }
}

function recordResult(playerId, result) {
  const list = load();
  const p = list.find(p => p.id === playerId);
  if (!p) return;
  if (result === 'win')        p.wins++;
  else if (result === 'loss')  p.losses++;
  else if (result === 'draw')  p.draws++;
  p.lastSeen = Date.now();
  save(list);
}

function getAll()    { return load(); }
function getOthers() { return load().filter(p => p.id !== window.tgUserId); }

async function fetchCurrentPlayer(playerId) {
  if (!playerId) return null;
  try {
    const res = await fetchWithToken(`${apiUrl}/players/${playerId}`);
    if (res.ok) {
      const respObj = await res.json();
      const dbPlayer = respObj.data;
      if (dbPlayer) {
        const list = load();
        const idx = list.findIndex(p => p.id === playerId);
        if (idx !== -1) {
          list[idx] = {
            ...list[idx],
            wins:       dbPlayer.wins,
            losses:     dbPlayer.losses,
            draws:      dbPlayer.draws,
            balance:    list[idx].isMe
              ? (window.DAMA_BALANCE ?? list[idx].balance ?? dbPlayer.balance)
              : dbPlayer.balance,
            lastIp:     dbPlayer.last_ip,
            lastDevice: dbPlayer.last_device,
          };
          save(list);
          if (typeof window.renderPlayerList === 'function') {
            window.renderPlayerList();
          }
        }
      }
      return dbPlayer;
    }
  } catch (err) {
    console.error('Failed to fetch current player details:', err);
  }
  return null;
}

export const PlayerRegistry = { register, recordResult, getAll, getOthers, load, save, fetchPlayers, fetchCurrentPlayer, setReadyOnBackend, clearReadyOnBackend, fetchReadyPlayers };

export function seedDemoPlayers() {
  // Let the backend seed players since the backend has the actual persistent state
  // We fetch players from the server which returns demo + active players
  fetchPlayers();
}
