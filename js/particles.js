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
      const ang = (o.angle !== undefined) ? o.angle + (Math.random() - 0.5) * (o.spread || Math.PI * 2)
                                          : Math.random() * Math.PI * 2;
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

  sparks(x, y)           { this.spawn(x, y, 6,  { speed: 150, life: 0.25, size: 2.5, color: ['#ffe08a', '#fff', '#cfe6ff'] }); }
  partitionDebris(x, y)  { this.spawn(x, y, 9,  { speed: 130, life: 0.4, size: 3.5, color: ['#a7e0d6', '#4f9c8c', '#d8f2ec'], gravity: 260, square: true }); }
  alcoholMist(x, y, dir) {
    const ang = DIR_ANGLE[dir];
    this.spawn(x, y, 12, { speed: 160, life: 0.4, size: 3, color: ['#bdeef5', '#7fd8e8', '#ffffff'], angle: ang, spread: 1.1 });
  }
  pathogenBurst(x, y, color) {
    this.spawn(x, y, 16, { speed: 170, life: 0.5, size: 4, color: [color, '#ffffff', '#dfeecb'] });
    this.spawn(x, y, 6,  { speed: 60,  life: 0.6, size: 5, color: [color], square: true });
    this.addShake(2.5, 0.15);
  }
  shieldBreak(x, y)   { this.spawn(x, y, 14, { speed: 150, life: 0.4, size: 3, color: ['#9be0f2', '#ffffff', '#5ac6e0'] }); }
  critSpark(x, y, color) { this.spawn(x, y, 10, { speed: 220, life: 0.28, size: 3.5, color: [color, '#ffffff'] }); this.addShake(1.5, 0.08); }
  pickupSparkle(x, y, color) { this.spawn(x, y, 12, { speed: 120, life: 0.5, size: 3, color: [color, '#ffffff'], lift: 40 }); }
  washDrops(x, y)     { this.spawn(x, y, 14, { speed: 110, life: 0.55, size: 3, color: ['#9bd8ff', '#ffffff', '#5aa6e0'], lift: 30, gravity: 180 }); }
  contamPuff(x, y)    { this.spawn(x, y, 8,  { speed: 90, life: 0.5, size: 4, color: ['#bde07a', '#8ab83c', '#eaf7d0'], lift: 20 }); }
  patientHitFx(x, y)  { this.spawn(x, y, 8,  { speed: 120, life: 0.4, size: 3, color: ['#ff8a8a', '#ffd0d0'] }); }
  bossExplosion(x, y) {
    this.spawn(x, y, 70, { speed: 320, life: 1.1, size: 6, color: ['#7dff5a', '#ffec3d', '#ffffff', '#8ab83c'] });
    this.spawn(x, y, 26, { speed: 120, life: 1.3, size: 8, color: ['#5a0f0a', '#c0392b'], square: true, gravity: 160 });
    this.addShake(11, 0.8);
  }
  disinfectFlash(x, y) {
    this.spawn(x, y, 60, { speed: 260, life: 1.0, size: 5, color: ['#bdeef5', '#ffffff', '#7fd8e8'] });
    this.addShake(5, 0.4);
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

  getShakeOffset() {
    if (this.shakeTime <= 0) return { x: 0, y: 0 };
    const m = this.shakeMag * (this.shakeTime > 0.1 ? 1 : this.shakeTime / 0.1);
    return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
  }

  draw(ctx) {
    const arr = this.particles;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.fillStyle = p.color;
      const s = p.size;
      if (p.square) ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
}
