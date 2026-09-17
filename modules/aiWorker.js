/* ═══════════════════════════════════════════════════
   aiWorker.js  — runs AI search off the main thread
   Receives: { board, aiPlayer, difficulty }
   Posts back: { from, move }
═══════════════════════════════════════════════════ */

const EMPTY  = 0;
const BLACK  = 1;
const WHITE  = 2;
const B_KING = 3;
const W_KING = 4;

function isOwn(piece, player) {
  if (player === BLACK) return piece === BLACK || piece === B_KING;
  return piece === WHITE || piece === W_KING;
}
function isEnemy(piece, player) {
  if (piece === EMPTY) return false;
  return !isOwn(piece, player);
}
function isKing(piece) { return piece === B_KING || piece === W_KING; }

/* ── Move generation ── */
function getNormalMoves(board, r, c, player, onlyCaptures) {
  const moves = [];
  if (!onlyCaptures) {
    const fwdDirs = player === BLACK ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
    for (const [dr, dc] of fwdDirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === EMPTY)
        moves.push({ r: nr, c: nc, capturedSquare: null });
    }
  }
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    const mr = r + dr, mc = c + dc;
    const lr = r + 2*dr, lc = c + 2*dc;
    if (mr < 0 || mr >= 8 || mc < 0 || mc >= 8) continue;
    if (lr < 0 || lr >= 8 || lc < 0 || lc >= 8) continue;
    if (!isEnemy(board[mr][mc], player)) continue;
    if (board[lr][lc] !== EMPTY) continue;
    moves.push({ r: lr, c: lc, capturedSquare: { mr, mc } });
  }
  return moves;
}

function getQueenMoves(board, r, c, player, onlyCaptures, alreadyCaptured) {
  const moves = [];
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let cr = r + dr, cc2 = c + dc;
    let foundEnemy = null;
    while (cr >= 0 && cr < 8 && cc2 >= 0 && cc2 < 8) {
      const sq = board[cr][cc2];
      if (foundEnemy === null) {
        if (sq === EMPTY) {
          if (!onlyCaptures) moves.push({ r: cr, c: cc2, capturedSquare: null });
        } else if (isEnemy(sq, player)) {
          const key = `${cr},${cc2}`;
          if (alreadyCaptured && alreadyCaptured.has(key)) break;
          foundEnemy = { mr: cr, mc: cc2 };
        } else break;
      } else {
        if (sq === EMPTY) {
          moves.push({ r: cr, c: cc2, capturedSquare: { mr: foundEnemy.mr, mc: foundEnemy.mc } });
        } else break;
      }
      cr += dr; cc2 += dc;
    }
  }
  return moves;
}

function getMovesForPiece(board, r, c, player, onlyCaptures = false, alreadyCaptured = null) {
  if (isKing(board[r][c])) return getQueenMoves(board, r, c, player, onlyCaptures, alreadyCaptured);
  return getNormalMoves(board, r, c, player, onlyCaptures);
}

function getCaptureMovesFrom(board, r, c, player, alreadyCaptured) {
  return getMovesForPiece(board, r, c, player, true, alreadyCaptured)
    .filter(m => m.capturedSquare !== null);
}

function getAllCaptures(board, player) {
  const result = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player))
        getCaptureMovesFrom(board, r, c, player, null)
          .forEach(m => result.push({ from: { r, c }, ...m }));
  return result;
}

function getAllMoves(board, player) {
  const caps = getAllCaptures(board, player);
  if (caps.length > 0) return caps;
  const result = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player))
        getMovesForPiece(board, r, c, player, false, null)
          .filter(m => !m.capturedSquare)
          .forEach(m => result.push({ from: { r, c }, ...m }));
  return result;
}

function applyMove(board, from, move) {
  const nb = board.map(row => [...row]);
  const piece = nb[from.r][from.c];
  if (move.capturedSquare) nb[move.capturedSquare.mr][move.capturedSquare.mc] = EMPTY;
  nb[from.r][from.c] = EMPTY;
  nb[move.r][move.c] = piece;
  if (piece === BLACK && move.r === 0) nb[move.r][move.c] = B_KING;
  if (piece === WHITE && move.r === 7) nb[move.r][move.c] = W_KING;
  return nb;
}

