/* ═══════════════════════════════════════════════════
   MODULE: autoLogout.js
   Session timeout has been removed.
   This is a Telegram Mini App — Telegram manages the
   session lifecycle. No idle logout is needed.

   Both exports are kept as no-ops so existing imports
   in app.js and engine.js continue to work without
   any changes to those files.
═══════════════════════════════════════════════════ */

export function resetIdle() {
  // no-op — session timeout removed
}

export function initAutoLogout() {
  // no-op — session timeout removed
}
