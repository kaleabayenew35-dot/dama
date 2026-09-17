/* ═══════════════════════════════════════════════════
   MODULE: autoLogout.js
   Session timeout: 10 minutes of inactivity → go home
   • Resets on any touch / click / keydown / mousemove
   • Shows a 60-second warning overlay before redirecting
   • On first load, always ensures home screen is shown
═══════════════════════════════════════════════════ */

const TIMEOUT_MS  = 10 * 60 * 1000;   // 10 minutes
const WARNING_MS  = 1  * 60 * 1000;   //  1 minute warning before timeout

let idleTimer    = null;
let warnTimer    = null;
let warnOverlay  = null;
let warnInterval = null;

// ── Create the warning overlay (shown at 1-min mark) ──────────────────────
function createWarnOverlay() {
  if (document.getElementById('sessionWarnOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'sessionWarnOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99990',
    'background:rgba(0,0,0,.82)', 'backdrop-filter:blur(8px)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:18px', 'padding:32px 24px', 'text-align:center',
  ].join(';');

  overlay.innerHTML = `
    <style>
      @keyframes swFadeIn { from{opacity:0;transform:scale(.9)} to{opacity:1;transform:scale(1)} }
      #sessionWarnOverlay > * { animation: swFadeIn .35s ease both; }
    </style>
    <div style="font-size:3rem;line-height:1;">⏰</div>
    <div style="
      font-family:'Cinzel',serif; font-size:1.3rem; font-weight:900;
      background:linear-gradient(180deg,#fff 0%,#f0c94a 60%,#d4a017 100%);
      -webkit-background-clip:text; -webkit-text-fill-color:transparent;
      background-clip:text;
    ">Session Timeout</div>
    <div style="color:rgba(245,230,200,.75); font-size:.9rem; max-width:280px; line-height:1.65;">
      You've been inactive. Returning to home in
    </div>
    <div id="swCountdown" style="
      font-family:'Cinzel',serif; font-size:3rem; font-weight:900;
      color:#f0c94a; line-height:1;
    ">60</div>
    <button id="swStayBtn" style="
      padding:13px 36px; border-radius:50px; border:none; cursor:pointer;
      background:linear-gradient(135deg,#d4a017,#f0c94a);
      color:#1a1005; font-weight:800; font-size:.95rem;
      font-family:'Rajdhani',sans-serif; letter-spacing:.05em;
      box-shadow:0 4px 20px rgba(212,160,23,.45);
    ">I'm still here</button>
  `;

  document.body.appendChild(overlay);

  document.getElementById('swStayBtn')?.addEventListener('click', () => {
    resetIdle();
  });
}

function removeWarnOverlay() {
  const el = document.getElementById('sessionWarnOverlay');
  if (el) el.remove();
  if (warnInterval) { clearInterval(warnInterval); warnInterval = null; }
}

// ── Go home ────────────────────────────────────────────────────────────────
function goHome() {
  removeWarnOverlay();

  // End any active game silently
  try {
    const { G, endGame, WHITE, BLACK } = window._engineRef || {};
    if (G && !G.gameOver && G.mode === 'pvp' && G.isOnlinePvP && G.gameId) {
      window.Socket?.send('resign', { gameId: G.gameId, playerId: window.tgUserId });
    }
  } catch (_) {}

  // Hide all screens and show main menu
  ['gameScreen', 'loader'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const menu = document.getElementById('mainMenu');
  if (menu) menu.classList.remove('hidden');

  // Use showScreen if available
  if (typeof window.showScreen === 'function') window.showScreen('mainMenu');

  // Re-render player list
  if (typeof window.renderPlayerList === 'function') window.renderPlayerList();
}

// ── Reset idle timers ──────────────────────────────────────────────────────
export function resetIdle() {
  removeWarnOverlay();

  if (idleTimer)  { clearTimeout(idleTimer);  idleTimer  = null; }
  if (warnTimer)  { clearTimeout(warnTimer);  warnTimer  = null; }

  // Set warning timer (fires at TIMEOUT - WARNING)
  warnTimer = setTimeout(() => {
    createWarnOverlay();
    let remaining = Math.round(WARNING_MS / 1000);
    const cdEl = document.getElementById('swCountdown');
    if (cdEl) cdEl.textContent = remaining;

    warnInterval = setInterval(() => {
      remaining--;
      const el = document.getElementById('swCountdown');
      if (el) el.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(warnInterval);
        warnInterval = null;
        goHome();
      }
    }, 1000);
  }, TIMEOUT_MS - WARNING_MS);

  // Set hard logout timer
  idleTimer = setTimeout(() => {
    goHome();
  }, TIMEOUT_MS);
}

// ── Init ───────────────────────────────────────────────────────────────────
export function initAutoLogout() {
  // ── Always start on home screen ─────────────────────────────────────────
  // Defer until DOM is ready
  const ensureHome = () => {
    const gameScreen = document.getElementById('gameScreen');
    const loader     = document.getElementById('loader');
    const menu       = document.getElementById('mainMenu');

    // Only force home if loader is already gone (i.e. after initLoader completes)
    // We set a flag that initLoader can check; for now we store and re-check.
    if (gameScreen && !gameScreen.classList.contains('hidden')) {
      gameScreen.classList.add('hidden');
      if (menu) menu.classList.remove('hidden');
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureHome);
  } else {
    ensureHome();
  }

  // ── Listen for any user activity ─────────────────────────────────────────
  const EVENTS = ['touchstart', 'touchmove', 'click', 'keydown', 'mousemove', 'scroll'];
  EVENTS.forEach(evt =>
    document.addEventListener(evt, resetIdle, { passive: true })
  );

  // Start the first idle timer
  resetIdle();
}
