/* ═══════════════════════════════════════════════════
   MODULE: engine.js
   Orchestrates game flow: AI, timers, win/undo logic.
   Pure move logic lives in moveValidator.js
   DOM rendering lives in boardRenderer.js (future)
═══════════════════════════════════════════════════ */

import { tgHaptic, showScreen } from './telegram.js';
import { applyPieceTheme, renderPlayerList, PIECE_THEMES } from './ui.js';
import { getState, setState } from './state.js';
import { resetIdle } from './autoLogout.js';
import { Socket } from './socket.js';
import { PlayerRegistry } from './registry.js';
import {
  EMPTY, BLACK, WHITE, B_KING, W_KING,
  isOwn, isEnemy, isKing,
  initBoard, applyMove,
  getNormalMoves, getQueenMoves, getMovesForPiece,
  getCaptureMovesFrom, getAllCaptures, getAllMoves,
} from './moveValidator.js';

// Re-export constants/functions so game.js and app.js keep one import point
export { EMPTY, BLACK, WHITE, B_KING, W_KING,
  isOwn, isEnemy, isKing, initBoard, applyMove,
  getNormalMoves, getQueenMoves, getMovesForPiece,
  getCaptureMovesFrom, getAllCaptures, getAllMoves };

/* ── Game State ── */
export let G = {};

let rematchTimer = null;
let rematchPrompt = null;

function clearRematchUi() {
  if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
  if (rematchPrompt) { rematchPrompt.remove(); rematchPrompt = null; }
  const btn = document.getElementById('playAgainBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<span>↺</span> Play Again <div class="btn-shine"></div>`;
  }
}

function setRematchWaitingState(message) {
  const btn = document.getElementById('playAgainBtn');
  const sub = document.getElementById('winSub');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> ${message} <div class="btn-shine"></div>`;
  }
  if (sub) sub.textContent = message;
}

function hideRematchPrompt() {
  if (rematchPrompt) { rematchPrompt.remove(); rematchPrompt = null; }
}

function showRematchPrompt(opponentName, onAccept, onDecline) {
  hideRematchPrompt();
  const overlay = document.createElement('div');
  overlay.id = 'rematchPrompt';
  overlay.style.cssText = [
    'position:fixed','inset:0','z-index:99999','background:rgba(0,0,0,.72)',
    'display:flex','align-items:center','justify-content:center','padding:20px'
  ].join(';');
  overlay.innerHTML = `
    <div style="background:#1f1404;border:1px solid rgba(212,160,23,.35);border-radius:16px;padding:24px 24px 20px;max-width:320px;width:100%;box-shadow:0 10px 35px rgba(0,0,0,.35);text-align:center;color:#f8e7b3;">
      <div style="font-size:2rem;margin-bottom:8px;">🔁</div>
      <div style="font-family:'Cinzel',serif;font-size:1.15rem;font-weight:900;margin-bottom:8px;">Rematch request</div>
      <div style="font-size:.95rem;line-height:1.5;margin-bottom:16px;">${opponentName || 'Your opponent'} wants a rematch.</div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="rematchAcceptBtn" style="background:#d4a017;color:#000;border:none;border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer;">Accept</button>
        <button id="rematchDeclineBtn" style="background:transparent;color:#f8e7b3;border:1px solid rgba(248,231,179,.35);border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer;">Decline</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  rematchPrompt = overlay;
  document.getElementById('rematchAcceptBtn')?.addEventListener('click', () => {
    hideRematchPrompt();
    if (typeof onAccept === 'function') onAccept();
  });
  document.getElementById('rematchDeclineBtn')?.addEventListener('click', () => {
    hideRematchPrompt();
    if (typeof onDecline === 'function') onDecline();
  });
}

function startRematchGame() {
  const rematchGameId = `REM-${Date.now().toString(36).slice(-6).toUpperCase()}`;
  setState('activeOnlineGame', {
    gameId: rematchGameId,
    myColor: G.myColor || 'black',
    turn: 'black',
    betAmount: G.betAmount || getState('currentBet') || 0,
    history: [],
  });
  startGame('pvp', G.opponent);
}

export function freshState() {
  return {
    debug: true,
    board: initBoard(),
    turn: BLACK,
    mode: 'pvp',
    difficulty: 'medium',
    selected: null,
    validMoves: [],
    mustCapture: null,
    chainCaptured: null,
    moveCount: 0,
    captured: { [BLACK]: 0, [WHITE]: 0 },
    history: [],
    gameOver: false,
    startTime: Date.now(),
    timers: { [BLACK]: 0, [WHITE]: 0 },
    timerInterval: null,
    lastTick: Date.now(),
    countdown: 20,
    countdownInterval: null,
    strikes: { [BLACK]: 0, [WHITE]: 0 },
    MAX_STRIKES: 3,
    TURN_SECONDS: 20,
    soloKingPlayer: null,
    soloKingMoves:  0,
    SOLO_KING_LIMIT: 10,
  };
}

function countCaptured(move) { return move.capturedSquare ? 1 : 0; }

/* ══════════════════════════════════════════════════════════════════
   AI ENGINE  (minimax + iterative deepening + transposition table)
   ══════════════════════════════════════════════════════════════════ */

const PST_MAN = [
  [0,  0,  0,  0,  0,  0,  0,  0],
  [5,  0,  5,  0,  5,  0,  5,  0],
  [0,  4,  0,  4,  0,  4,  0,  4],
  [3,  0,  3,  0,  3,  0,  3,  0],
  [0,  3,  0,  4,  0,  4,  0,  3],
  [2,  0,  3,  0,  3,  0,  2,  0],
  [0,  2,  0,  2,  0,  2,  0,  2],
  [1,  0,  1,  0,  1,  0,  1,  0],
];

const PST_KING = [
  [-2,-1,-2,-1,-2,-1,-2,-1],
  [-1, 1,-1, 2,-1, 2,-1,-1],
  [-2, 2, 3, 4, 4, 3, 2,-2],
  [-1, 2, 4, 5, 5, 4, 2,-1],
  [-1, 2, 4, 5, 5, 4, 2,-1],
  [-2, 2, 3, 4, 4, 3, 2,-2],
  [-1, 1,-1, 2,-1, 2,-1,-1],
  [-2,-1,-2,-1,-2,-1,-2,-1],
];

