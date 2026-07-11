'use strict';
/* 坦克基底類別：四方向移動、AABB 碰撞（地形/邊界/基地/其他坦克）、
   走道吸附輔助、發射砲彈、履帶/車身/砲塔繪製。 */

class Tank {
  constructor(x, y, size, speed) {
    this.x = x;           // 中心座標
    this.y = y;
    this.size = size;
    this.speed = speed;
    this.dir = DIR.UP;
    this.alive = true;
    this.hp = 1;
    this.cooldown = 0;      // 射擊冷卻計時
    this.activeBullets = 0; // 場上存活砲彈數
    this.maxBullets = 1;
    this.treadPhase = 0;    // 履帶動畫相位（依移動距離）
    this.hitFlash = 0;      // 被擊中的白閃
  }

  get half() { return this.size / 2; }
  get rect() {
    const h = this.half;
    return { x: this.x - h, y: this.y - h, w: this.size, h: this.size };
  }

  /* 指定位置是否可站立（地形 + 邊界 + 基地 + 其他坦克） */
  positionFree(x, y, game) {
    const h = this.half;
    if (game.map.rectBlocksTank(x - h, y - h, this.size, this.size)) return false;
    const b = game.baseRect;
    if (aabbOverlap(x - h, y - h, this.size, this.size, b.x, b.y, b.w, b.h)) return false;
    for (const other of game.allTanks()) {
      if (other === this || !other.alive) continue;
      const o = other.rect;
      if (aabbOverlap(x - h, y - h, this.size, this.size, o.x, o.y, o.w, o.h)) return false;
    }
    return true;
  }

  /* 改變方向；跨軸轉向時做走道中線吸附，讓窄走道轉彎不卡 */
  setDir(dir, game) {
    if (dir === this.dir) return;
    const wasVertical = (this.dir === DIR.UP || this.dir === DIR.DOWN);
    const isVertical = (dir === DIR.UP || dir === DIR.DOWN);
    this.dir = dir;
    if (wasVertical === isVertical || !game) return;
    // 垂直↔水平：把垂直於新方向的座標吸附到最近的格線（走道中線）
    const t = CONST.TILE;
    if (isVertical) {
      const snapped = Math.round(this.x / t) * t;
      if (snapped !== this.x && Math.abs(snapped - this.x) <= CONST.ALIGN_SNAP && this.positionFree(snapped, this.y, game)) {
        this.x = snapped;
      }
    } else {
      const snapped = Math.round(this.y / t) * t;
      if (snapped !== this.y && Math.abs(snapped - this.y) <= CONST.ALIGN_SNAP && this.positionFree(this.x, snapped, game)) {
        this.y = snapped;
      }
    }
  }

  /* 沿目前方向移動。被擋住時嘗試橫向滑移對齊走道。回傳是否有實際前進。 */
  move(dt, game) {
    const v = DIR_VECS[this.dir];
    const dist = this.speed * dt;
    let moved = 0;
    // 以 1px 步進推進到貼牆為止（每幀距離僅數 px，成本可忽略）
    let remain = dist;
    while (remain > 0) {
      const step = Math.min(1, remain);
      const nx = this.x + v.x * step;
      const ny = this.y + v.y * step;
      if (!this.positionFree(nx, ny, game)) break;
      this.x = nx; this.y = ny;
      moved += step;
      remain -= step;
    }
    if (moved > 0) this.treadPhase += moved;
    if (remain > 0.5 && moved < dist * 0.5) {
      // 前方受阻：若接近走道中線則側滑對齊（轉角輔助）
      this._slideAssist(dist - moved, game);
    }
    return moved > 0.01;
  }

  _slideAssist(dist, game) {
    const t = CONST.TILE;
    const vertical = (this.dir === DIR.UP || this.dir === DIR.DOWN);
    const cur = vertical ? this.x : this.y;
    const target = Math.round(cur / t) * t;
    const delta = target - cur;
    if (delta === 0 || Math.abs(delta) > CONST.ALIGN_SNAP) return;
    const stepDir = Math.sign(delta);
    let remain = Math.min(Math.abs(delta), dist);
    while (remain > 0) {
      const step = Math.min(1, remain);
      const nx = vertical ? this.x + stepDir * step : this.x;
      const ny = vertical ? this.y : this.y + stepDir * step;
      if (!this.positionFree(nx, ny, game)) break;
      this.x = nx; this.y = ny;
      remain -= step;
    }
  }

  canShoot() {
    return this.alive && this.cooldown <= 0 && this.activeBullets < this.maxBullets;
  }

  /* 從砲管前端生成砲彈 */
  shoot(game, owner, bulletSpeed) {
    if (!this.canShoot()) return null;
    const v = DIR_VECS[this.dir];
    const muzzle = this.half + CONST.BULLET_SIZE / 2 + 2;
    const b = new Bullet(this.x + v.x * muzzle, this.y + v.y * muzzle, this.dir, bulletSpeed, owner, this);
    game.bullets.push(b);
    this.activeBullets++;
    return b;
  }

  updateTimers(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  /* 幾何繪製：履帶、車身、砲塔、砲管。color/dark 由子類提供。 */
  drawBody(ctx, color, dark) {
    const s = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate((this.dir * Math.PI) / 2); // 以「朝上」為基準旋轉
    const h = s / 2;

    // 履帶（左右兩條）
    ctx.fillStyle = '#2a2f38';
    ctx.fillRect(-h, -h + 2, s * 0.22, s - 4);
    ctx.fillRect(h - s * 0.22, -h + 2, s * 0.22, s - 4);
    // 履帶紋（隨移動滾動）
    ctx.fillStyle = '#4a5262';
    const seg = 6;
    const off = this.treadPhase % seg;
    for (let yy = -h + 2 - off; yy < h - 2; yy += seg) {
      const y0 = Math.max(yy, -h + 2);
      const hgt = Math.min(2, h - 2 - y0);
      if (hgt <= 0) continue;
      ctx.fillRect(-h + 1, y0, s * 0.22 - 2, hgt);
      ctx.fillRect(h - s * 0.22 + 1, y0, s * 0.22 - 2, hgt);
    }

    // 車身
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : color;
    ctx.fillRect(-h + s * 0.18, -h + 3, s * 0.64, s - 6);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.strokeRect(-h + s * 0.18, -h + 3, s * 0.64, s - 6);

    // 砲塔
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : dark;
    ctx.beginPath();
    ctx.arc(0, s * 0.06, s * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 砲管（指向上）
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : dark;
    ctx.fillRect(-3, -h - 6, 6, h + 6);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-3, -h - 6, 2, h + 6);

    ctx.restore();
  }
}
