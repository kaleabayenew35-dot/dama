/* ═══════════════════════════════════════════════════
   modules/moveValidator.js
   Pure move / capture logic — no DOM, no side-effects.
   This is the highest-risk module (real-money game):
   all functions here are unit-tested in tests/.
═══════════════════════════════════════════════════ */

/* ── Constants ── */
export const EMPTY  = 0;
export const BLACK  = 1;   // Player 1 – moves up (rows 7→0)
export const WHITE  = 2;   // Player 2 / AI – moves down (rows 0→7)
export const B_KING = 3;
export const W_KING = 4;

/* ── Piece helpers ── */
export function isOwn(piece, player) {
  if (player === BLACK) return piece === BLACK || piece === B_KING;
  return piece === WHITE || piece === W_KING;
}
export function isEnemy(piece, player) {
  if (piece === EMPTY) return false;
  return !isOwn(piece, player);
}
export function isKing(piece) { return piece === B_KING || piece === W_KING; }

/* ── Board initialisation ── */
export function initBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 !== 0) b[r][c] = WHITE;
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 !== 0) b[r][c] = BLACK;
  return b;
}

/* ── Apply a move (returns new board — immutable) ── */
export function applyMove(board, from, move) {
  const nb = board.map(row => [...row]);
  const piece = nb[from.r][from.c];
  if (move.capturedSquare) nb[move.capturedSquare.mr][move.capturedSquare.mc] = EMPTY;
  nb[from.r][from.c] = EMPTY;
  nb[move.r][move.c] = piece;
  if (piece === BLACK && move.r === 0) nb[move.r][move.c] = B_KING;
  if (piece === WHITE && move.r === 7) nb[move.r][move.c] = W_KING;
  return nb;
}

/* ── Normal piece moves & captures ── */
export function getNormalMoves(board, r, c, player, onlyCaptures) {
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

/* ── King (queen) moves — flies any distance ── */
export function getQueenMoves(board, r, c, player, onlyCaptures, alreadyCaptured) {
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

export function getMovesForPiece(board, r, c, player, onlyCaptures = false, alreadyCaptured = null) {
  if (isKing(board[r][c])) return getQueenMoves(board, r, c, player, onlyCaptures, alreadyCaptured);
  return getNormalMoves(board, r, c, player, onlyCaptures);
}

export function getCaptureMovesFrom(board, r, c, player, alreadyCaptured) {
  return getMovesForPiece(board, r, c, player, true, alreadyCaptured)
    .filter(m => m.capturedSquare !== null);
}

export function getAllCaptures(board, player) {
  const result = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isOwn(board[r][c], player))
        getCaptureMovesFrom(board, r, c, player, null)
          .forEach(m => result.push({ from: { r, c }, ...m }));
  return result;
}

export function getAllMoves(board, player, mustCapturePos = null) {
  if (mustCapturePos) {
    return getCaptureMovesFrom(board, mustCapturePos.r, mustCapturePos.c, player,
      mustCapturePos.captured || null);
  }
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