function evaluate(board, aiPlayer) {
  const opp = aiPlayer === BLACK ? WHITE : BLACK;
  let score = 0, aiPieces = 0, oppPieces = 0, aiKings = 0, oppKings = 0;
  let aiBackRow = 0, oppBackRow = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === EMPTY) continue;
      const king = isKing(p);
      const mine = isOwn(p, aiPlayer);
      const matVal = king ? 320 : 100;
      let pstVal;
      if (king) {
        pstVal = PST_KING[r][c] * 4;
      } else {
        const isPieceBlack = (p === BLACK || p === B_KING);
        pstVal = PST_MAN[isPieceBlack ? r : (7 - r)][c] * 3;
      }
      if (!king) {
        if (mine && ((aiPlayer === WHITE && r === 0) || (aiPlayer === BLACK && r === 7))) aiBackRow++;
        if (!mine && ((aiPlayer === WHITE && r === 7) || (aiPlayer === BLACK && r === 0))) oppBackRow++;
      }
      if (mine) { score += matVal + pstVal; if (king) aiKings++; else aiPieces++; }
      else       { score -= matVal + pstVal; if (king) oppKings++; else oppPieces++; }
    }
  }
  const aiTotal = aiPieces + aiKings, oppTotal = oppPieces + oppKings;
  score += (getAllMoves(board, aiPlayer).length - getAllMoves(board, opp).length) * 5;
  score += (aiBackRow - oppBackRow) * 10;
  score += (getAllCaptures(board, aiPlayer).length - getAllCaptures(board, opp).length) * 15;
  if (aiTotal > oppTotal) { score += (aiTotal - oppTotal) * 20; score += aiKings * 30; }
  if (aiTotal === 1 && aiKings === 1 && oppTotal >= 3) score -= 200;
  return score;
}

const TT_SIZE = 1 << 21;
const ttTable = new Array(TT_SIZE);
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

function boardHash(board) {
  let h = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      h = (Math.imul(h, 31) + board[r][c]) | 0;
  return h;
}

function ttGet(hash, depth, alpha, beta) {
  const slot = ttTable[(hash >>> 0) % TT_SIZE];
  if (!slot || slot.hash !== hash || slot.depth < depth) return null;
  if (slot.flag === TT_EXACT) return slot.score;
  if (slot.flag === TT_LOWER && slot.score >= beta)  return slot.score;
  if (slot.flag === TT_UPPER && slot.score <= alpha) return slot.score;
  return null;
}

function ttPut(hash, depth, score, flag) {
  const idx = (hash >>> 0) % TT_SIZE;
  const old = ttTable[idx];
  if (!old || old.depth <= depth) ttTable[idx] = { hash, depth, score, flag };
}

function orderMoves(moves, board) {
  return moves.slice().sort((a, b) => {
    const aC = a.capturedSquare ? 1 : 0, bC = b.capturedSquare ? 1 : 0;
    if (aC !== bC) return bC - aC;
    const aK = isKing(board[(a.from||a).r]?.[(a.from||a).c] ?? EMPTY) ? 1 : 0;
    const bK = isKing(board[(b.from||b).r]?.[(b.from||b).c] ?? EMPTY) ? 1 : 0;
    return bK - aK;
  });
}

function alphaBeta(board, depth, alpha, beta, maximizing, aiPlayer) {
  const hash = boardHash(board);
  const cached = ttGet(hash, depth, alpha, beta);
  if (cached !== null) return cached;

  const player = maximizing ? aiPlayer : (aiPlayer === BLACK ? WHITE : BLACK);
  const moves  = getAllMoves(board, player);

  if (moves.length === 0) {
    const score = maximizing ? -20000 - depth : 20000 + depth;
    ttPut(hash, depth, score, TT_EXACT);
    return score;
  }
  if (depth === 0) {
    const score = evaluate(board, aiPlayer);
    ttPut(hash, depth, score, TT_EXACT);
    return score;
  }

  const ordered = orderMoves(moves, board);
  const origAlpha = alpha;
  let best = maximizing ? -Infinity : Infinity;

  for (const m of ordered) {
    const from = m.from || { r: m.r, c: m.c };
    const nb   = applyMove(board, from, m);
    const val  = alphaBeta(nb, depth - 1, alpha, beta, !maximizing, aiPlayer);
    if (maximizing) { if (val > best) best = val; if (val > alpha) alpha = val; }
    else            { if (val < best) best = val; if (val < beta)  beta  = val; }
    if (beta <= alpha) break;
  }

  const flag = best <= origAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
  ttPut(hash, depth, best, flag);
  return best;
}

export function getBestAIMove(board, aiPlayer, difficulty) {
  ttTable.fill(undefined);
  let maxDepth, timeBudget, randomChance;

  if (typeof difficulty === 'number') {
    const pct = Math.max(1, Math.min(100, difficulty));
    if      (pct <= 20) { maxDepth =  2; timeBudget =  150; randomChance = 0.90; }
    else if (pct <= 40) { maxDepth =  3; timeBudget =  250; randomChance = 0.60; }
    else if (pct <= 60) { maxDepth =  5; timeBudget =  500; randomChance = 0.10; }
    else if (pct <= 80) { maxDepth =  7; timeBudget = 1200; randomChance = 0.00; }
    else if (pct <= 90) { maxDepth = 10; timeBudget = 2500; randomChance = 0.00; }
    else                { maxDepth = 14; timeBudget = 4000; randomChance = 0.00; }
  } else {
    if (difficulty === 'easy')      { maxDepth = 3; timeBudget =  250; randomChance = 0.60; }
    else if (difficulty === 'hard') { maxDepth = 7; timeBudget = 1200; randomChance = 0.00; }
    else                            { maxDepth = 5; timeBudget =  500; randomChance = 0.10; }
  }

  const moves = getAllMoves(board, aiPlayer, null);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  if (randomChance > 0 && Math.random() < randomChance)
    return moves[Math.floor(Math.random() * moves.length)];

  const ordered  = orderMoves(moves, board);
  const deadline = Date.now() + timeBudget;
  let bestMove   = ordered[0];

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() >= deadline) break;
    let depthBest = -Infinity, depthMove = ordered[0], timedOut = false;
    for (const m of ordered) {
      if (Date.now() >= deadline) { timedOut = true; break; }
      const from  = m.from || { r: m.r, c: m.c };
      const score = alphaBeta(applyMove(board, from, m), depth - 1, -Infinity, Infinity, false, aiPlayer);
      if (score > depthBest) { depthBest = score; depthMove = m; }
    }
    if (!timedOut) bestMove = depthMove;
    if (Date.now() >= deadline) break;
  }
  return bestMove;
}

