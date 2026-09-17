/**
 * moveValidator.test.js
 * Unit tests for the pure move/capture logic.
 * Run: npm test
 *
 * Covers the highest-risk rules for a real-money game:
 *   1. Basic forward moves
 *   2. Mandatory captures (if a capture exists, normal moves must not be returned)
 *   3. Multi-jump (chain captures)
 *   4. King promotion (reaching back rank)
 *   5. King "flying" moves (long-range diagonal in all 4 directions)
 *   6. King capture (can jump over enemy anywhere on the diagonal)
 *   7. Capture must not land on occupied square
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY, BLACK, WHITE, B_KING, W_KING,
  initBoard, applyMove,
  getNormalMoves, getQueenMoves,
  getCaptureMovesFrom, getAllCaptures, getAllMoves,
  isKing, isOwn,
} from '../modules/moveValidator.js';

/* ── helpers ── */
function emptyBoard() {
  return Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
}

function place(board, pieces) {
  // pieces: [{ r, c, piece }]
  pieces.forEach(({ r, c, piece }) => { board[r][c] = piece; });
  return board;
}

/* ═══════════════════════════════════════════════════════════════
   1. INITIAL BOARD SETUP
   ═══════════════════════════════════════════════════════════════ */
describe('initBoard', () => {
  it('places 12 black pieces in rows 5-7', () => {
    const b = initBoard();
    let count = 0;
    for (let r = 5; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (b[r][c] === BLACK) count++;
    expect(count).toBe(12);
  });

  it('places 12 white pieces in rows 0-2', () => {
    const b = initBoard();
    let count = 0;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 8; c++)
        if (b[r][c] === WHITE) count++;
    expect(count).toBe(12);
  });

  it('only uses dark squares', () => {
    const b = initBoard();
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if ((r + c) % 2 === 0) expect(b[r][c]).toBe(EMPTY);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. BASIC FORWARD MOVES (normal man)
   ═══════════════════════════════════════════════════════════════ */
describe('getNormalMoves — forward movement', () => {
  it('BLACK man moves diagonally up (rows decrease)', () => {
    const b = emptyBoard();
    b[4][3] = BLACK;
    const moves = getNormalMoves(b, 4, 3, BLACK, false);
    const dests = moves.map(m => `${m.r},${m.c}`);
    expect(dests).toContain('3,2');
    expect(dests).toContain('3,4');
    expect(moves.every(m => m.capturedSquare === null)).toBe(true);
  });

  it('WHITE man moves diagonally down (rows increase)', () => {
    const b = emptyBoard();
    b[3][4] = WHITE;
    const moves = getNormalMoves(b, 3, 4, WHITE, false);
    const dests = moves.map(m => `${m.r},${m.c}`);
    expect(dests).toContain('4,3');
    expect(dests).toContain('4,5');
  });

  it('returns no moves when both forward squares are blocked', () => {
    const b = emptyBoard();
    b[4][3] = BLACK;
    b[3][2] = WHITE; // block left
    b[3][4] = WHITE; // block right (would be capture, but no landing)
    b[2][1] = BLACK; // block behind white
    b[2][5] = BLACK;
    const moves = getNormalMoves(b, 4, 3, BLACK, false)
      .filter(m => m.capturedSquare === null);
    expect(moves.length).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. MANDATORY CAPTURES
   ═══════════════════════════════════════════════════════════════ */
describe('getAllMoves — mandatory capture rule', () => {
  it('returns ONLY captures when at least one exists', () => {
    // BLACK at (4,3), WHITE at (3,4), empty (2,5) — capture is available
    const b = emptyBoard();
    b[4][3] = BLACK;
    b[3][4] = WHITE;
    // (2,5) is empty — capture available
    const moves = getAllMoves(b, BLACK);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(m => m.capturedSquare !== null)).toBe(true);
  });

  it('returns normal moves when no captures exist', () => {
    const b = emptyBoard();
    b[4][3] = BLACK;
    const moves = getAllMoves(b, BLACK);
    expect(moves.some(m => m.capturedSquare === null)).toBe(true);
  });

  it('does not allow moving a piece that cannot capture when another can', () => {
    // Two BLACK pieces; only one has a capture available
    const b = emptyBoard();
    b[6][1] = BLACK; // this one can capture
    b[5][2] = WHITE;
    // (4,3) is empty
    b[6][7] = BLACK; // this one cannot capture (no enemy adjacent)

    const allMoves = getAllMoves(b, BLACK);
    // All returned moves must be captures
    expect(allMoves.every(m => m.capturedSquare !== null)).toBe(true);
    // The non-capturing piece must not appear in results
    const fromPositions = allMoves.map(m => `${m.from.r},${m.from.c}`);
    expect(fromPositions).not.toContain('6,7');
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. MULTI-JUMP (chain captures)
   ═══════════════════════════════════════════════════════════════ */
describe('getCaptureMovesFrom — chain capture', () => {
  it('finds second jump from landing square', () => {
    // BLACK at (6,1), WHITE at (5,2) and (3,4)
    // First jump: (6,1) → over (5,2) → land (4,3)
    // Second jump: (4,3) → over (3,4) → land (2,5)
    const b = emptyBoard();
    b[6][1] = BLACK;
    b[5][2] = WHITE;
    b[3][4] = WHITE;

    // First capture
    const firstCaptures = getCaptureMovesFrom(b, 6, 1, BLACK, null);
    expect(firstCaptures.length).toBeGreaterThan(0);
    const first = firstCaptures[0];
    expect(first.r).toBe(4); expect(first.c).toBe(3);

    // Apply first capture and check second is available
    const b2 = applyMove(b, { r: 6, c: 1 }, first);
    const alreadyCaptured = new Set([`${first.capturedSquare.mr},${first.capturedSquare.mc}`]);
    const secondCaptures = getCaptureMovesFrom(b2, 4, 3, BLACK, alreadyCaptured);
    expect(secondCaptures.length).toBeGreaterThan(0);
    expect(secondCaptures[0].r).toBe(2); expect(secondCaptures[0].c).toBe(5);
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. KING PROMOTION
   ═══════════════════════════════════════════════════════════════ */
describe('applyMove — king promotion', () => {
  it('promotes BLACK piece to B_KING when reaching row 0', () => {
    const b = emptyBoard();
    b[1][2] = BLACK;
    const move = { r: 0, c: 1, capturedSquare: null };
    const nb   = applyMove(b, { r: 1, c: 2 }, move);
    expect(nb[0][1]).toBe(B_KING);
  });

  it('promotes WHITE piece to W_KING when reaching row 7', () => {
    const b = emptyBoard();
    b[6][3] = WHITE;
    const move = { r: 7, c: 2, capturedSquare: null };
    const nb   = applyMove(b, { r: 6, c: 3 }, move);
    expect(nb[7][2]).toBe(W_KING);
  });

  it('does NOT promote when not reaching back rank', () => {
    const b = emptyBoard();
    b[3][2] = BLACK;
    const move = { r: 2, c: 3, capturedSquare: null };
    const nb   = applyMove(b, { r: 3, c: 2 }, move);
    expect(nb[2][3]).toBe(BLACK); // still a man
  });
});

/* ═══════════════════════════════════════════════════════════════
   6. KING "FLYING" MOVES (long-range diagonal)
   ═══════════════════════════════════════════════════════════════ */
describe('getQueenMoves — king flying', () => {
  it('king can move multiple squares diagonally in all 4 directions', () => {
    const b = emptyBoard();
    b[4][4] = B_KING;
    const moves = getQueenMoves(b, 4, 4, BLACK, false, null)
      .filter(m => m.capturedSquare === null);

    // Should be able to reach every empty dark square on the diagonals
    // NW diagonal: (3,3),(2,2),(1,1),(0,0)
    expect(moves.some(m => m.r === 0 && m.c === 0)).toBe(true);
    // NE diagonal: (3,5),(2,6),(1,7)
    expect(moves.some(m => m.r === 1 && m.c === 7)).toBe(true);
    // SW diagonal: (5,3),(6,2),(7,1)
    expect(moves.some(m => m.r === 7 && m.c === 1)).toBe(true);
    // SE diagonal: (5,5),(6,6),(7,7)
    expect(moves.some(m => m.r === 7 && m.c === 7)).toBe(true);
  });

  it('king is blocked by friendly piece', () => {
    const b = emptyBoard();
    b[4][4] = B_KING;
    b[2][2] = BLACK; // friendly blocker on NW diagonal
    const moves = getQueenMoves(b, 4, 4, BLACK, false, null)
      .filter(m => m.capturedSquare === null);
    // Can reach (3,3) but not (2,2) or beyond
    expect(moves.some(m => m.r === 3 && m.c === 3)).toBe(true);
    expect(moves.some(m => m.r === 2 && m.c === 2)).toBe(false);
    expect(moves.some(m => m.r === 1 && m.c === 1)).toBe(false);
  });

  it('king can capture enemy anywhere on its diagonal', () => {
    // King at (5,1) — dark square (5+1=6, even — wait let's verify)
    // Dark squares satisfy (r+c) % 2 !== 0, i.e. r+c is ODD.
    // (5,2): 5+2=7 odd ✓   (3,4): 3+4=7 odd ✓   (2,5): 2+5=7 odd ✓
    // King at (5,2), enemy WHITE at (2,5) — NE diagonal 3 squares away.
    // Landing squares after capture: (1,6) [1+6=7 odd ✓] and (0,7) [0+7=7 odd ✓]
    const b = emptyBoard();
    b[5][2] = B_KING;
    b[2][5] = WHITE;
    const captures = getQueenMoves(b, 5, 2, BLACK, true, null)
      .filter(m => m.capturedSquare !== null);

    // Must find the capture over (2,5)
    expect(captures.some(m => m.capturedSquare.mr === 2 && m.capturedSquare.mc === 5)).toBe(true);

    // All landing squares for that capture must be beyond (past) the enemy
    const landing = captures.filter(m => m.capturedSquare.mr === 2 && m.capturedSquare.mc === 5);
    // Landing r must be < 2 (past the enemy going NE)
    expect(landing.every(m => m.r < 2)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════
   7. CAPTURE CANNOT LAND ON OCCUPIED SQUARE
   ═══════════════════════════════════════════════════════════════ */
describe('capture landing validation', () => {
  it('normal piece: capture not available if landing square is occupied', () => {
    const b = emptyBoard();
    b[4][3] = BLACK;
    b[3][4] = WHITE; // enemy
    b[2][5] = BLACK; // friendly on landing square — capture blocked
    const captures = getCaptureMovesFrom(b, 4, 3, BLACK, null);
    expect(captures.length).toBe(0);
  });

  it('king: capture not available if all landing squares beyond enemy are occupied', () => {
    const b = emptyBoard();
    b[4][4] = B_KING;
    b[2][6] = WHITE; // enemy on NE diagonal
    b[1][7] = BLACK; // friendly blocks the only landing square
    const captures = getQueenMoves(b, 4, 4, BLACK, true, null)
      .filter(m => m.capturedSquare?.mr === 2 && m.capturedSquare?.mc === 6);
    expect(captures.length).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════
   8. isKing / isOwn helpers
   ═══════════════════════════════════════════════════════════════ */
describe('piece helpers', () => {
  it('isKing returns true for B_KING and W_KING only', () => {
    expect(isKing(B_KING)).toBe(true);
    expect(isKing(W_KING)).toBe(true);
    expect(isKing(BLACK)).toBe(false);
    expect(isKing(WHITE)).toBe(false);
    expect(isKing(EMPTY)).toBe(false);
  });

  it('isOwn correctly identifies ownership', () => {
    expect(isOwn(BLACK,  BLACK)).toBe(true);
    expect(isOwn(B_KING, BLACK)).toBe(true);
    expect(isOwn(WHITE,  BLACK)).toBe(false);
    expect(isOwn(W_KING, WHITE)).toBe(true);
    expect(isOwn(BLACK,  WHITE)).toBe(false);
  });
});
