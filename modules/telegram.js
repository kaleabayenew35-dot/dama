/* ═══════════════════════════════════════════════════
   MODULE: telegram.js
   Handles: Telegram WebApp init, user data,
            haptic feedback, screen navigation
═══════════════════════════════════════════════════ */

const telegramGlobal = typeof globalThis !== 'undefined' ? globalThis : undefined;
export const twa = telegramGlobal?.Telegram?.WebApp;

/* ── Version guard ── */
export function twaAtLeast(required) {
  if (!twa?.version) return false;
  const [ma, mi = 0] = twa.version.split('.').map(Number);
  const [ra, ri = 0] = String(required).split('.').map(Number);
  return ma > ra || (ma === ra && mi >= ri);
}

/* ── Init Telegram WebApp ── */
export function initTelegram() {
  if (!twa) return;

  twa.ready();
  twa.expand();

  if (twaAtLeast('7.7')) twa.disableVerticalSwipes();

  if (twaAtLeast('6.1')) {
    try { twa.setHeaderColor('#0d0d0d'); } catch (_) {}
  }
  if (twaAtLeast('7.10')) {
    try { twa.setBottomBarColor('#0d0d0d'); } catch (_) {}
  }

  if (twa.colorScheme === 'dark' || !twa.colorScheme) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

/* ── Populate user info from Telegram ── */
export function populateTelegramUser(onComplete) {
  const nameEl   = document.getElementById('tgName');
  const avatarEl = document.getElementById('tgAvatar');
  if (!nameEl) return;

  const user = twa?.initDataUnsafe?.user;

  if (user) {
    // ── Telegram user ────────────────────────────────────────────────────────
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
    nameEl.textContent = fullName || user.username || 'Player';

    if (user.photo_url) {
      avatarEl.innerHTML = `<img src="${user.photo_url}" alt="avatar"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      const initials = (user.first_name?.[0] || '') +
                       (user.last_name?.[0] || user.username?.[0] || '');
      avatarEl.textContent = initials.toUpperCase() || '♟';
    }

    window.tgUserName  = fullName || user.username || 'You';
    window.tgUserId    = String(user.id);
    window.tgUserPhoto = user.photo_url || null;

  } else if (window.DAMA_USERNAME) {
    // ── URL-param user (non-Telegram browser, launched via system-backend link) ──
    // urlAuth.js sets window.DAMA_USERNAME from the verified launch token.
    // We use the username as the stable player ID since phone is never exposed
    // to the frontend.
    const name = window.DAMA_USERNAME;
    nameEl.textContent = name;

    const initials = name.slice(0, 2).toUpperCase();
    avatarEl.textContent = initials || '♟';

    window.tgUserName  = name;
    window.tgUserId    = 'usr_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    window.tgUserPhoto = null;

    // Pre-seed balance from urlAuth result
    if (window.DAMA_BALANCE !== undefined && window.DAMA_BALANCE !== null) {
      const balEl = document.getElementById('myBalance');
      if (balEl) balEl.textContent = Number(window.DAMA_BALANCE).toLocaleString();
    }

  } else {
    // ── Fallback: local guest ────────────────────────────────────────────────
    nameEl.textContent = 'Player';
    window.tgUserName  = 'Player 1';

    let localId = localStorage.getItem('dama_local_uid');
    if (!localId) {
      localId = 'local_' + Math.random().toString(36).slice(2);
      localStorage.setItem('dama_local_uid', localId);
    }
    window.tgUserId    = localId;
    window.tgUserPhoto = null;
  }

  if (typeof onComplete === 'function') onComplete();
}

/* ── Haptic feedback ── */
export function tgHaptic(type) {
  if (!twaAtLeast('6.1')) return;
  if (type === 'success' || type === 'error' || type === 'warning') {
    twa?.HapticFeedback?.notificationOccurred?.(type);
  } else {
    twa?.HapticFeedback?.impactOccurred?.(type);
  }
}

/* ── Screen navigation ── */
export function showScreen(id) {
  ['mainMenu', 'gameScreen'].forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');

  if (twaAtLeast('6.1') && twa?.BackButton) {
    id === 'gameScreen' ? twa.BackButton.show() : twa.BackButton.hide();
  }
}

/* ── Back button from Telegram hardware ── */
export function initBackButton(onBack) {
  if (twaAtLeast('6.1') && twa?.BackButton) {
    twa.BackButton.onClick(() => {
      if (!document.getElementById('gameScreen').classList.contains('hidden')) {
        onBack();
      }
    });
  }
}
