'use strict';
/* 砲彈。碰撞由 Game.updateBullets 以子步掃掠處理，這裡只保存狀態與繪製。 */

class Bullet {
  /**
   * @param {number} x 中心 x
   * @param {number} y 中心 y
   * @param {number} dir DIR 方向
   * @param {number} speed px/s
   * @param {'player'|'enemy'} owner
   * @param {object|null} ownerRef 發射者（用於歸還彈藥額度）
   */
  constructor(x, y, dir, speed, owner, ownerRef) {
    this.x = x;
    this.y = y;
    this.dir = dir;
    this.speed = speed;
    this.owner = owner;
    this.ownerRef = ownerRef || null;
    this.size = CONST.BULLET_SIZE;
    this.dead = false;
  }

  get rect() {
    const s = this.size;
    return { x: this.x - s / 2, y: this.y - s / 2, w: s, h: s };
  }

  /* 標記死亡並歸還發射者的彈藥額度（只會執行一次） */
  kill() {
    if (this.dead) return;
    this.dead = true;
    if (this.ownerRef && this.ownerRef.activeBullets > 0) this.ownerRef.activeBullets--;
  }

  draw(ctx) {
    const s = this.size;
    ctx.fillStyle = this.owner === 'player' ? '#ffe9a8' : '#ff9d8a';
    ctx.beginPath();
    ctx.arc(this.x, this.y, s / 2, 0, Math.PI * 2);
    ctx.fill();
    // 尾焰
    const v = DIR_VECS[this.dir];
    ctx.fillStyle = this.owner === 'player' ? 'rgba(255,210,100,0.5)' : 'rgba(255,120,90,0.5)';
    ctx.beginPath();
    ctx.arc(this.x - v.x * s * 0.8, this.y - v.y * s * 0.8, s / 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
