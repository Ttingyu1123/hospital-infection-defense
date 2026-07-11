'use strict';
/* 輕量粒子系統 + 畫面震動。粒子數量有上限，震動只影響渲染位移，不動碰撞座標。 */

class ParticleSystem {
  constructor() {
    this.particles = [];
    this.shakeTime = 0;
    this.shakeMag = 0;
  }

  reset() {
    this.particles.length = 0;
    this.shakeTime = 0;
    this.shakeMag = 0;
  }

  _push(p) {
    if (this.particles.length >= CONST.MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  spawn(x, y, count, opts) {
    const o = opts || {};
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (o.speed || 120) * (0.3 + Math.random() * 0.7);
      this._push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - (o.lift || 0),
        life: 0,
        maxLife: (o.life || 0.5) * (0.6 + Math.random() * 0.8),
        size: (o.size || 3) * (0.5 + Math.random()),
        color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : (o.color || '#ffb347'),
        gravity: o.gravity || 0,
        square: !!o.square,
      });
    }
  }

  sparks(x, y)      { this.spawn(x, y, 6,  { speed: 160, life: 0.25, size: 2.5, color: ['#ffe08a', '#ffb347', '#fff'] }); }
  brickDebris(x, y) { this.spawn(x, y, 10, { speed: 140, life: 0.45, size: 3.5, color: ['#b5651d', '#8a4a12', '#d98c3f'], gravity: 300, square: true }); }
  tankExplosion(x, y) {
    this.spawn(x, y, 26, { speed: 220, life: 0.6, size: 4, color: ['#ffd166', '#ff7b47', '#ff4747', '#ffe9a8'] });
    this.spawn(x, y, 10, { speed: 70,  life: 0.8, size: 6, color: ['#555', '#777', '#333'], square: true });
    this.addShake(4, 0.25);
  }
  baseExplosion(x, y) {
    this.spawn(x, y, 60, { speed: 300, life: 1.1, size: 5, color: ['#ffd166', '#ff7b47', '#ff4747', '#fff'] });
    this.spawn(x, y, 24, { speed: 120, life: 1.4, size: 7, color: ['#444', '#666', '#222'], square: true, gravity: 180 });
    this.addShake(10, 0.7);
  }

  addShake(mag, dur) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeTime = Math.max(this.shakeTime, dur);
  }

  update(dt) {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }
    const arr = this.particles;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life += dt;
      if (p.life >= p.maxLife) { arr.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /* 回傳本幀渲染位移（震動） */
  getShakeOffset() {
    if (this.shakeTime <= 0) return { x: 0, y: 0 };
    const m = this.shakeMag * (this.shakeTime > 0.1 ? 1 : this.shakeTime / 0.1);
    return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
  }

  draw(ctx) {
    const arr = this.particles;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size;
      if (p.square) ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
