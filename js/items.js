'use strict';
/* 可拾取的感染控制資源。洗手增益由洗手台觸發，不在此。 */

const ITEM_DEFS = Object.freeze({
  ppe:       Object.freeze({ color: '#5ac6e0', label: 'PPE' }),
  supply:    Object.freeze({ color: '#7ed957', label: '消毒補給' }),
  firstaid:  Object.freeze({ color: '#ff6b6b', label: '急救包' }),
  isolation: Object.freeze({ color: '#f2c14e', label: '隔離警示' }),
});

class Item {
  constructor(type, x, y) {
    this.type = type;
    this.x = x; this.y = y;
    this.size = 28;
    this.life = 0;
    this.maxLife = CONST.ITEM_LIFETIME;
    this.dead = false;
    this.bob = Math.random() * Math.PI * 2;
  }

  get rect() {
    const s = this.size;
    return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
  }

  update(dt) {
    this.life += dt;
    this.bob += dt * 3;
    if (this.life >= this.maxLife) this.dead = true;
  }

  draw(ctx, time) {
    if (this.dead) return;
    // 剩不到 3 秒閃爍
    const remain = this.maxLife - this.life;
    if (remain < 3 && Math.floor(time * 8) % 2 === 0) return;
    const def = ITEM_DEFS[this.type];
    const y = this.y + Math.sin(this.bob) * 2;
    ctx.save();
    ctx.translate(this.x, y);
    // 底盤光暈
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(0, 0, this.size / 2 + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    this._icon(ctx, this.type);
    ctx.restore();
  }

  _icon(ctx, type) {
    ctx.lineWidth = 2;
    switch (type) {
      case 'ppe': // 口罩
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-8, -5, 16, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.moveTo(-8, -3); ctx.lineTo(-11, -5); ctx.moveTo(8, -3); ctx.lineTo(11, -5); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(6, -1); ctx.moveTo(-6, 2); ctx.lineTo(6, 2); ctx.stroke();
        break;
      case 'supply':  // 消毒瓶（十字）
      case 'firstaid': // 急救包（白十字）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-2.5, -8, 5, 16);
        ctx.fillRect(-8, -2.5, 16, 5);
        break;
      case 'isolation': // 警示三角
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -8); ctx.lineTo(8, 7); ctx.lineTo(-8, 7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a5b10';
        ctx.fillRect(-1.5, -3, 3, 6); ctx.fillRect(-1.5, 4, 3, 2);
        break;
    }
  }
}