/* ── Board rendering ── */
export function renderBoard() {
  const el = document.getElementById('gameBoard');
  if (!el) return;
  el.innerHTML = '';

  const highlights = new Set(G.validMoves.map(m => `${m.r},${m.c}`));
  const mustSet = new Set();
  if (!G.mustCapture)
    getAllCaptures(G.board, G.turn).forEach(m => mustSet.add(`${m.from.r},${m.from.c}`));

  const flipped  = G.isOnlinePvP && G.myColor === 'white';
  const rowOrder = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  const colOrder = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

  const boardWrap = document.querySelector('.game-board-wrap');
  if (boardWrap) boardWrap.classList.toggle('board-flipped', flipped);

  for (const r of rowOrder) {
    for (const c of colOrder) {
      const cell   = document.createElement('div');
      const isDark = (r + c) % 2 !== 0;
      cell.className = 'gc ' + (isDark ? 'gd' : 'gl');
      cell.dataset.r = r; cell.dataset.c = c;
      if (!isDark) { el.appendChild(cell); continue; }

      const piece      = G.board[r][c];
      const isSelected = G.selected && G.selected.r === r && G.selected.c === c;
      const isLocked   = G.mustCapture && G.mustCapture.r === r && G.mustCapture.c === c;
      const isHigh     = highlights.has(`${r},${c}`);

      if (isSelected || isLocked) cell.classList.add('gc-selected');
      if (isHigh)                 cell.classList.add('gc-highlight');

      if (piece !== EMPTY) {
        const pd         = document.createElement('div');
        const isB        = piece === BLACK || piece === B_KING;
        const king       = isKing(piece);
        const shapeClass = isB ? (getState('pieceShapeClass') || 'gp-shape-disc') : 'gp-shape-disc';
        pd.className = 'gp ' + (isB ? 'gp-b' : 'gp-w') + (king ? ' gp-king' : '') + ' ' + shapeClass;
        if (mustSet.has(`${r},${c}`) && isOwn(piece, G.turn)) pd.classList.add('gp-must');
        if (isSelected || isLocked) pd.classList.add('gp-sel');
        if (isLocked) pd.classList.add('gp-locked');
        if (isHigh)   cell.classList.add('gc-highlight-piece');

        if (king) {
          pd.innerHTML = buildQueenInner(isB);
        } else if (shapeClass === 'gp-shape-pawn' && isB) {
          const t = getState('pieceTheme') || {};
          pd.innerHTML = buildPawnPieceSVG(t.c1||'#555', t.c2||'#222', t.border||'rgba(255,255,255,.1)');
        } else if (G.sameTheme) {
          const tag = document.createElement('span');
          tag.className = 'gp-player-tag';
          tag.textContent = isB ? 'P1' : 'P2';
          pd.appendChild(tag);
        }
        cell.appendChild(pd);
      }

      cell.addEventListener('click', () => onCellClick(r, c));
      el.appendChild(cell);
    }
  }
}

function buildQueenInner(isBlack) {
  const gold = '#f0c94a', shine = isBlack ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.6)';
  return `<svg class="queen-svg" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="18" fill="none" stroke="${gold}" stroke-width="1.5" opacity=".7"/>
    <rect x="8" y="25" width="24" height="5" rx="2.5" fill="${gold}" opacity=".95"/>
    <polygon points="9,25 12,13 16,22" fill="${gold}" opacity=".95"/>
    <polygon points="17,22 20,9 23,22" fill="${gold}"/>
    <polygon points="24,22 28,13 31,25" fill="${gold}" opacity=".95"/>
    <circle cx="20" cy="20" r="3" fill="${isBlack?'#fff':'#2c1b0e'}" opacity=".8"/>
    <ellipse cx="17" cy="15" rx="5" ry="3" fill="${shine}" transform="rotate(-20,17,15)"/>
  </svg>`;
}

function buildPawnPieceSVG(c1, c2, border) {
  const id = c1.replace(/[^a-z0-9]/gi,'');
  return `<svg viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;">
    <defs><radialGradient id="pg${id}" cx="38%" cy="30%">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </radialGradient></defs>
    <rect x="7" y="44" width="26" height="6" rx="3" fill="url(#pg${id})" stroke="${border}" stroke-width="1.2"/>
    <rect x="15" y="30" width="10" height="15" rx="4" fill="url(#pg${id})" stroke="${border}" stroke-width="1"/>
    <circle cx="20" cy="20" r="11" fill="url(#pg${id})" stroke="${border}" stroke-width="1.5"/>
    <ellipse cx="16" cy="16" rx="5" ry="3" fill="rgba(255,255,255,.28)" transform="rotate(-20,16,16)"/>
  </svg>`;
}

function animatePieceMove(from) {
  const cells = document.querySelectorAll('.gc');
  const cell  = cells[from.r * 8 + from.c];
  if (!cell) return;
  const piece = cell.querySelector('.gp');
  if (piece) { piece.classList.add('gp-moving'); setTimeout(() => piece.classList.remove('gp-moving'), 300); }
}

/* ── Cell interaction ── */
function onCellClick(r, c) {
  if (G.gameOver) return;
  if (G.mode === 'ai' && G.turn === WHITE) return;
  if (G.isOnlinePvP) {
    const myPlayerColor = G.myColor === 'black' ? BLACK : WHITE;
    if (G.turn !== myPlayerColor) { setStatus("⚠ It is your opponent's turn!"); return; }
  }
  if ((r + c) % 2 === 0) return;

  const piece = G.board[r][c];
  if (G.mustCapture) {
    const move = G.validMoves.find(m => m.r === r && m.c === c);
    if (move) executeMove(G.mustCapture, move);
    return;
  }
  if (G.selected) {
    const move = G.validMoves.find(m => m.r === r && m.c === c);
    if (move) { executeMove(G.selected, move); return; }
  }
  if (isOwn(piece, G.turn)) {
    const allCaps = getAllCaptures(G.board, G.turn);
    if (allCaps.length > 0 && getCaptureMovesFrom(G.board, r, c, G.turn, null).length === 0) {
      setStatus('⚠ You must capture! Select a piece that can capture.');
      return;
    }
    selectPiece(r, c);
    return;
  }
  G.selected = null; G.validMoves = []; renderBoard();
}

function selectPiece(r, c) {
  G.selected = { r, c };
  const allCaps = getAllCaptures(G.board, G.turn);
  if (allCaps.length > 0) {
    G.validMoves = getCaptureMovesFrom(G.board, r, c, G.turn, G.chainCaptured || null);
  } else {
    G.validMoves = getMovesForPiece(G.board, r, c, G.turn, false, null).filter(m => !m.capturedSquare);
  }
  renderBoard();
  setStatus(G.validMoves.length > 0 ? 'Choose a square to move' : 'No valid moves from here');
}

