/* ═══════════════════════════════════════════════════
   MODULE: urlAuth.js
   Reads required URL params: token + launch (opaque)
   Fetches balance/username from dama-backend's
   POST /api/player-balance — no decryption, no phone
   ever in the URL or in client-side logic.
═══════════════════════════════════════════════════ */

import { showAuthError, hideAuthError } from './authError.js';

const REQUIRED_PARAMS = ['token', 'launch'];
const STORAGE_KEY     = 'dama_url_auth';
const BALANCE_FETCH_TIMEOUT_MS = 25000; // generous timeout for cold backend wakeups
const WAKEUP_UI_DELAY_MS       = 5000;
const LOADER_SUBTITLE_SELECTOR  = '.loader-subtitle';
const BALANCE_FALLBACK_PARAM    = 'balance';

let _authGate = null;

export function createAuthGate() {
  let settled = false;
  let resolveFn;
  let rejectFn;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolveFn(value);
    },
    reject(reason) {
      if (settled) return;
      settled = true;
      rejectFn(reason);
    },
  };
}

export function getAuthGate() {
  if (!_authGate) _authGate = createAuthGate();
  return _authGate;
}

export function resetAuthGate() {
  _authGate = createAuthGate();
  return _authGate;
}

/**
 * Read token + launch from the current URL.
 * No phone, username, or balance is ever expected in the URL.
 */
function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    token:   p.get('token')   || null,
    launch:  p.get('launch')  || null,
    balance: p.get(BALANCE_FALLBACK_PARAM) || null,
  };
}

function isValid(params) {
  return REQUIRED_PARAMS.every(k => !!params[k]);
}

