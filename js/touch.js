'use strict';
/* 觸控控制：左下虛擬搖桿（四向）+ 右下動作鈕。桌面（非觸控）自動隱藏。
   搖桿方向透過 input.setTouchDir 餵入，優先於鍵盤；動作鈕轉譯為對應鍵碼呼叫 game.onKeyDown。 */

function setupTouchControls(game, input, canvas) {
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  // 允許以 ?touch=1 強制顯示（便於在桌面預覽）
  const force = /[?&]touch=1/.test(location.search);
  if (!isTouch && !force) return;

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div id="tc-stick"><div id="tc-nub"></div></div>
    <div id="tc-actions">
      <button class="tc-btn tc-tool" data-key="Digit1">酒</button>
      <button class="tc-btn tc-tool" data-key="Digit2">抗</button>
      <button class="tc-btn tc-tool" data-key="Digit3">紫</button>
      <button class="tc-btn tc-fire" data-hold="Space">噴</button>
      <button class="tc-btn" data-key="KeyC">門</button>
      <button class="tc-btn" data-key="KeyP">⏸</button>
    </div>`;
  document.body.appendChild(root);

  const stick = root.querySelector('#tc-stick');
  const nub = root.querySelector('#tc-nub');

  // ---- 搖桿 ----
  let stickId = null;
  const setDirFrom = (dx, dy) => {
    const mag = Math.hypot(dx, dy);
    if (mag < 14) { input.setTouchDir(null); nub.style.transform = 'translate(0,0)'; return; }
    let dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
    else dir = dy > 0 ? DIR.DOWN : DIR.UP;
    input.setTouchDir(dir);
    const cl = Math.min(mag, 34);
    const ang = Math.atan2(dy, dx);
    nub.style.transform = `translate(${Math.cos(ang) * cl}px, ${Math.sin(ang) * cl}px)`;
  };
  const stickCenter = () => { const r = stick.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); const c = stickCenter(); setDirFrom(e.clientX - c.x, e.clientY - c.y); e.preventDefault(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId !== stickId) return; const c = stickCenter(); setDirFrom(e.clientX - c.x, e.clientY - c.y); });
  const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; input.setTouchDir(null); nub.style.transform = 'translate(0,0)'; };
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);

  // ---- 動作鈕 ----
  root.querySelectorAll('.tc-btn').forEach((btn) => {
    const hold = btn.getAttribute('data-hold');
    const key = btn.getAttribute('data-key');
    if (hold) {
      // 按住連續（噴射）
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('active'); input.down.add(hold); game.onKeyDown(hold); });
      const up = () => { btn.classList.remove('active'); input.down.delete(hold); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    } else {
      // 單擊
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('active'); game.onKeyDown(key); });
      const up = () => btn.classList.remove('active');
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  });

  // ---- 開始 / 重玩 / 選單：點畫面本身 ----
  canvas.addEventListener('pointerdown', () => {
    const s = game.state;
    if (s === STATE.START) game.onKeyDown('Enter');
    else if (s === STATE.GAME_OVER || s === STATE.VICTORY) game.onKeyDown('KeyR');
  });
}