/* ── Upgraded Piece-Square Tables (matching engine.js) ── */
const PST_MAN = [
  [0,  0,  0,  0,  0,  0,  0,  0],  // row 0 — promotion row for WHITE
  [5,  0,  5,  0,  5,  0,  5,  0],
  [0,  4,  0,  4,  0,  4,  0,  4],
  [3,  0,  3,  0,  3,  0,  3,  0],
  [0,  3,  0,  4,  0,  4,  0,  3],  // center bonus
  [2,  0,  3,  0,  3,  0,  2,  0],  // center bonus
  [0,  2,  0,  2,  0,  2,  0,  2],
  [1,  0,  1,  0,  1,  0,  1,  0],  // starting row
];

const PST_KING = [
  [-2, -1, -2, -1, -2, -1, -2, -1],
  [-1,  1, -1,  2, -1,  2, -1, -1],
  [-2,  2,  3,  4,  4,  3,  2, -2],
  [-1,  2,  4,  5,  5,  4,  2, -1],
  [-1,  2,  4,  5,  5,  4,  2, -1],
  [-2,  2,  3,  4,  4,  3,  2, -2],
  [-1,  1, -1,  2, -1,  2, -1, -1],
  [-2, -1, -2, -1, -2, -1, -2, -1],
];

function backRankPieces(board, player) {
  let cnt = 0;
  const rows = player === WHITE ? 0 : 7;
  for (let c = 0; c < 8; c++) {
    const p = board[rows][c];
    if (p !== EMPTY && isOwn(p, player) && !isKing(p)) cnt++;
  }
  return cnt;
}

function evaluate(board, aiPlayer) {
  const opp = aiPlayer === BLACK ? WHITE : BLACK;
  let score = 0;

  let aiPieces = 0, oppPieces = 0;
  let aiKings  = 0, oppKings  = 0;
  let aiBackRow = 0, oppBackRow = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === EMPTY) continue;

      const king = isKing(p);
      const mine = isOwn(p, aiPlayer);

      // Material: man=100, king=320
      const matVal = king ? 320 : 100;

      // Piece-square table bonus
      let pstVal;
      if (king) {
        pstVal = PST_KING[r][c] * 4;
      } else {
        const isPieceBlack = (p === BLACK || p === B_KING);
        const pstRow = isPieceBlack ? r : (7 - r);
        pstVal = PST_MAN[pstRow][c] * 3;
      }

      // Back-rank defence bonus
      if (!king) {
        if (mine && ((aiPlayer === WHITE && r === 0) || (aiPlayer === BLACK && r === 7))) aiBackRow++;
        if (!mine && ((aiPlayer === WHITE && r === 7) || (aiPlayer === BLACK && r === 0))) oppBackRow++;
      }

      if (mine) {
        score += matVal + pstVal;
        if (king) aiKings++; else aiPieces++;
      } else {
        score -= matVal + pstVal;
        if (king) oppKings++; else oppPieces++;
      }
    }
  }

  const aiTotal  = aiPieces  + aiKings;
  const oppTotal = oppPieces + oppKings;

  // Mobility
  const aiMoves  = getAllMoves(board, aiPlayer).length;
  const oppMoves = getAllMoves(board, opp).length;
  score += (aiMoves - oppMoves) * 5;

  // Safety
  score += (aiBackRow - oppBackRow) * 10;

  // Threats
  const aiCaptures  = getAllCaptures(board, aiPlayer).length;
  const oppCaptures = getAllCaptures(board, opp).length;
  score += (aiCaptures - oppCaptures) * 15;

  // Endgame
  if (aiTotal > oppTotal) {
    score += (aiTotal - oppTotal) * 20;
    score += aiKings * 30;
  }

  if (aiTotal === 1 && aiKings === 1 && oppTotal >= 3) score -= 200;

  return score;
}

