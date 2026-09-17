/* ═══════════════════════════════════════════════════
   app.js  — Main entry point (Menu & Bootstrap)
   All window.* globals replaced with ES module imports
   and the shared state module.
═══════════════════════════════════════════════════ */

import { initTelegram, populateTelegramUser, tgHaptic, showScreen, initBackButton } from './modules/telegram.js';
import { initLoader, initParticles, initBetBar, initColorPicker, initCountdown, renderPlayerList, ripple, injectRippleStyle, PIECE_THEMES, getCurrentBalanceValue } from './modules/ui.js';
import { PlayerRegistry } from './modules/registry.js';
import { startGame, G, executeMove, endGame, requestRematch, handleIncomingRematchRequest, handleRematchAccepted, handleRematchDeclined } from './modules/engine.js';
import { Socket } from './modules/socket.js';
import { initErrorBoundary } from './modules/errorBoundary.js';
import { initConnectionMonitor } from './modules/connection.js';
import { initAutoLogout, resetIdle } from './modules/autoLogout.js';
import { initUrlAuth, updateBalanceDisplay, refreshBalance } from './modules/urlAuth.js';
import { setState, getState, syncFromWindow } from './modules/state.js';

/* ── 0. URL Auth gate — MUST run before anything else ── */
const urlAuth = await initUrlAuth();
// Sync any window.* set by urlAuth into our state store
syncFromWindow();

/* ── 1. Telegram init ── */
initTelegram();
initErrorBoundary();
initConnectionMonitor();
initAutoLogout();

/* Set defaults */
setState('pieceTheme', PIECE_THEMES[0]);

/* ── 2. Wire up cross-module references (no window.* needed) ── */
// engine.js reads these via imported references — exposed here for the
// few places inside engine.js that still reach back to app-level state.
// The bridge in state.js keeps window.* in sync for legacy/SDK code.
setState('refreshBalance', refreshBalance);   // engine endGame calls this

/**
 * sendStartBet — POST /api/games/start-bet synchronously.
 */
async function sendStartBet(gameId, betAmount, mode, player2Id = null) {
  const playerId = getState('tgUserId');
  const phone    = getState('damaPhone');
  const apiToken = getState('damaApiToken') || localStorage.getItem('dama_api_token') || '';
  const apiUrl   = Socket.apiUrl;

  if (!playerId || !phone || !apiUrl) return false;

  const loader = document.getElementById('betPlacingModal');
  if (loader) {
    loader.classList.remove('hidden');
    setTimeout(() => loader.classList.add('modal-show'), 10);
  }

  try {
    const res = await fetch(`${apiUrl}/games/start-bet`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Token': apiToken },
      body: JSON.stringify({ gameId, playerId, phone, betAmount, mode, player2Id }),
      signal: AbortSignal.timeout(8000),
    });

    const json = await res.json();
    const data = json?.data || json;
    const log  = data?.betLog;

    if (loader) {
      loader.classList.remove('modal-show');
      setTimeout(() => loader.classList.add('hidden'), 300);
    }

    if (res.ok && (data.skipped || log?.status === 'success')) {
      const toast = document.getElementById('betAcceptedToast');
      const msg   = document.getElementById('betAcceptedMsg');
      if (toast && msg) {
        msg.textContent = betAmount > 0 ? `Bet Accepted: ${betAmount.toLocaleString()} ETB!` : 'Match Started!';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
      }
      return true;
    } else {
      const reason = log?.error || data?.error || 'Unspecified integration error';
      alert(`Transaction Rejected!\nReason: ${reason}`);
      return false;
    }
  } catch (err) {
    if (loader) {
      loader.classList.remove('modal-show');
      setTimeout(() => loader.classList.add('hidden'), 300);
    }
    alert(`Transaction Failed!\nNetwork Error: ${err.message}`);
    return false;
  }
}

// Keep for reference — no-op now (silent preferred)
function showBetAuditModal(_betLog, _betAmount, _fetchError = null) {}

