'use strict';
/* 進入點：輸入監聽（只註冊一次）、單一 requestAnimationFrame 迴圈。
   重新開始只重置 Game 狀態，不重建迴圈。 */

/* 鍵盤輸入：方向鍵堆疊（後按優先），提供持續按住查詢 */
class Input {
  constructor() {
    this.down = new Set();
    this.dirStack = []; // 目前按住的方向鍵，最後按的優先
    this.touchDir = null; // 觸控搖桿方向（優先於鍵盤）
  }

  setTouchDir(d) { this.touchDir = d; }

  static dirOf(code) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': return DIR.UP;
      case 'KeyD': case 'ArrowRight': return DIR.RIGHT;
      case 'KeyS': case 'ArrowDown': return DIR.DOWN;
      case 'KeyA': case 'ArrowLeft': return DIR.LEFT;
      default: return null;
    }
  }

  keyDown(code) {
    this.down.add(code);
    const d = Input.dirOf(code);
    if (d !== null && !this.dirStack.includes(d)) this.dirStack.push(d);
  }

  keyUp(code) {
    this.down.delete(code);
    const d = Input.dirOf(code);
    if (d !== null) {
      const i = this.dirStack.indexOf(d);
      if (i >= 0) this.dirStack.splice(i, 1);
    }
  }

  currentDir() {
    if (this.touchDir !== null) return this.touchDir;
    return this.dirStack.length > 0 ? this.dirStack[this.dirStack.length - 1] : null;
  }

  isDown(code) { return this.down.has(code); }
}

(function bootstrap() {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  const input = new Input();

  // 阻止方向鍵 / 空白鍵捲動頁面
  const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

  window.addEventListener('keydown', (e) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    audioSys.ensure(); // 首次互動後初始化 AudioContext
    if (e.repeat) return;
    input.keyDown(e.code);
    game.onKeyDown(e.code);
  });

  window.addEventListener('keyup', (e) => {
    input.keyUp(e.code);
  });

  window.addEventListener('pointerdown', () => audioSys.ensure());

  // 觸控控制（行動裝置；桌面自動隱藏）
  if (typeof setupTouchControls === 'function') setupTouchControls(game, input, canvas);

  // 單一遊戲迴圈；dt 有上限避免切換分頁後瞬移
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, CONST.DT_MAX);
    last = now;
    game.update(dt, input);
    game.render();
  }
  requestAnimationFrame(frame);

  // 供自動化測試 / 除錯使用
  window.__game = game;
  window.__input = input;
})();
