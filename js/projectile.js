'use strict';
/* 投射物：玩家的抗生素膠囊 與 病原體/Boss 的污染液滴。
   碰撞由 Game._updateProjectiles 以子步掃掠處理，這裡只保存狀態與繪製。 */

class Projectile {
  /**
   * @param {number} x 中心 x
   * @param {number} y 中心 y
   * @param {number} dir DIR 方向
   * @param {number} speed px/s
   * @param {'player'|'enemy'} owner
   * @param {'antibiotic'|'droplet'} kind
   * @param {number} damage 命中傷害（對敵人再乘抗性倍率）
   * @param {object|null} ownerRef 發射者（用於歸還彈藥額度）
   */
  constructor(x, y, dir, speed, owner, kind, damage, ownerRef) {
    this.x = x; this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.owner = owner;
    this.kind = kind;
    this.damage = damage;
    this.ownerRef = ownerRef || null;
    this.size = kind === 'antibiotic' ? 12 : 10;
    this.spin = 0;
    this.dead = false;
  }

  get rect() {
    const s = this.size;
    return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    if (this.ownerRef && this.ownerRef.activeBullets > 0) this.ownerRef.activeBullets--;
  }

  update(dt) { this.spin += dt * 12; }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.kind === 'antibiotic') {
      // 膠囊：半黃半白，朝飛行方向
      ctx.rotate(DIR_ANGLE[this.dir] + Math.PI / 2);
      const w = 7, h = 13;
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + w / 2, w / 2, Math.PI, 0);
      ctx.lineTo(w / 2, 0); ctx.lineTo(-w / 2, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fdf3d6';
      ctx.beginPath();
      ctx.arc(0, h / 2 - w / 2, w / 2, 0, Math.PI);
      ctx.lineTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,20,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
    } else {
      // 污染液滴
      ctx.rotate(this.spin);
      ctx.fillStyle = '#8ab83c';
      ctx.beginPath();
      ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,90,20,0.7)';
      ctx.beginPath();
      ctx.arc(1.5, 1.5, this.size / 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