/* ── Execute one move step ── */
export function executeMove(from, move, isRemote = false) {
  stopCountdown();
  resetIdle();
  if (G.isOnlinePvP && !isRemote) {
    Socket.send('make_move', { gameId: G.gameId, playerId: getState('tgUserId'), from, move });
  }

  const caps = countCaptured(move);
  tgHaptic(caps > 0 ? 'success' : 'light');

  if (caps > 0 && G.soloKingPlayer !== null) {
    const opp = G.turn === BLACK ? WHITE : BLACK;
    if (G.soloKingPlayer === opp) {
      const cs = move.capturedSquare;
      if (cs && isKing(G.board[cs.mr][cs.mc])) { G.soloKingPlayer = null; G.soloKingMoves = 0; }
    }
  }

  if (!G.mustCapture) {
    G.history.push({
      board: G.board.map(row => [...row]), turn: G.turn,
      captured: { ...G.captured }, moveCount: G.moveCount,
      mustCapture: null, chainCaptured: null, timers: { ...G.timers },
      soloKingPlayer: G.soloKingPlayer, soloKingMoves: G.soloKingMoves,
    });
  }

  const wasKingBefore = isKing(G.board[from.r][from.c]);
  animatePieceMove(from);
  G.board = applyMove(G.board, from, move);
  G.captured[G.turn] += caps;
  G.moveCount++;

  if (move.capturedSquare) {
    const cells = document.querySelectorAll('.gc');
    const cc = cells[move.capturedSquare.mr * 8 + move.capturedSquare.mc];
    if (cc) { cc.classList.add('gc-captured'); setTimeout(() => cc.classList.remove('gc-captured'), 500); }
  }

  const landed = G.board[move.r][move.c];
  const justPromoted = !wasKingBefore && isKing(landed);
  if (!G.chainCaptured) G.chainCaptured = new Set();
  if (move.capturedSquare) G.chainCaptured.add(`${move.capturedSquare.mr},${move.capturedSquare.mc}`);

  if (caps > 0 && !justPromoted) {
    const moreCaps = getCaptureMovesFrom(G.board, move.r, move.c, G.turn, G.chainCaptured);
    if (moreCaps.length > 0) {
      G.mustCapture = { r: move.r, c: move.c };
      G.selected    = { r: move.r, c: move.c };
      G.validMoves  = moreCaps;
      updatePanels(); renderBoard();
      if (G.mode === 'ai' && G.turn === WHITE) {
        setStatus(`🤖 ${G.opponent ? G.opponent.name : 'AI'} continues capturing…`);
        setTimeout(doAIMove, G.aiThinkDelay ?? 500);
      } else {
        setStatus('⚡ Continue capturing! Choose next square.');
      }
      return;
    }
  }

  G.mustCapture = null; G.chainCaptured = null; G.selected = null; G.validMoves = [];
  updatePanels(); renderBoard();
  if (checkWin()) return;
  if (checkSoloKingRule(G.turn)) return;
  switchTurn();
}

function switchTurn() {
  G.turn = G.turn === BLACK ? WHITE : BLACK;
  if (G.debug) console.log('[switchTurn] New turn:', G.turn === BLACK ? 'BLACK' : 'WHITE');
  updateTurnIndicator();
  const moves = getAllMoves(G.board, G.turn);
  if (moves.length === 0) { endGame(G.turn === BLACK ? WHITE : BLACK, 'No moves available'); return; }

  if (G.soloKingPlayer !== null) {
    const remaining = G.SOLO_KING_LIMIT - G.soloKingMoves;
    setStatus(`⚠ Lone king rule: ${G.soloKingMoves}/${G.SOLO_KING_LIMIT} — ${remaining} moves left`);
  } else {
    setStatus(G.mode === 'ai' && G.turn === WHITE ? `🤖 ${G.opponent ? G.opponent.name : 'AI'} is thinking…` : turnMsg());
  }
  startCountdown();
  if (G.mode === 'ai' && G.turn === WHITE) setTimeout(doAIMove, G.aiThinkDelay ?? 600);
}

/* ── AI move dispatcher ── */
let _aiWorkerBusy = false;

function _apiBase() { return Socket.apiUrl || ''; }

async function _fetchLLMMove(moves) {
  const apiToken = getState('damaApiToken') || localStorage.getItem('dama_api_token') || '';
  const res = await fetch(`${_apiBase()}/ai/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiToken ? { 'X-API-Token': apiToken } : {}) },
    body: JSON.stringify({ board: G.board, moves, aiPlayer: WHITE, difficulty: G.difficulty }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}

function doAIMove() {
  if (G.debug) console.log('[doAIMove] started, turn:', G.turn === BLACK ? 'BLACK' : 'WHITE');
  if (G.gameOver) return;

  if (G.mustCapture) {
    const caps = getCaptureMovesFrom(G.board, G.mustCapture.r, G.mustCapture.c, WHITE, G.chainCaptured);
    if (caps.length === 0) {
      G.mustCapture = null; G.chainCaptured = null; G.selected = null; G.validMoves = [];
      updatePanels(); renderBoard();
      if (checkWin()) return;
      switchTurn(); return;
    }
    executeMove(G.mustCapture, caps[Math.floor(Math.random() * caps.length)]);
    return;
  }

  if (_aiWorkerBusy) return;
  _aiWorkerBusy = true;

  setTimeout(async () => {
    if (G.gameOver || G.mode !== 'ai' || G.turn !== WHITE) { _aiWorkerBusy = false; return; }
    const legalMoves = getAllMoves(G.board, WHITE, null);
    if (!legalMoves || legalMoves.length === 0) { _aiWorkerBusy = false; endGame(BLACK, 'AI has no moves'); return; }

    let chosenMove = null;
    try {
      const data = await _fetchLLMMove(legalMoves);
      if (data && data.move && !data.fallback) chosenMove = data.move;
    } catch (e) { if (G.debug) console.warn('[doAIMove] LLM failed, using Minimax:', e.message); }

    if (!chosenMove) {
      try { chosenMove = getBestAIMove(G.board, WHITE, G.difficulty); }
      catch (e) { console.error('[doAIMove] Minimax error:', e); }
    }

    _aiWorkerBusy = false;
    if (!chosenMove) { endGame(BLACK, 'AI has no moves'); return; }
    executeMove(chosenMove.from || { r: chosenMove.r, c: chosenMove.c }, chosenMove);
  }, 50);
}

/* ── Win / solo-king checks ── */
function checkWin() {
  let blacks = 0, whites = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (G.board[r][c] === BLACK || G.board[r][c] === B_KING) blacks++;
      if (G.board[r][c] === WHITE || G.board[r][c] === W_KING) whites++;
    }
  if (blacks === 0) { endGame(WHITE, 'All black pieces captured'); return true; }
  if (whites === 0) { endGame(BLACK, 'All white pieces captured'); return true; }
  return false;
}

function countPieces(board, player) {
  let n = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player)) n++;
  return n;
}

function hasSoloKing(board, player) {
  let pieces = 0, kings = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!isOwn(p, player)) continue;
      pieces++;
      if (isKing(p)) kings++;
    }
  return pieces === 1 && kings === 1;
}

function checkSoloKingRule(movingPlayer) {
  if (G.gameOver) return false;
  const opponent = movingPlayer === BLACK ? WHITE : BLACK;
  const opponentCount = countPieces(G.board, opponent);
  const movedHasSoloKing = hasSoloKing(G.board, movingPlayer);

  if (movedHasSoloKing && opponentCount <= 3) {
    if (G.soloKingPlayer !== movingPlayer) { G.soloKingPlayer = movingPlayer; G.soloKingMoves = 0; }
    G.soloKingMoves++;
    const playerName = movingPlayer === BLACK
      ? document.getElementById('p1name').textContent
      : document.getElementById('p2name').textContent;
    if (G.soloKingMoves >= G.SOLO_KING_LIMIT) {
      endGame(opponent, `${playerName}'s lone king failed to escape in ${G.SOLO_KING_LIMIT} moves`);
      return true;
    }
    setStatus(`⚠ Lone king: ${G.soloKingMoves}/${G.SOLO_KING_LIMIT} moves used — must escape!`);
  } else {
    if (G.soloKingPlayer === movingPlayer) { G.soloKingPlayer = null; G.soloKingMoves = 0; }
    if (G.soloKingPlayer !== null && !hasSoloKing(G.board, G.soloKingPlayer)) {
      G.soloKingPlayer = null; G.soloKingMoves = 0;
    }
  }
  return false;
}

