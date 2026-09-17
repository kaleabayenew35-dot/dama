let socket = null;
const listeners = {};
let reconnectTimer = null;
let pingInterval = null;
let _kicked = false;
let _playerId = null;
const _sendQueue = [];   // messages queued while socket is not yet open

import { BACKEND_URL } from '../config.js';

const windowRef = typeof window !== 'undefined' ? window : globalThis;
const safeStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
  clear() {},
};
const localStorageRef = typeof windowRef.localStorage !== 'undefined' ? windowRef.localStorage : safeStorage;
const sessionStorageRef = typeof windowRef.sessionStorage !== 'undefined' ? windowRef.sessionStorage : safeStorage;

// Determine backend server URL
const isLocal = windowRef.location?.hostname === 'localhost' || windowRef.location?.hostname === '127.0.0.1';

// If a BACKEND_URL is set in config.js, use it; otherwise auto-detect.
const _backendBase = BACKEND_URL
  ? BACKEND_URL.replace(/\/$/, '')
  : (isLocal ? 'http://localhost:5000' : `${windowRef.location?.protocol || 'http:'}//${windowRef.location?.host || 'localhost'}`);

const wsUrl = _backendBase.replace(/^http/, 'ws');
export const apiUrl = _backendBase + '/api';

// ── Session Token ──────────────────────────────────────────────────────────
// Each browser tab / device gets a unique session token stored in sessionStorage.
// sessionStorage is isolated per-tab, so two tabs of the same browser get different
// tokens, and a brand-new device also gets a fresh token.
function getOrCreateSessionToken() {
  let token = sessionStorageRef.getItem('dama_session_token');
  if (!token) {
    token = 'st_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    sessionStorageRef.setItem('dama_session_token', token);
  }
  return token;
}

export const Socket = {
  wsUrl,
  apiUrl,

  connect(playerId) {
    if (_kicked) {
      console.warn('Socket: permanently disconnected (session was kicked). Reload to reconnect.');
      return;
    }

    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      return;
    }

    _playerId = playerId;
    const sessionToken = getOrCreateSessionToken();

    console.log(`Connecting to WebSocket at ${wsUrl} (session: ${sessionToken})`);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('WebSocket connected.');
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }

      const apiToken = windowRef.DAMA_API_TOKEN
        || localStorageRef.getItem('dama_api_token')
        || null;

      this.send('join', { playerId, sessionToken, ...(apiToken ? { apiToken } : {}) });

      // Flush any messages that were queued before the socket opened
      while (_sendQueue.length > 0) {
        const queued = _sendQueue.shift();
        socket.send(JSON.stringify(queued));
      }

      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => this.send('ping'), 15000);

      this.trigger('connect', null);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Handle server-side session invalidation immediately before any other listener
        if (msg.type === 'kicked') {
          _kicked = true;   // permanently block all future reconnects
          if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
          if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
          socket.close(4000, 'session_replaced');
          _lockUI(msg.reason || 'You have been logged in on another device.');
          return;           // do not propagate further – UI is locked
        }

        this.trigger(msg.type, msg);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    socket.onclose = (event) => {
      console.log(`WebSocket closed: ${event.reason} (${event.code})`);
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }

      this.trigger('disconnect', event);

      // Permanently blocked when kicked (code 4000 or already set _kicked)
      if (_kicked || event.code === 4000 || event.reason === 'session_replaced') {
        console.log('Session was kicked — reconnect permanently blocked.');
        _kicked = true;
        return;
      }

      // Normal disconnect — try to reconnect every 3 s
      if (!reconnectTimer) {
        reconnectTimer = setInterval(() => {
          console.log('Attempting to reconnect WebSocket...');
          this.connect(playerId);
        }, 3000);
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  },

  send(type, payload = {}) {
    if (_kicked) return;
    const msg = JSON.stringify({ type, ...payload });
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(msg);
    } else {
      // Queue — will be flushed on next successful open
      console.warn(`WebSocket not open. Queuing: ${type}`);
      _sendQueue.push({ type, ...payload });
    }
  },

  on(type, callback) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(callback);
  },

  off(type, callback) {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter(cb => cb !== callback);
  },

  trigger(type, data) {
    if (listeners[type]) {
      listeners[type].forEach(cb => cb(data));
    }
  },

  isKicked() { return _kicked; }
};

// ── Full-page lock (called immediately on kick) ────────────────────────────
function _lockUI(reason) {
  // Remove any existing kicked overlay
  const existing = document.getElementById('damaKickedLock');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'damaKickedLock';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,.92)', 'backdrop-filter:blur(12px)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:20px', 'padding:30px', 'text-align:center',
    'pointer-events:all',   // captures ALL clicks – nothing underneath is clickable
    'user-select:none',
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:3.5rem;animation:kickBounce .5s ease both;">⚠️</div>
    <div style="
      font-family:'Cinzel',serif;font-size:1.4rem;font-weight:900;
      background:linear-gradient(180deg,#fff 0%,#f0c94a 60%,#d4a017 100%);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;
      background-clip:text;
    ">Session Replaced</div>
    <div style="color:rgba(255,255,255,.7);font-size:.9rem;max-width:300px;line-height:1.6;">
      ${reason}
    </div>
    <div style="color:rgba(255,255,255,.4);font-size:.75rem;">
      Only one device can be logged in at a time.
    </div>
    <button
      onclick="sessionStorage.removeItem('dama_session_token');window.location.reload();"
      style="
        margin-top:8px;padding:14px 32px;border-radius:50px;border:none;cursor:pointer;
        background:linear-gradient(135deg,#d4a017,#f0c94a);
        color:#1a1005;font-weight:800;font-size:.95rem;letter-spacing:.05em;
        box-shadow:0 4px 20px rgba(212,160,23,.5);
      "
    >🔄 Reconnect on This Device</button>
  `;

  // Inject bounce keyframe if not already present
  if (!document.getElementById('kickAnimStyle')) {
    const s = document.createElement('style');
    s.id = 'kickAnimStyle';
    s.textContent = '@keyframes kickBounce{from{transform:scale(0) rotate(-15deg)}to{transform:scale(1) rotate(0)}}';
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);
}