function getFallbackBalance(params = null) {
  const raw = params?.balance ?? readParams().balance;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function shouldTreatBalanceFetchAsNonBlocking(reason) {
  if (typeof reason === 'number') return [401, 403].includes(reason);
  const text = String(reason || '').toLowerCase();
  return [401, 403].some(code => text.includes(String(code)))
    || /unauthorized|forbidden|invalid launch|invalid or inactive token/i.test(text);
}

/* ── Blocking overlays ───────────────────────────────────────── */

function showInvalidOverlay(missing, options = {}) {
  document.body.style.overflow = 'hidden';
  const title = options.title || 'Access Denied';
  const description = options.description || 'This app requires a valid access link.<br>Please open the correct URL provided by your administrator.';

  const overlay = document.createElement('div');
  overlay.id = 'urlAuthBlock';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:radial-gradient(ellipse at center,#1a0f00 0%,#0d0d0d 70%)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:18px', 'padding:32px 24px', 'text-align:center',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes lockBounce {
        0%  { transform:scale(0) rotate(-20deg);opacity:0; }
        60% { transform:scale(1.15) rotate(4deg);opacity:1; }
        100%{ transform:scale(1) rotate(0deg);opacity:1; }
      }
      @keyframes fadeUp {
        from { opacity:0;transform:translateY(14px); }
        to   { opacity:1;transform:translateY(0); }
      }
      #urlAuthBlock .lock-icon   { animation:lockBounce .55s ease both; }
      #urlAuthBlock .auth-title  { animation:fadeUp .4s .25s ease both;opacity:0; }
      #urlAuthBlock .auth-desc   { animation:fadeUp .4s .38s ease both;opacity:0; }
      #urlAuthBlock .auth-missing{ animation:fadeUp .4s .48s ease both;opacity:0; }
      #urlAuthBlock .auth-format { animation:fadeUp .4s .55s ease both;opacity:0; }
    </style>
    <div class="lock-icon" style="font-size:3.6rem;line-height:1;">🔒</div>
    <div class="auth-title" style="
      font-family:'Cinzel',serif;font-size:1.4rem;font-weight:900;
      background:linear-gradient(180deg,#fff 0%,#f0c94a 55%,#d4a017 100%);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
      ${title}
    </div>
    <div class="auth-desc" style="color:rgba(245,230,200,.7);font-size:.9rem;max-width:300px;line-height:1.65;">
      ${description}
    </div>
    <div class="auth-missing" style="
      background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.3);
      border-radius:10px;padding:10px 18px;font-size:.78rem;color:#e74c3c;
      line-height:1.7;max-width:320px;">
      <strong>Missing parameters:</strong><br>
      ${missing.map(k => `<code style="background:rgba(0,0,0,.3);padding:1px 6px;border-radius:4px;">${k}</code>`).join('  ')}
    </div>
    <div class="auth-format" style="
      background:rgba(212,160,23,.07);border:1px solid rgba(212,160,23,.2);
      border-radius:10px;padding:12px 16px;font-family:'Courier New',monospace;
      font-size:.72rem;color:rgba(240,201,74,.85);word-break:break-all;
      max-width:340px;line-height:1.7;text-align:left;">
      <span style="color:rgba(255,255,255,.4);font-family:sans-serif;font-size:.68rem;">Required URL format:</span><br>
      <span style="color:#f0c94a;">?token=</span><span style="color:#fff;">YOUR_TOKEN</span>
      <span style="color:#f0c94a;">&amp;launch=</span><span style="color:#fff;">LAUNCH_PAYLOAD</span>
    </div>`;

  const mount = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    document.body.appendChild(overlay);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}

/**
 * showOfflineOverlay — shown when dama-backend /player-balance is unreachable.
 */
function showOfflineOverlay() {
  if (document.getElementById('backendConnBlock')) return;
  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.id = 'backendConnBlock';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:radial-gradient(ellipse at center,#1e0000 0%,#0d0d0d 70%)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:18px', 'padding:32px 24px', 'text-align:center',
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:3.6rem;line-height:1;margin-bottom:8px;">⚠️</div>
    <div style="font-family:'Cinzel',serif;font-size:1.4rem;font-weight:900;color:#e74c3c;">
      Connection Offline
    </div>
    <div style="color:rgba(245,230,200,.7);font-size:.9rem;max-width:320px;line-height:1.65;">
      Unable to reach the game server.<br>
      Please check your connection and try again.
    </div>
    <button id="connRetryBtn" style="
      background:#d4a017;color:#000;border:none;border-radius:8px;
      padding:12px 24px;font-weight:700;cursor:pointer;margin-top:12px;
      font-family:inherit;box-shadow:0 4px 14px rgba(212,160,23,.3);">
      ↻ Try Again
    </button>`;

  const mount = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    document.body.appendChild(overlay);
    document.getElementById('connRetryBtn').addEventListener('click', () => window.location.reload());
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}

function showAccountLoadFailureOverlay(onRetry) {
  showAuthError('We couldn\'t verify your account details from the backend. Please contact the admin or try again.', onRetry);
}

/* ── Balance display / spinner helpers ───────────────────────── */

export function updateBalanceDisplay(balance) {
  if (balance === null || balance === undefined) {
    hideAuthError();
    return;
  }
  const balEl = document.getElementById('myBalance');
  if (balEl) balEl.textContent = Number(balance).toLocaleString();
  window.DAMA_BALANCE = balance;
  window.dispatchEvent(new CustomEvent('dama-balance-changed', { detail: balance }));
  if (window.tgUserId && window.PlayerRegistry) {
    const list = window.PlayerRegistry.load();
    const me   = list.find(p => p.id === window.tgUserId);
    if (me) { me.balance = balance; window.PlayerRegistry.save(list); }
  }
}

function setBalanceLoading(loading) {
  const spinner = document.getElementById('balSpinner');
  const btn     = document.getElementById('balRefreshBtn');
  if (spinner) spinner.classList.toggle('hidden', !loading);
  if (btn) { btn.classList.toggle('spinning', loading); btn.disabled = loading; }
}

function setLoaderSubtitle(text) {
  const subtitle = document.querySelector(LOADER_SUBTITLE_SELECTOR);
  if (subtitle) subtitle.textContent = text;
}

function showWakingUpMessage(show) {
  const subtitle = document.querySelector(LOADER_SUBTITLE_SELECTOR);
  if (!subtitle) return;
  if (show) {
    subtitle.textContent = 'Waking up the server, this may take a moment...';
  } else {
    subtitle.textContent = 'Ethiopian Checkers';
  }
}

/* ── Single call to dama-backend /player-balance ─────────────── */
async function fetchPlayerBalance(token, launch) {
  console.info('[urlAuth] fetchPlayerBalance timeout set to', BALANCE_FETCH_TIMEOUT_MS, 'ms');
  const { apiUrl } = await import('./socket.js');
  const res = await fetch(`${apiUrl}/player-balance`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token, launch }),
    signal:  AbortSignal.timeout(BALANCE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const data = json?.data ?? json;
  return {
    balance:  data.balance  !== undefined ? Number(data.balance) : null,
    username: data.username || null,
  };
}

/* ── refreshBalance — called periodically and on tab focus ────── */
export async function refreshBalance(silent = false) {
  const auth = (() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  })();
  if (!auth?.token || !auth?.launch) return;

  const fallbackBalance = getFallbackBalance(readParams());

  if (!silent) setBalanceLoading(true);
  try {
    const data = await fetchPlayerBalance(auth.token, auth.launch);
    if (data.balance === null || data.username === null) {
      showAuthError('We couldn\'t verify your account details from the backend. Please contact the admin or try again.', () => refreshBalance(false));
      return;
    }
    updateBalanceDisplay(data.balance);
    window.DAMA_USERNAME = data.username;
  } catch (err) {
    if (shouldTreatBalanceFetchAsNonBlocking(err)) {
      if (fallbackBalance !== null) updateBalanceDisplay(fallbackBalance);
      console.info('[urlAuth] Balance refresh skipped after auth rejection:', err.message);
      return;
    }
    console.warn('[urlAuth] refreshBalance failed:', err.message);
    if (!silent) showAuthError('We couldn\'t connect to the game server. Please contact the admin or try again.', () => refreshBalance(false));
  } finally {
    if (!silent) setBalanceLoading(false);
  }
}