/* ── endGame ── */
export function endGame(winner, reason, isRemote = false, settlement = null) {
  G.gameOver = true;
  clearInterval(G.timerInterval);
  stopCountdown();
  ['cd-turn-1','cd-turn-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.getElementById('panel1')?.classList.remove('ss-danger');
  document.getElementById('panel2')?.classList.remove('ss-danger');

  const myId  = getState('tgUserId');
  const oppId = G.opponent?.id;

  if (G.isOnlinePvP && !isRemote) {
    const myColor  = G.myColor === 'black' ? BLACK : WHITE;
    const winnerId = winner === BLACK ? (myColor === BLACK ? myId : oppId)
                   : winner === WHITE ? (myColor === WHITE ? myId : oppId)
                   : null;
    Socket.send('game_over', {
      gameId: G.gameId, winnerId, reason,
      durationSec: Math.floor((Date.now() - G.startTime) / 1000),
      moveCount: G.moveCount,
    });
  }

  if (myId && !isRemote) {
    let result = winner === null || winner === undefined ? 'draw'
               : winner === BLACK ? 'win' : 'loss';

    if (!G.isOnlinePvP) {
      const durationSec = Math.floor((Date.now() - G.startTime) / 1000);
      const apiToken    = getState('damaApiToken') || localStorage.getItem('dama_api_token') || '';
      const betAmount   = G.betAmount || getState('currentBet') || 0;

      if (G.mode === 'ai' && betAmount > 0 && G.gameId && myId && oppId) {
        const aiResult = winner === null ? 'draw' : winner === BLACK ? 'win' : 'loss';
        fetch(Socket.apiUrl + '/games/finish-ai-bet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': apiToken },
          body: JSON.stringify({ gameId: G.gameId, humanId: myId, aiId: oppId, result: aiResult, betAmount, durationSec, moveCount: G.moveCount }),
        }).then(async res => {
          if (res.ok) {
            const json = await res.json();
            const s    = json?.data?.settlement;
            if (s && typeof s.winnerPayout === 'number') {
              const prizeEl = document.getElementById('ms-prize');
              if (prizeEl && aiResult === 'win') prizeEl.textContent = s.winnerPayout.toLocaleString();
            }
            const _rb = getState('refreshBalance');
            if (typeof _rb === 'function') setTimeout(() => _rb(true), 500);
            setTimeout(() => {
              PlayerRegistry.fetchPlayers().then(() => renderPlayerList());
              PlayerRegistry.fetchCurrentPlayer(myId);
            }, 600);
          }
        }).catch(() => {});
      } else {
        let winnerDbId = winner === BLACK ? myId : winner === WHITE && oppId ? oppId : null;
        fetch(Socket.apiUrl + '/games/finish-local', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Token': apiToken },
          body: JSON.stringify({ mode: G.mode, player1Id: myId, player2Id: oppId || null, winnerId: winnerDbId, result, durationSec, moveCount: G.moveCount }),
        }).then(res => {
          if (res.ok) setTimeout(() => PlayerRegistry.fetchPlayers().then(() => renderPlayerList()), 300);
        }).catch(() => {});
      }
    }
  }

  if (myId && PlayerRegistry) {
    if      (winner === BLACK) { PlayerRegistry.recordResult(myId, 'win');  if (oppId) PlayerRegistry.recordResult(oppId, 'loss'); }
    else if (winner === WHITE) { PlayerRegistry.recordResult(myId, 'loss'); if (oppId) PlayerRegistry.recordResult(oppId, 'win');  }
    else                       { PlayerRegistry.recordResult(myId, 'draw'); if (oppId) PlayerRegistry.recordResult(oppId, 'draw'); }
    setTimeout(() => PlayerRegistry.fetchPlayers().then(() => renderPlayerList()), 800);
  }

  const wName = winner === BLACK
    ? document.getElementById('p1name').textContent
    : document.getElementById('p2name').textContent;

  let iLocalWin = false;
  if (winner !== null && winner !== undefined) {
    if (G.isOnlinePvP) {
      iLocalWin = (winner === (G.myColor === 'black' ? BLACK : WHITE));
    } else {
      iLocalWin = (winner === BLACK);
    }
  }

  const betAmt = G.betAmount || getState('currentBet') || 0;
  let winnerPayout = 0;
  if (settlement && typeof settlement.winnerPayout === 'number') winnerPayout = settlement.winnerPayout;
  else if (betAmt > 0) winnerPayout = Math.round(betAmt * 2 * 0.9);

  setTimeout(() => showWinModal(wName, reason, iLocalWin, betAmt, winnerPayout), 400);
}

/* ── UI helpers ── */
function setStatus(msg) {
  const el = document.getElementById('gameStatus');
  if (el) el.textContent = msg;
}

