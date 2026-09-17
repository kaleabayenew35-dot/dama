import { apiUrl } from './socket.js';

// Connection monitoring utility for the frontend
export const initConnectionMonitor = (pingUrl = `${apiUrl}/health`) => {
  let currentState  = null;   // null = unknown, true = online, false = offline
  let hideTimer     = null;   // auto-hide after 5s

  // ── Create banner element ────────────────────────────────────────────────
  let banner = document.getElementById('connectionBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'connectionBanner';
    Object.assign(banner.style, {
      position:      'fixed',
      top:           '0',
      left:          '50%',
      transform:     'translateX(-50%) translateY(-110%)',
      zIndex:        '99998',
      display:       'flex',
      alignItems:    'center',
      gap:           '8px',
      padding:       '8px 20px',
      borderRadius:  '0 0 12px 12px',
      fontSize:      '0.82rem',
      fontWeight:    '700',
      fontFamily:    "'Rajdhani', sans-serif",
      letterSpacing: '0.06em',
      color:         '#fff',
      pointerEvents: 'none',
      transition:    'transform 0.35s cubic-bezier(.4,0,.2,1)',
      whiteSpace:    'nowrap',
      boxShadow:     '0 4px 18px rgba(0,0,0,.45)',
    });
    document.body.appendChild(banner);
  }

  // ── Inject keyframe for dot pulse ────────────────────────────────────────
  if (!document.getElementById('connAnimStyle')) {
    const s = document.createElement('style');
    s.id = 'connAnimStyle';
    s.textContent = `
      @keyframes connDotPulse {
        0%,100% { transform: scale(1);   opacity: 1;   }
        50%      { transform: scale(1.5); opacity: 0.6; }
      }
      .conn-dot { display:inline-block; width:8px; height:8px; border-radius:50%; animation: connDotPulse 1.2s ease-in-out infinite; }
    `;
    document.head.appendChild(s);
  }

  function showBanner(online) {
    // Clear any pending hide timer
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    if (online) {
      banner.style.background = 'linear-gradient(135deg,#1a7a3a,#27ae60)';
      banner.innerHTML = '<span class="conn-dot" style="background:#7fffaa;"></span> Online';
    } else {
      banner.style.background = 'linear-gradient(135deg,#7a1a1a,#c0392b)';
      banner.innerHTML = '<span class="conn-dot" style="background:#ffaaaa;"></span> Offline — check your connection';
    }

    // Slide in
    banner.style.transform = 'translateX(-50%) translateY(0)';

    // Auto-hide after 5 seconds
    hideTimer = setTimeout(() => {
      banner.style.transform = 'translateX(-50%) translateY(-110%)';
      hideTimer = null;
    }, 5000);
  }

  function handleState(online) {
    // Only react when state actually changes
    if (online === currentState) return;
    currentState = online;
    showBanner(online);
  }

  // ── Browser online/offline events ────────────────────────────────────────
  window.addEventListener('online',  () => handleState(true));
  window.addEventListener('offline', () => handleState(false));

  // ── Periodic backend ping every 15s ──────────────────────────────────────
  const ping = () => {
    fetch(pingUrl, { cache: 'no-store' })
      .then(r => handleState(r.ok))
      .catch(() => handleState(false));
  };

  setInterval(ping, 15000);

  // Initial check — show the banner on first load too
  ping();
};