/* ── Transposition table (matching engine.js TT_SIZE) ── */
const TT_SIZE  = 1 << 21;   // 2 097 152 slots
const ttTable  = new Array(TT_SIZE);
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
  if (slot.flag === TT_EXACT)                        return slot.score;
  if (slot.flag === TT_LOWER && slot.score >= beta)  return slot.score;
  if (slot.flag === TT_UPPER && slot.score <= alpha) return slot.score;
  return null;
}

function ttPut(hash, depth, score, flag) {
  const idx = (hash >>> 0) % TT_SIZE;
  const old = ttTable[idx];
  if (!old || old.depth <= depth) ttTable[idx] = { hash, depth, score, flag };
}

/* ── Move ordering ── */
function orderMoves(moves, board) {
  return moves.slice().sort((a, b) => {
    const aCapture = a.capturedSquare ? 1 : 0;
    const bCapture = b.capturedSquare ? 1 : 0;
    if (aCapture !== bCapture) return bCapture - aCapture;
    const fromA = a.from || a;
    const fromB = b.from || b;
    const aKing = isKing(board[fromA.r]?.[fromA.c] ?? EMPTY) ? 1 : 0;
    const bKing = isKing(board[fromB.r]?.[fromB.c] ?? EMPTY) ? 1 : 0;
    return bKing - aKing;
  });
}

/* ── Alpha-beta ── */
function alphaBeta(board, depth, alpha, beta, maximizing, aiPlayer) {
  const hash   = boardHash(board);
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

  const ordered   = orderMoves(moves, board);
  const origAlpha = alpha;
  let best        = maximizing ? -Infinity : Infinity;

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

/* ── Main search ── */
function getBestMove(board, aiPlayer, difficulty) {
  let maxDepth, timeBudget, randomChance;

  if (typeof difficulty === 'number') {
    const pct = Math.max(1, Math.min(100, difficulty));
    if      (pct <= 20) { maxDepth =  2; timeBudget = 150;  randomChance = 0.90; }
    else if (pct <= 40) { maxDepth =  3; timeBudget = 250;  randomChance = 0.60; }
    else if (pct <= 60) { maxDepth =  5; timeBudget = 500;  randomChance = 0.10; }
    else if (pct <= 80) { maxDepth =  7; timeBudget = 1200; randomChance = 0.00; }
    else if (pct <= 90) { maxDepth = 10; timeBudget = 2500; randomChance = 0.00; }
    else                { maxDepth = 14; timeBudget = 4000; randomChance = 0.00; }
  } else {
    if (difficulty === 'easy')      { maxDepth = 3;  timeBudget = 250;  randomChance = 0.60; }
    else if (difficulty === 'hard') { maxDepth = 7;  timeBudget = 1200; randomChance = 0.00; }
    else                            { maxDepth = 5;  timeBudget = 500;  randomChance = 0.10; }
  }

  const moves = getAllMoves(board, aiPlayer);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  if (randomChance > 0 && Math.random() < randomChance)
    return moves[Math.floor(Math.random() * moves.length)];

  const ordered  = orderMoves(moves, board);
  const deadline = Date.now() + timeBudget;
  let bestMove   = ordered[0];

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() >= deadline) break;

    let depthBest = -Infinity;
    let depthMove = ordered[0];
    let timedOut  = false;

    for (const m of ordered) {
      if (Date.now() >= deadline) { timedOut = true; break; }
      const from  = m.from || { r: m.r, c: m.c };
      const nb    = applyMove(board, from, m);
      const score = alphaBeta(nb, depth - 1, -Infinity, Infinity, false, aiPlayer);
      if (score > depthBest) { depthBest = score; depthMove = m; }
    }

    if (!timedOut) bestMove = depthMove;
    if (Date.now() >= deadline) break;
  }

  return bestMove;
}

/* ── Worker message handler ── */
self.onmessage = function(e) {
  const { board, aiPlayer, difficulty } = e.data;
  ttTable.fill(undefined);
  const move = getBestMove(board, aiPlayer, difficulty);
  self.postMessage(move);
};