function turnMsg() {
  if (G.mode === 'pvp') {
    const name = G.turn === BLACK
      ? document.getElementById('p1name').textContent
      : document.getElementById('p2name').textContent;
    return `${name}'s turn`;
  }
  if (G.turn === BLACK) return 'Your turn';
  return `🤖 ${G.opponent ? G.opponent.name : 'AI'} is thinking…`;
}

function updateTurnIndicator() {
  const t1 = document.getElementById('p1turn');
  const t2 = document.getElementById('p2turn');
  if (!t1 || !t2) return;
  t1.classList.toggle('hidden', G.turn !== BLACK);
  t2.classList.toggle('hidden', G.turn !== WHITE);
  document.getElementById('panel1')?.classList.toggle('ss-active', G.turn === BLACK);
  document.getElementById('panel2')?.classList.toggle('ss-active', G.turn === WHITE);
  const iAmBlack = !G.isOnlinePvP || G.myColor === 'black';
  const myTurnEl  = iAmBlack ? t1 : t2;
  const oppTurnEl = iAmBlack ? t2 : t1;
  if (myTurnEl)  myTurnEl.textContent  = 'YOUR TURN';
  if (oppTurnEl) oppTurnEl.textContent = G.mode === 'ai' ? "AI'S TURN" : 'THEIR TURN';
}

function updatePanels() {
  document.getElementById('p1score').textContent = G.captured[BLACK];
  document.getElementById('p2score').textContent = G.captured[WHITE];
  renderCapturedPieces();
}

function renderCapturedPieces() {
  ['p1captured','p2captured'].forEach((id, i) => {
    const player = i === 0 ? BLACK : WHITE;
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    for (let k = 0; k < G.captured[player]; k++) {
      const dot = document.createElement('div');
      dot.className = 'cap-dot ' + (player === BLACK ? 'cap-w' : 'cap-b');
      el.appendChild(dot);
    }
  });
}

/* ── Timer ── */
function startTimer() {
  G.lastTick = Date.now();
  G.timerInterval = setInterval(() => {
    const now = Date.now(), dt = (now - G.lastTick) / 1000;
    G.lastTick = now;
    if (!G.gameOver) {
      G.timers[G.turn] = (G.timers[G.turn] || 0) + dt;
      const el = G.turn === BLACK ? document.getElementById('p1timer') : document.getElementById('p2timer');
      if (el) el.textContent = formatTime(G.timers[G.turn]);
    }
  }, 500);
}

function formatTime(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

/* ── Turn countdown ── */
function stopCountdown() {
  if (G.countdownInterval) { clearInterval(G.countdownInterval); G.countdownInterval = null; }
}

function updateCountdownUI() {
  const secs = Math.ceil(G.countdown), urgent = secs <= 5;
  const isBlackTurn = G.turn === BLACK;
  [document.getElementById('cd-turn-1'), document.getElementById('cd-turn-2')].forEach(el => {
    if (!el) return;
    el.textContent  = secs;
    el.className    = 'cd-turn' + (urgent ? ' cd-urgent' : '');
    el.style.display = 'flex';
  });
  document.getElementById('panel1')?.classList.toggle('ss-danger', isBlackTurn  && urgent);
  document.getElementById('panel2')?.classList.toggle('ss-danger', !isBlackTurn && urgent);
  updateStrikeDots(BLACK, G.strikes[BLACK] || 0);
  updateStrikeDots(WHITE, G.strikes[WHITE] || 0);
}

function updateStrikeDots(player, count) {
  const prefix = player === BLACK ? 'p1s' : 'p2s';
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(prefix + i);
    if (dot) dot.classList.toggle('filled', i <= count);
  }
}

function startCountdown() {
  stopCountdown();
  if (G.mode === 'ai' && G.turn === WHITE) return;
  G.countdown = G.TURN_SECONDS;
  updateCountdownUI();
  G.countdownInterval = setInterval(() => {
    if (G.gameOver) { stopCountdown(); return; }
    G.countdown -= 1;
    updateCountdownUI();
    if (G.countdown <= 0) { stopCountdown(); onTurnTimeout(); }
  }, 1000);
}

function onTurnTimeout() {
  if (G.gameOver) return;
  const timedOutPlayer = G.turn;
  G.strikes[timedOutPlayer] = (G.strikes[timedOutPlayer] || 0) + 1;
  const strikes    = G.strikes[timedOutPlayer];
  const playerName = timedOutPlayer === BLACK
    ? document.getElementById('p1name').textContent
    : document.getElementById('p2name').textContent;
  tgHaptic('warning');
  if (strikes >= G.MAX_STRIKES) {
    endGame(timedOutPlayer === BLACK ? WHITE : BLACK, `${playerName} timed out 3 times`);
  } else {
    setStatus(`⏱ ${playerName} timed out! (${strikes}/${G.MAX_STRIKES} strikes) — turn passed`);
    const statusEl = document.getElementById('gameStatus');
    if (statusEl) { statusEl.style.color = '#e74c3c'; setTimeout(() => { statusEl.style.color = ''; }, 1500); }
    G.selected = null; G.validMoves = []; G.mustCapture = null; G.chainCaptured = null;
    renderBoard();
    switchTurn();
  }
}

