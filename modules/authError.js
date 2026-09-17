let _overlay = null;
let _retryHandler = null;

export function showAuthError(message = null, onRetry = null) {
  hideAuthError();
  _retryHandler = onRetry;

  document.body.style.overflow = 'hidden';

  const overlay = document.createElement('div');
  overlay.id = 'authErrorBlock';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:radial-gradient(ellipse at center,#1a0f00 0%,#0d0d0d 70%)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:16px', 'padding:32px 24px', 'text-align:center',
  ].join(';');

  overlay.innerHTML = `
    <div style="font-size:3.2rem;line-height:1;margin-bottom:4px;">⚠️</div>
    <div style="font-family:'Cinzel',serif;font-size:1.3rem;font-weight:900;color:#f0c94a;">
      Connection Problem
    </div>
    <div style="color:rgba(245,230,200,.75);font-size:.95rem;max-width:320px;line-height:1.6;">
      ${message || "We couldn't connect to the game server. Please contact the admin or try again."}
    </div>
    <button id="authRetryBtn" style="
      background:#d4a017;color:#000;border:none;border-radius:999px;
      padding:12px 24px;font-weight:700;cursor:pointer;margin-top:8px;
      font-family:inherit;box-shadow:0 4px 14px rgba(212,160,23,.3);">
      ↻ Retry
    </button>`;

  const mount = () => {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
    document.body.appendChild(overlay);
    _overlay = overlay;
    document.getElementById('authRetryBtn')?.addEventListener('click', () => {
      hideAuthError();
      if (typeof _retryHandler === 'function') _retryHandler();
    });
  };

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
}

export function hideAuthError() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _retryHandler = null;
  document.body.style.overflow = '';
}