/* ── initUrlAuth — called once at app startup ─────────────────── */
export function initUrlAuth() {
  const gate = resetAuthGate();
  window.DAMA_AUTH_READY = gate.promise;

  return new Promise((resolve) => {
    const params = readParams();
    const fallbackBalance = getFallbackBalance(params);

    if (!isValid(params)) {
      showInvalidOverlay(REQUIRED_PARAMS.filter(k => !params[k]));
      gate.reject(new Error(`Missing auth parameters: ${REQUIRED_PARAMS.filter(k => !params[k]).join(', ')}`));
      // Promise never resolves — app stays blocked
      return;
    }

    // Persist token + launch to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));

    // Expose token globally so registry.js / socket.js pick it up
    window.DAMA_API_TOKEN = params.token;
    localStorage.setItem('dama_api_token', params.token);

    // Sensible defaults before the async fetch completes
    window.DAMA_USERNAME = 'Player';
    window.DAMA_BALANCE  = null;

    setBalanceLoading(true);
    const wakeTimer = setTimeout(() => showWakingUpMessage(true), WAKEUP_UI_DELAY_MS);

    fetchPlayerBalance(params.token, params.launch)
      .then(data => {
        clearTimeout(wakeTimer);
        showWakingUpMessage(false);
        setBalanceLoading(false);

        if (data.balance === null || data.username === null) {
          const err = new Error('Could not load account data from backend.');
          gate.reject(err);
          showAccountLoadFailureOverlay(() => initUrlAuth());
          resolve(params);
          return;
        }

        updateBalanceDisplay(data.balance);
        window.DAMA_USERNAME = data.username;
        const nameEl = document.getElementById('tgName');
        if (nameEl) nameEl.textContent = data.username;

        gate.resolve(true);

        // Clean the URL — keep only token + launch, nothing else
        try {
          const url   = new URL(window.location.href);
          const clean = new URLSearchParams();
          clean.set('token',  params.token);
          clean.set('launch', params.launch);
          window.history.replaceState({}, '', `${url.pathname}?${clean.toString()}`);
        } catch (e) {
          console.warn('[urlAuth] Could not clean URL:', e.message);
        }

        resolve(params);
      })
      .catch(err => {
        clearTimeout(wakeTimer);
        showWakingUpMessage(false);
        setBalanceLoading(false);

        gate.reject(err);

        if (shouldTreatBalanceFetchAsNonBlocking(err)) {
          if (fallbackBalance !== null) updateBalanceDisplay(fallbackBalance);
          showInvalidOverlay(['token', 'launch'], {
            title: 'Access Denied',
            description: 'This access link is invalid or expired.<br>Please request a fresh link from your administrator.',
          });
          console.info('[urlAuth] Balance lookup skipped after auth rejection:', err.message);
          resolve(params);
          return;
        }

        console.error('[urlAuth] Failed to fetch player balance:', err.message);
        showAccountLoadFailureOverlay(() => initUrlAuth());
        resolve(params);
      });
  });
}

/**
 * getUrlAuth() — read cached params after page reload.
 */
export function getUrlAuth() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}