/* ── Win modal ── */
function showWinModal(name, reason, iLocalWin = false, betAmt = 0, winnerPayout = 0) {
  document.getElementById('winTitle').textContent    = name + ' Wins!';
  document.getElementById('winSub').textContent      = reason + '. Well played!';
  document.getElementById('ms-moves').textContent    = G.moveCount;
  document.getElementById('ms-time').textContent     = formatTime((G.timers[BLACK]||0) + (G.timers[WHITE]||0));
  document.getElementById('ms-captured').textContent = G.captured[BLACK] + G.captured[WHITE];

  const prizeWrap = document.getElementById('ms-prize-wrap');
  const prizeEl   = document.getElementById('ms-prize');
  if (prizeWrap && prizeEl) {
    const prize = winnerPayout > 0 ? winnerPayout : (betAmt > 0 ? Math.round(betAmt * 2 * 0.9) : 0);
    if (iLocalWin && prize > 0) { prizeEl.textContent = prize.toLocaleString(); prizeWrap.classList.remove('hidden'); }
    else prizeWrap.classList.add('hidden');
  }

  const modal = document.getElementById('winModal');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.classList.add('modal-show'));

  const playAgainBtn = document.getElementById('playAgainBtn');
  const menuBtn      = document.getElementById('menuBtn2');
  const originalLabel = playAgainBtn?.innerHTML || '';

  clearRematchUi();

  if (G.isOnlinePvP && G.opponent?.id) {
    const updateLabel = () => {
      if (playAgainBtn) playAgainBtn.innerHTML = `<span>↺</span> Play Again <div class="btn-shine"></div>`;
    };
    updateLabel();
    const onClick = () => {
      clearRematchUi();
      requestRematch();
    };
    playAgainBtn?.addEventListener('click', onClick, { once: true });
    menuBtn?.addEventListener('click', () => {
      hideRematchPrompt();
      modal.classList.add('hidden'); modal.classList.remove('modal-show');
      clearInterval(G.timerInterval);
      showScreen('mainMenu');
      renderPlayerList();
    });
    return;
  }

  if (G.mode === 'ai' || G.mode === 'pvp') {
    const startFreshGame = () => {
      modal.classList.add('hidden');
      modal.classList.remove('modal-show');
      if (G.mode === 'ai') {
        startGame('ai', G.opponent || null);
      } else {
        startGame('pvp', G.opponent || null);
      }
    };

    playAgainBtn?.addEventListener('click', () => {
      startFreshGame();
    }, { once: true });

    menuBtn?.addEventListener('click', () => {
      modal.classList.add('hidden'); modal.classList.remove('modal-show');
      clearInterval(G.timerInterval);
      showScreen('mainMenu');
      renderPlayerList();
    });
    return;
  }

  let remaining = 10;
  function updateAutoLabel() {
    if (playAgainBtn)
      playAgainBtn.innerHTML = `<span>↺</span> Play Again <span style="opacity:.6;font-size:.8em;">(${remaining}s)</span>`;
  }
  updateAutoLabel();

  function cancelAuto() {
    clearInterval(autoTimer);
    if (playAgainBtn) playAgainBtn.innerHTML = originalLabel;
    playAgainBtn?.removeEventListener('click', cancelAuto);
    menuBtn?.removeEventListener('click', cancelAuto);
  }
  playAgainBtn?.addEventListener('click', cancelAuto);
  menuBtn?.addEventListener('click', cancelAuto);

  const autoTimer = setInterval(() => {
    remaining -= 1; updateAutoLabel();
    if (remaining <= 0) {
      clearInterval(autoTimer);
      if (playAgainBtn) playAgainBtn.innerHTML = originalLabel;
      modal.classList.add('hidden'); modal.classList.remove('modal-show');
      clearInterval(G.timerInterval);
      showScreen('mainMenu');
      renderPlayerList();
    }
  }, 1000);
}

export function requestRematch() {
  if (!G.isOnlinePvP || !G.opponent?.id || !getState('tgUserId')) return;
  const opponentId = G.opponent.id;
  const gameId = G.gameId;
  setRematchWaitingState('Waiting for opponent to accept…');
  Socket.send('rematch_request', { opponentId, gameId, requesterId: getState('tgUserId') });
  if (rematchTimer) clearTimeout(rematchTimer);
  rematchTimer = setTimeout(() => {
    rematchTimer = null;
    handleRematchDeclined({ reason: 'timeout' });
  }, 45000);
}

export function handleIncomingRematchRequest(msg) {
  const requesterId = msg?.requesterId || msg?.playerId || msg?.opponentId || null;
  if (!requesterId) return;
  const displayName = msg?.requesterName || G.opponent?.name || 'Your opponent';
  showRematchPrompt(displayName, () => {
    Socket.send('rematch_accepted', { opponentId: requesterId, gameId: msg?.gameId || G.gameId, accepterId: getState('tgUserId') });
    startRematchGame();
  }, () => {
    Socket.send('rematch_declined', { opponentId: requesterId, gameId: msg?.gameId || G.gameId, declinerId: getState('tgUserId') });
    hideRematchPrompt();
    const status = document.getElementById('gameStatus');
    if (status) status.textContent = 'Rematch declined.';
    showScreen('mainMenu');
    renderPlayerList();
  });
}

export function handleRematchAccepted(msg) {
  if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
  clearRematchUi();
  hideRematchPrompt();
  const modal = document.getElementById('winModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('modal-show'); }
  startRematchGame();
}

export function handleRematchDeclined(msg) {
  if (rematchTimer) { clearTimeout(rematchTimer); rematchTimer = null; }
  clearRematchUi();
  hideRematchPrompt();
  const modal = document.getElementById('winModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('modal-show'); }
  const status = document.getElementById('gameStatus');
  if (status) status.textContent = msg?.reason === 'timeout' ? 'Opponent did not respond to the rematch request.' : 'Opponent declined the rematch.';
  showScreen('mainMenu');
  renderPlayerList();
}

/* ── Undo ── */
export function doUndo() {
  if (G.history.length === 0) return;
  if (G.mode === 'ai' && G.aiAllowUndo === false) return;
  stopCountdown();
  const steps = G.mode === 'ai' ? 2 : 1;
  for (let i = 0; i < steps && G.history.length > 0; i++) {
    const prev       = G.history.pop();
    G.board          = prev.board;
    G.turn           = prev.turn;
    G.captured       = prev.captured;
    G.moveCount      = prev.moveCount;
    G.mustCapture    = prev.mustCapture;
    G.chainCaptured  = prev.chainCaptured;
    G.timers         = prev.timers;
    G.soloKingPlayer = prev.soloKingPlayer ?? null;
    G.soloKingMoves  = prev.soloKingMoves  ?? 0;
  }
  G.selected = null; G.validMoves = []; G.gameOver = false;
  updatePanels(); updateTurnIndicator(); renderBoard(); setStatus(turnMsg());
  startCountdown();
}

/* ── Opponent theme ── */
function applyOpponentTheme(theme) {
  const root = document.documentElement;
  if (theme) {
    root.style.setProperty('--piece-w1', theme.c1);
    root.style.setProperty('--piece-w2', theme.c2);
    root.style.setProperty('--piece-w3', theme.c3);
    root.style.setProperty('--piece-wBorder', theme.border);
    root.style.setProperty('--piece-wShadow', theme.shadow);
  } else {
    root.style.setProperty('--piece-w1', '#ffffff');
    root.style.setProperty('--piece-w2', '#e0e0e0');
    root.style.setProperty('--piece-w3', '#b0b0b0');
    root.style.setProperty('--piece-wBorder', 'rgba(0,0,0,.08)');
    root.style.setProperty('--piece-wShadow', 'rgba(255,255,255,.95)');
  }
}

/* ── AI config loader ── */
function loadAIConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('dama_ai_config')) || {};
    return {
      difficulty: cfg.difficulty || 'medium',
      depth:      typeof cfg.depth === 'number' ? cfg.depth : null,
      thinkDelay: typeof cfg.thinkDelay === 'number' ? cfg.thinkDelay : 600,
      aiName:     cfg.aiName    || 'Computer 🤖',
      allowUndo:  cfg.allowUndo !== false,
    };
  } catch {
    return { difficulty: 'medium', depth: null, thinkDelay: 600, aiName: 'Computer 🤖', allowUndo: true };
  }
}