/* ── startGame (called by UI buttons and socket handlers) ── */
window.startGame = async function(mode, opponent) {
  const betAmount = Number(getState('currentBet') || 0);

  if (mode === 'ai' || (mode === 'pvp' && !getState('activeOnlineGame'))) {
    const me = PlayerRegistry.load().find(p => p.isMe);
    if (me && me.balance < betAmount) {
      alert(`Insufficient balance! You only have ${me.balance} ETB.`);
      return;
    }
  }

  const currentBalance = Number(window.DAMA_BALANCE ?? getState('damaBalance') ?? 0);
  if (betAmount > currentBalance) {
    alert('Insufficient balance for this bet.');
    return false;
  }

  if (betAmount > 0 && (mode === 'ai' || (mode === 'pvp' && !getState('activeOnlineGame')))) {
    const ts     = Date.now().toString(36).toUpperCase();
    const rand   = Math.random().toString(36).slice(2, 6).toUpperCase();
    const tempId = (mode === 'ai' ? 'AI' : 'LOC') + '-' + ts + '-' + rand;

    const betPlaced = await sendStartBet(tempId, betAmount, mode, opponent?.id || null);
    if (!betPlaced) return;
    setState('tempGameId', tempId);
    setState('tempBetAmt', betAmount);
  } else {
    setState('tempBetAmt', betAmount);
  }

  startGame(mode, opponent);
};

window.startGameVsPlayer = function(opponent) {
  if (opponent && opponent.id && !opponent.id.startsWith('demo_')) {
    const betAmount = Number(getState('currentBet') || 0);
    const me = PlayerRegistry.load().find(p => p.isMe);
    const currentBalance = Number(getCurrentBalanceValue() || me?.balance || 0);
    if (currentBalance < betAmount) {
      alert(`Insufficient balance! You only have ${currentBalance} ETB.`);
      return;
    }

    const waitingModal = document.getElementById('waitingModal');
    const waitingSub   = document.getElementById('waitingSub');
    if (waitingSub) waitingSub.textContent = `Challenging ${opponent.name} for ${betAmount} ETB...`;
    if (waitingModal) {
      waitingModal.classList.remove('hidden');
      setTimeout(() => waitingModal.classList.add('modal-show'), 10);
    }

    setState('activeChallenge', { opponentId: opponent.id, betAmount });
    Socket.send('challenge_send', {
      challengerId: getState('tgUserId'),
      opponentId:   opponent.id,
      betAmount,
    });
  } else {
    startGame('pvp', opponent);
    sendStartBet(G.gameId, 0, 'pvp', opponent?.id || null);
  }
};

/* ── 3. Loading screen → menu ── */
initLoader(() => {
  populateTelegramUser(() => {
    // Sync telegram identity into state store
    syncFromWindow();

    const saved      = localStorage.getItem('dama_piece_theme');
    const savedStyle = localStorage.getItem('dama_piece_style') || 'solid';
    const savedTheme = PIECE_THEMES.find(t => t.id === saved) || PIECE_THEMES[0];
    setState('pieceTheme',   savedTheme);
    setState('pieceThemeId', savedTheme.id);
    setState('pieceStyleId', savedStyle);

    PlayerRegistry.register({
      id:           getState('tgUserId'),
      name:         getState('tgUserName'),
      photo:        getState('tgUserPhoto'),
      isMe:         true,
      bet:          getState('currentBet') || 100,
      pieceThemeId: savedTheme.id,
    });

    PlayerRegistry.fetchCurrentPlayer(getState('tgUserId'));
    Socket.connect(getState('tgUserId'));

    setState('playerReady', false);
    setState('currentBet', 0);
    PlayerRegistry.clearReadyOnBackend(getState('tgUserId')).catch(() => {});

    PlayerRegistry.fetchPlayers();
    setInterval(() => {
      PlayerRegistry.fetchPlayers();
      PlayerRegistry.fetchCurrentPlayer(getState('tgUserId'));
    }, 10000);

    setInterval(() => {
      if (getState('playerReady') && getState('currentBet') > 0) renderPlayerList();
    }, 8000);

    // ── Balance auto-refresh every 10s ──
    const _isOnMenu = () =>
      document.getElementById('gameScreen')?.classList.contains('hidden') !== false;

    setInterval(async () => {
      if (_isOnMenu()) await refreshBalance(true).catch(() => {});
    }, 10000);

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible' && _isOnMenu()) {
        await refreshBalance(true).catch(() => {});
      }
    });
    window.addEventListener('focus', async () => {
      if (_isOnMenu()) await refreshBalance(true).catch(() => {});
    });

    // ── Show initial balance ──
    const balEl = document.getElementById('myBalance');
    if (balEl) {
      const me  = PlayerRegistry.load().find(p => p.id === getState('tgUserId'));
      const bal = getCurrentBalanceValue() ?? me?.balance;
      balEl.textContent = bal === null || bal === undefined ? '—' : Number(bal).toLocaleString();
    }

    renderPlayerList();
  });

  initParticles();
  initCountdown();
  initBetBar();
  initColorPicker();
}, window.DAMA_AUTH_READY || Promise.resolve(true));

