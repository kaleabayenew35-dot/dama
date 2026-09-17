/* ═══════════════════════════════════════════════════
   game.js  — Game screen entry point
   Wires up in-game buttons (back, restart, undo, win modal)
   All game logic lives in modules/engine.js
═══════════════════════════════════════════════════ */

import { showScreen } from './modules/telegram.js';
import { renderPlayerList } from './modules/ui.js';
import { G, startGame, doUndo, endGame, BLACK, WHITE } from './modules/engine.js';

/**
 * If the player quits mid-game (back button or menu button while game is active),
 * treat it as a resign for online PvP, or just a local forfeit for AI/local.
 */
function handleQuit() {
  if (!G.gameOver && G.mode === 'pvp' && G.isOnlinePvP && G.gameId) {
    // Send resign to server — server will settle balances
    window.Socket?.send('resign', {
      gameId:   G.gameId,
      playerId: window.tgUserId,
    });
    // Immediately record local loss
    endGame(
      G.myColor === 'black' ? WHITE : BLACK,
      'You quit the game',
      true   // isRemote = true so engine doesn't re-send game_over
    );
  } else if (!G.gameOver && G.mode === 'pvp' && !G.isOnlinePvP) {
    // Local PvP: just end silently
    endGame(null, 'Game abandoned', true);
  }

  clearInterval(G.timerInterval);
  showScreen('mainMenu');
  renderPlayerList();
}

function initGamePage() {
  document.getElementById('backToMenu')?.addEventListener('click', handleQuit);

  document.getElementById('restartBtn')?.addEventListener('click', () => {
    if (G.isOnlinePvP) return; // can't restart an online game
    window.startGame(G.mode, G.opponent);
  });

  document.getElementById('undoBtn')?.addEventListener('click', doUndo);

  document.getElementById('playAgainBtn')?.addEventListener('click', () => {
    window.startGame(G.mode, G.opponent);
  });

  document.getElementById('menuBtn2')?.addEventListener('click', () => {
    document.getElementById('winModal')?.classList.add('hidden');
    document.getElementById('winModal')?.classList.remove('modal-show');
    clearInterval(G.timerInterval);
    showScreen('mainMenu');
    renderPlayerList();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGamePage);
} else {
  initGamePage();
}