/* ── startGame (public entry point) ── */
export function startGame(mode, opponentOrNull) {
  if (G.timerInterval) clearInterval(G.timerInterval);
  G = freshState();
  G.mode = mode;
  _aiWorkerBusy = false;

  if (mode === 'pvp' && getState('activeOnlineGame')) {
    const aog     = getState('activeOnlineGame');
    G.isOnlinePvP = true;
    G.myColor     = aog.myColor;
    G.gameId      = aog.gameId;
    G.betAmount   = aog.betAmount;

    if (aog.history && aog.history.length > 0) {
      for (const h of aog.history) {
        const m = JSON.parse(h.move_data);
        G.board = applyMove(G.board, m.from, m.move);
        G.moveCount++;
      }
      G.turn = aog.turn === 'black' ? BLACK : WHITE;
      let blackPieces = 0, whitePieces = 0;
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
          const p = G.board[r][c];
          if (p === BLACK || p === B_KING) blackPieces++;
          if (p === WHITE || p === W_KING) whitePieces++;
        }
      G.captured[BLACK] = 12 - whitePieces;
      G.captured[WHITE] = 12 - blackPieces;
    }
  } else {
    if (getState('tempGameId')) {
      G.gameId = getState('tempGameId');
      setState('tempGameId', null);
    } else {
      const ts = Date.now().toString(36).toUpperCase();
      const rd = Math.random().toString(36).slice(2, 6).toUpperCase();
      G.gameId = (mode === 'ai' ? 'AI' : 'LOC') + '-' + ts + '-' + rd;
    }
    if (getState('tempBetAmt') !== undefined) {
      G.betAmount = getState('tempBetAmt');
      setState('currentBet', getState('tempBetAmt'));
      setState('tempBetAmt', undefined);
    }
  }

  const aiCfg = loadAIConfig();
  if (mode === 'ai' && opponentOrNull && typeof opponentOrNull === 'object') {
    G.opponent   = opponentOrNull;
    G.difficulty = opponentOrNull.aiPct !== undefined ? opponentOrNull.aiPct : (opponentOrNull.difficulty || 'medium');
  } else {
    G.opponent   = (mode === 'pvp' && opponentOrNull && typeof opponentOrNull === 'object') ? opponentOrNull : null;
    G.difficulty = mode === 'ai' ? (aiCfg.depth || aiCfg.difficulty) : 'medium';
  }
  G.aiThinkDelay = mode === 'ai' ? aiCfg.thinkDelay : 600;
  G.aiAllowUndo  = mode === 'ai' ? aiCfg.allowUndo  : true;

  const myName  = getState('tgUserName') || 'Player 1';
  const aiName  = mode === 'ai' ? aiCfg.aiName : 'Player 2';
  const oppName = G.opponent ? G.opponent.name : aiName;

  const iAmBlack   = !G.isOnlinePvP || G.myColor === 'black';
  const gameScreen = document.getElementById('gameScreen');
  if (iAmBlack) gameScreen?.setAttribute('data-me', 'black');
  else          gameScreen?.setAttribute('data-me', 'white');

  const myPanelId  = iAmBlack ? 'panel1' : 'panel2';
  const oppPanelId = iAmBlack ? 'panel2' : 'panel1';
  const myNameEl   = document.getElementById(iAmBlack ? 'p1name' : 'p2name');
  const oppNameEl  = document.getElementById(iAmBlack ? 'p2name' : 'p1name');
  if (myNameEl)  myNameEl.textContent  = myName;
  if (oppNameEl) oppNameEl.textContent = oppName;
  document.getElementById('gameModeLabel').textContent = `vs ${oppName}`;

  const av2 = document.querySelector(`#${oppPanelId} .ss-avatar`);
  if (av2) {
    if (G.opponent?.photo) {
      av2.innerHTML = `<img src="${G.opponent.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`;
      av2.className = 'ss-avatar';
    } else if (G.opponent) {
      av2.textContent = (G.opponent.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      av2.className = 'ss-avatar'; av2.style.fontSize = '.7rem';
    } else {
      av2.textContent = mode === 'ai' ? '🤖' : '♙';
      av2.className = 'ss-avatar white-avatar'; av2.style.fontSize = '';
    }
  }

  const myAv = document.querySelector(`#${myPanelId} .ss-avatar`);
  if (myAv) { myAv.className = 'ss-avatar black-avatar'; myAv.textContent = '♟'; myAv.style.fontSize = ''; }

  document.querySelectorAll('.ss-me-badge').forEach(el => el.remove());
  const myInfo = document.querySelector(`#${myPanelId} .ss-info`);
  if (myInfo) {
    const badge = document.createElement('span');
    badge.className = 'ss-me-badge'; badge.textContent = 'YOU';
    myInfo.appendChild(badge);
  }

  document.getElementById('p1timer').textContent = '00:00';
  document.getElementById('p2timer').textContent = '00:00';

  showScreen('gameScreen');

  const gameIdBadge = document.getElementById('gameIdBadge');
  const gameIdValue = document.getElementById('gameIdValue');
  if (gameIdBadge && gameIdValue && G.gameId) {
    gameIdValue.textContent = G.gameId; gameIdBadge.classList.remove('hidden');
  } else if (gameIdBadge) { gameIdBadge.classList.add('hidden'); }

  const _pt = getState('pieceTheme');
  if (_pt) applyPieceTheme(_pt);

  const myThemeId  = _pt?.id || 'classic';
  const oppThemeId = G.opponent?.pieceThemeId || 'classic';
  if (G.opponent?.pieceThemeId) {
    const oppTheme = PIECE_THEMES.find(t => t.id === G.opponent.pieceThemeId);
    if (oppTheme) applyOpponentTheme(oppTheme);
  } else { applyOpponentTheme(null); }

  G.sameTheme = (myThemeId === oppThemeId);
  renderBoard(); updatePanels(); updateTurnIndicator(); setStatus(turnMsg()); startTimer(); startCountdown();
  updateStrikeDots(BLACK, 0); updateStrikeDots(WHITE, 0);

  const modal = document.getElementById('winModal');
  modal.classList.add('hidden'); modal.classList.remove('modal-show');
}