/* ── 4. Button wiring ── */
function initApp() {
  if (getState('appInitialized')) return;
  setState('appInitialized', true);
  injectRippleStyle();

  const playBtn = document.getElementById('playNowBtn');
  if (playBtn) {
    playBtn.addEventListener('click', (e) => {
      tgHaptic('light');
      ripple(playBtn, e);
      openAiModal();
    });
  }

  document.getElementById('aiModalCloseBtn')?.addEventListener('click', () => {
    const modal = document.getElementById('aiModal');
    if (modal) { modal.classList.remove('modal-show'); setTimeout(() => modal.classList.add('hidden'), 300); }
  });

  document.getElementById('balRefreshBtn')?.addEventListener('click', async () => {
    tgHaptic('light');
    await refreshBalance(false);
  });

  document.getElementById('howToPlayBtn')?.addEventListener('click', () => {
    tgHaptic('light');
    const modal = document.getElementById('howToPlayModal');
    if (modal) { modal.classList.remove('hidden'); setTimeout(() => modal.classList.add('modal-show'), 10); }
  });
  document.getElementById('howToPlayClose')?.addEventListener('click', () => {
    const modal = document.getElementById('howToPlayModal');
    if (modal) { modal.classList.remove('modal-show'); setTimeout(() => modal.classList.add('hidden'), 300); }
  });
  document.getElementById('howToPlayModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'howToPlayModal') {
      const modal = document.getElementById('howToPlayModal');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  document.getElementById('historyBtn')?.addEventListener('click', () => {
    tgHaptic('light');
    const modal = document.getElementById('historyModal');
    if (modal) { modal.classList.remove('hidden'); setTimeout(() => modal.classList.add('modal-show'), 10); }
    loadHistory();
  });
  document.getElementById('historyClose')?.addEventListener('click', () => {
    const modal = document.getElementById('historyModal');
    if (modal) { modal.classList.remove('modal-show'); setTimeout(() => modal.classList.add('hidden'), 300); }
  });
  document.getElementById('historyModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'historyModal') {
      const modal = document.getElementById('historyModal');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  document.getElementById('aiModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'aiModal') {
      const modal = document.getElementById('aiModal');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
    }
  });

  document.getElementById('challengeAcceptBtn')?.addEventListener('click', () => {
    const invite = getState('incomingChallenge');
    if (invite) {
      Socket.send('challenge_accept', {
        challengerId: invite.challenger.id,
        opponentId:   getState('tgUserId'),
        betAmount:    invite.betAmount,
      });
    }
    document.getElementById('challengeModal')?.classList.add('hidden');
    document.getElementById('challengeModal')?.classList.remove('modal-show');
  });

  document.getElementById('challengeDeclineBtn')?.addEventListener('click', () => {
    const invite = getState('incomingChallenge');
    if (invite) {
      Socket.send('challenge_decline', {
        challengerId: invite.challenger.id,
        opponentId:   getState('tgUserId'),
      });
    }
    document.getElementById('challengeModal')?.classList.add('hidden');
    document.getElementById('challengeModal')?.classList.remove('modal-show');
    setState('incomingChallenge', null);
  });

  document.getElementById('waitingCancelBtn')?.addEventListener('click', () => {
    const challenge = getState('activeChallenge');
    if (challenge) {
      Socket.send('challenge_decline', {
        challengerId: getState('tgUserId'),
        opponentId:   challenge.opponentId,
      });
    }
    document.getElementById('waitingModal')?.classList.add('hidden');
    document.getElementById('waitingModal')?.classList.remove('modal-show');
    setState('activeChallenge', null);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/* ── 5. Sync piece theme to registry ── */
window.onPieceThemeChanged = function(theme) {
  const uid = getState('tgUserId');
  if (!uid) return;
  const list = PlayerRegistry.load();
  const me   = list.find(p => p.id === uid);
  if (me) { me.pieceThemeId = theme.id; PlayerRegistry.save(list); }
};

/* ── 6. Telegram hardware back button ── */
initBackButton(() => {
  const aog = getState('activeOnlineGame');
  if (!G.gameOver && G.mode === 'pvp' && G.isOnlinePvP && G.gameId) {
    Socket.send('resign', { gameId: G.gameId, playerId: getState('tgUserId') });
    endGame(G.myColor === 'black' ? 2 : 1, 'You quit the game', true);
  }
  if (G.timerInterval) clearInterval(G.timerInterval);
  showScreen('mainMenu');
});

/* ── 7. WebSocket event handlers ── */
window.Socket = Socket;   // kept for Telegram SDK / inline onclick fallback only

Socket.on('challenge_receive', (msg) => {
  const modal  = document.getElementById('challengeModal');
  const title  = document.getElementById('challengeTitle');
  const sub    = document.getElementById('challengeSub');
  const betVal = document.getElementById('challengeBet');

  if (title)  title.textContent  = `Match Challenge!`;
  if (sub)    sub.textContent    = `${msg.challenger.name} challenges you to a game.`;
  if (betVal) betVal.textContent = msg.betAmount;

  setState('incomingChallenge', msg);
  if (modal) { modal.classList.remove('hidden'); setTimeout(() => modal.classList.add('modal-show'), 10); }
});

Socket.on('challenge_declined', () => {
  const modal = document.getElementById('waitingModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('modal-show'); }
  setState('activeChallenge', null);
  alert('Opponent declined your challenge.');
});

Socket.on('game_start', (msg) => {
  document.getElementById('challengeModal')?.classList.add('hidden');
  document.getElementById('challengeModal')?.classList.remove('modal-show');
  document.getElementById('waitingModal')?.classList.add('hidden');
  document.getElementById('waitingModal')?.classList.remove('modal-show');

  setState('playerReady', false);
  if (getState('tgUserId')) PlayerRegistry.clearReadyOnBackend(getState('tgUserId')).catch(() => {});

  setState('activeOnlineGame', {
    gameId:    msg.gameId,
    myColor:   msg.myColor,
    turn:      msg.turn,
    betAmount: msg.betAmount,
    history:   msg.history || [],
  });

  startGame('pvp', msg.opponent);
});

Socket.on('move_made', (msg) => {
  executeMove(msg.from, msg.move, true);
});

Socket.on('game_over', (msg) => {
  const aog = getState('activeOnlineGame');
  let winnerColor = null;
  if (msg.winnerId) {
    if (msg.winnerId === getState('tgUserId')) {
      winnerColor = aog.myColor === 'black' ? 1 : 2;
    } else {
      winnerColor = aog.myColor === 'black' ? 2 : 1;
    }
  }
  endGame(winnerColor, msg.reason, true, msg.settlement || null);
  setTimeout(() => refreshBalance(true), 800);
});

Socket.on('rematch_request', (msg) => {
  handleIncomingRematchRequest(msg);
});

Socket.on('rematch_accepted', (msg) => {
  handleRematchAccepted(msg);
});

Socket.on('rematch_declined', (msg) => {
  handleRematchDeclined(msg);
});

Socket.on('player_updated', (msg) => {
  if (msg.player) {
    const list = PlayerRegistry.load();
    const idx  = list.findIndex(p => p.id === msg.player.id);
    if (idx !== -1) {
      list[idx] = {
        ...list[idx],
        balance:  msg.player.balance,
        wins:     msg.player.wins,
        losses:   msg.player.losses,
        draws:    msg.player.draws,
        online:   msg.player.online === 1,
        isReady:  msg.player.is_ready === 1,
        readyBet: msg.player.ready_bet || 0,
        lastSeen: (msg.player.last_seen || 0) * 1000,
      };
      PlayerRegistry.save(list);
    }
    if (msg.player.id === getState('tgUserId')) refreshBalance();
  }
  if (getState('playerReady') && getState('currentBet') > 0) renderPlayerList();
});

Socket.on('opponent_left', () => {
  const statusBar = document.getElementById('gameStatus');
  if (statusBar) statusBar.innerHTML = `<span style="color:var(--accent);">⚠️ Opponent disconnected! Reconnecting...</span>`;
});

Socket.on('opponent_rejoined', () => {
  const statusBar = document.getElementById('gameStatus');
  if (statusBar) statusBar.innerHTML = `<span style="color:var(--success);">✓ Opponent reconnected!</span>`;
});

Socket.on('kicked', (msg) => {
  const modal    = document.getElementById('kickedModal');
  const reasonEl = document.getElementById('kickedReason');
  if (reasonEl) reasonEl.textContent = msg.reason || 'You have been logged in on another device or tab.';
  if (modal) { modal.classList.remove('hidden'); setTimeout(() => modal.classList.add('modal-show'), 10); }
});

/* ── 8. AI bot modal ── */
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function fetchBotsFromDB() {
  const apiToken = getState('damaApiToken') || localStorage.getItem('dama_api_token') || '';
  const res = await fetch(`${Socket.apiUrl}/ai/bots/public`, {
    headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-API-Token': apiToken } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
}

function openAiModal() {
  const modal     = document.getElementById('aiModal');
  const container = document.getElementById('aiBotList');
  if (!modal || !container) return;

  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('modal-show'), 10);
  container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading bots…</div>`;

  fetchBotsFromDB()
    .then(bots => renderBotsList(bots, container, modal))
    .catch(() => {
      container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--red);">Failed to load bots. Please try again.</div>`;
    });
}

function pctToTier(pct) {
  if (pct <= 20) return { label: 'Very Easy', cls: 'bot-diff-veryeasy', color: '#4cde80' };
  if (pct <= 40) return { label: 'Easy',      cls: 'bot-diff-easy',     color: '#7ded9a' };
  if (pct <= 60) return { label: 'Normal',    cls: 'bot-diff-medium',   color: '#f0c94a' };
  if (pct <= 80) return { label: 'Hard',      cls: 'bot-diff-hard',     color: '#f39c12' };
  return               { label: 'Very Hard',  cls: 'bot-diff-veryhard', color: '#e74c3c' };
}

function renderBotsList(bots, container, modal) {
  container.innerHTML = '';
  if (!bots || bots.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">No AI bots found.</div>`;
    return;
  }
  const sorted = [...bots].sort((a, b) => (a.pct ?? 50) - (b.pct ?? 50));
  sorted.forEach(bot => {
    const pct  = bot.pct ?? 50;
    const tier = pctToTier(pct);
    const row  = document.createElement('div');
    row.className = 'bot-select-row';
    row.innerHTML = `
      <div class="bot-select-avatar">🤖</div>
      <div class="bot-select-info">
        <div class="bot-select-name">${escHtml(bot.name)}</div>
        <div class="bot-select-meta">
          <span class="bot-diff-badge ${tier.cls}">${tier.label}</span>
          <div class="bot-diff-bar-wrap">
            <div class="bot-diff-bar-track">
              <div class="bot-diff-bar-fill" style="width:${pct}%;background:${tier.color};"></div>
            </div>
            <span class="bot-diff-pct" style="color:${tier.color};">${pct}%</span>
          </div>
          <div class="bot-select-stats">
            <span style="color:#4cde80;">✔ ${bot.wins || 0}W</span>
            <span style="color:#e74c3c;margin-left:5px;">✖ ${bot.losses || 0}L</span>
          </div>
        </div>
      </div>
      <div class="bot-select-play">▶</div>`;
    row.addEventListener('click', () => {
      tgHaptic('medium');
      modal.classList.remove('modal-show');
      setTimeout(() => modal.classList.add('hidden'), 300);
      window.startGame('ai', { ...bot, aiPct: pct });
    });
    container.appendChild(row);
  });
}

/* ── 9. History loader ── */
async function loadHistory() {
  const body = document.getElementById('historyBody');
  if (!body) return;
  body.innerHTML = '<div class="hist-loading">Loading…</div>';

  try {
    const apiToken = getState('damaApiToken') || localStorage.getItem('dama_api_token') || '';
    const base     = Socket.apiUrl;
    const playerId = getState('tgUserId');
    if (!playerId) {
      body.innerHTML = '<div class="hist-empty"><div class="hist-empty-icon">📜</div>Log in to see your history.</div>';
      return;
    }

    const res = await fetch(`${base}/games?playerId=${encodeURIComponent(playerId)}&limit=50`, {
      headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-API-Token': apiToken } : {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json  = await res.json();
    const games = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);

    if (games.length === 0) {
      body.innerHTML = '<div class="hist-empty"><div class="hist-empty-icon">📜</div>No games played yet.</div>';
      return;
    }

    body.innerHTML = '';
    games.forEach(game => {
      const isPlayer1  = game.player1_id === playerId;
      const won        = game.winner_id  === playerId;
      const draw       = game.status === 'finished' && !game.winner_id;
      const result     = draw ? 'draw' : won ? 'win' : 'loss';
      const badge      = result === 'win' ? 'WIN' : result === 'loss' ? 'LOSS' : 'DRAW';
      const myName     = isPlayer1 ? (game.player1_name || game.player1_id) : (game.player2_name || game.player2_id);
      const oppName    = isPlayer1
        ? (game.player2_name || (game.mode === 'ai' ? '🤖 AI Bot' : game.player2_id || 'Unknown'))
        : (game.player1_name || game.player1_id || 'Unknown');
      const winnerName = game.winner_name || (draw ? null : (won ? myName : oppName));
      const shortId    = game.id ? game.id.slice(0, 8).toUpperCase() : '—';
      const fmtDate    = ts => ts
        ? new Date(ts * 1000).toLocaleString(undefined, { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
      const date       = fmtDate(game.finished_at || game.created_at);
      const duration   = game.duration_sec && game.duration_sec > 0
        ? `${Math.floor(game.duration_sec / 60)}m ${game.duration_sec % 60}s` : null;
      const betAmt     = game.bet_amount || 0;
      const betDisplay = betAmt > 0
        ? `${result==='win'?'+':result==='loss'?'−':'±'}${betAmt} ETB`
        : game.mode === 'ai' ? 'Practice' : 'No bet';
      const betClass   = result==='win' && betAmt>0 ? 'win-amount' : result==='loss' && betAmt>0 ? 'loss-amount' : '';

      const row = document.createElement('div');
      row.className = 'hist-item';
      row.innerHTML = `
        <div class="hist-result-badge ${result}">${badge}</div>
        <div class="hist-info">
          <div class="hist-matchup">
            <span class="hist-p1">${escHtml(isPlayer1 ? myName : oppName)}</span>
            <span class="hist-vs">vs</span>
            <span class="hist-p2">${escHtml(isPlayer1 ? oppName : myName)}</span>
          </div>
          <div class="hist-meta">
            <span class="hist-gameid" title="Game ID: ${escHtml(game.id||'')}">🎮 #${shortId}</span>
            <span>${date}</span>
            ${duration ? `<span>⏱ ${duration}</span>` : ''}
            ${game.move_count ? `<span>♟ ${game.move_count} moves</span>` : ''}
          </div>
          ${winnerName ? `<div class="hist-winner">👑 Winner: ${escHtml(winnerName)}</div>` : draw ? '<div class="hist-winner draw">🤝 Draw</div>' : ''}
        </div>
        <div class="hist-right">
          <div class="hist-mode">${game.mode==='ai'?'🤖 AI':'👥 PvP'}</div>
          <div class="hist-bet ${betClass}">${betDisplay}</div>
        </div>`;
      body.appendChild(row);
    });
  } catch (err) {
    body.innerHTML = `<div class="hist-empty"><div class="hist-empty-icon">⚠️</div>Failed to load history.</div>`;
    console.error('History load error:', err);
  }
}
