/* ═══════════════════════════════════════════════════
   modules/state.js — Single source of truth for
   runtime globals that must be shared across modules.

   Rules:
   - Only truly cross-module runtime values live here.
   - No DOM, no business logic — just plain state.
   - Import { getState, setState } from this file
     instead of reading/writing window.*
═══════════════════════════════════════════════════ */

const _state = {
  // ── Telegram / URL-auth identity ──────────────────
  tgUserId:    null,   // String  e.g. "123456789" or "ph_0912345678"
  tgUserName:  null,   // String  display name
  tgUserPhoto: null,   // String | null  photo URL

  // ── Auth / session ─────────────────────────────────
  damaApiToken: null,  // String  X-API-Token header value
  damaPhone:    null,  // String  normalised phone "251912345678"
  damaUsername: null,  // String  from partner backend
  damaBalance:  null,  // Number | null

  // ── Active game metadata ───────────────────────────
  activeOnlineGame:   null,  // object | null – set when WS game_start fires
  activeChallenge:    null,  // object | null – challenger side waiting
  incomingChallenge:  null,  // object | null – challengee side

  // ── Piece theme ────────────────────────────────────
  pieceTheme:      null,   // composed theme object
  pieceThemeId:    'classic',
  pieceStyleId:    'solid',
  pieceShapeClass: 'gp-shape-disc',

  // ── Bet / ready state ─────────────────────────────
  currentBet:   0,
  playerReady:  false,

  // ── Misc ──────────────────────────────────────────
  appInitialized: false,
  tempGameId:     null,
  tempBetAmt:     undefined,
};

export function getState(key) {
  return _state[key];
}

export function setState(key, value) {
  _state[key] = value;
  // Keep window.* in sync for any legacy third-party code or Telegram SDK callbacks
  // that may still reference them. This one-way bridge can be removed once all
  // modules are fully migrated.
  _WINDOW_BRIDGE[key]?.(value);
}

export function getAll() {
  return { ..._state };
}

// ── One-way bridge: state → window (legacy compat) ───────────────────────
// Maps state keys → window property names that external code might read.
const _WINDOW_BRIDGE = {
  tgUserId:       v => { window.tgUserId       = v; },
  tgUserName:     v => { window.tgUserName     = v; },
  tgUserPhoto:    v => { window.tgUserPhoto    = v; },
  damaApiToken:   v => { window.DAMA_API_TOKEN = v; },
  damaPhone:      v => { window.DAMA_PHONE     = v; },
  damaUsername:   v => { window.DAMA_USERNAME  = v; },
  damaBalance:    v => { window.DAMA_BALANCE   = v; },
  pieceTheme:     v => { window.pieceTheme     = v; },
  pieceShapeClass:v => { window.pieceShapeClass= v; },
  currentBet:     v => { window.currentBet     = v; },
  playerReady:    v => { window.playerReady    = v; },
};

// ── Bootstrap: read whatever window.* already has on load ────────────────
// (set by urlAuth.js / telegram.js before state.js was imported)
export function syncFromWindow() {
  if (window.tgUserId        != null) _state.tgUserId        = window.tgUserId;
  if (window.tgUserName      != null) _state.tgUserName      = window.tgUserName;
  if (window.tgUserPhoto     != null) _state.tgUserPhoto     = window.tgUserPhoto;
  if (window.DAMA_API_TOKEN  != null) _state.damaApiToken    = window.DAMA_API_TOKEN;
  if (window.DAMA_PHONE      != null) _state.damaPhone       = window.DAMA_PHONE;
  if (window.DAMA_USERNAME   != null) _state.damaUsername    = window.DAMA_USERNAME;
  if (window.DAMA_BALANCE    != null) _state.damaBalance     = window.DAMA_BALANCE;
}
