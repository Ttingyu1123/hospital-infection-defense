'use strict';
/* 移動單位基底：四方向移動、AABB 碰撞（地形/邊界/病人/其他單位）、
   走道吸附輔助。繪製由子類（Player / Pathogen / Boss）各自負責。 */

class Entity {
  constructor(x, y, size, speed) {
    this.x = x;           // 中心座標
    this.y = y;
    this.size = size;
    this.speed = speed;
    this.dir = DIR.UP;
    this.alive = true;
    this.hitFlash = 0;    // 被擊中白閃
  }

  get half() { return this.size / 2; }
  get rect() {
    const h = this.half;
    return { x: this.x - h, y: this.y - h, w: this.size, h: this.size };
  }

  /* 子類覆寫：額外阻擋（如病原體被關閉的隔離門擋住）。 */
  extraBlocked(_x, _y, _game) { return false; }

  /* 指定中心位置是否可站立（地形 + 邊界 + 病人 + 其他單位 + extraBlocked） */
  positionFree(x, y, game) {
    const h = this.half;
    if (game.map.rectBlocksEntity(x - h, y - h, this.size, this.size)) return false;
    const p = game.patientRect;
    if (aabbOverlap(x - h, y - h, this.size, this.size, p.x, p.y, p.w, p.h)) return false;
    for (const w of game.washStations) {
      if (aabbOverlap(x - h, y - h, this.size, this.size, w.x, w.y, w.w, w.h)) return false;
    }
    if (this.extraBlocked(x, y, game)) return false;
    for (const other of game.allUnits()) {
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
    const t = CONST.TILE;
    if (isVertical) {
      const snapped = Math.round(this.x / t) * t;
      if (snapped !== this.x && Math.abs(snapped - this.x) <= CONST.ALIGN_SNAP && this.positionFree(snapped, this.y, game)) this.x = snapped;
    } else {
      const snapped = Math.round(this.y / t) * t;
      if (snapped !== this.y && Math.abs(snapped - this.y) <= CONST.ALIGN_SNAP && this.positionFree(this.x, snapped, game)) this.y = snapped;
    }
  }

  /* 沿目前方向移動；被擋住時嘗試側滑對齊走道。回傳是否有實際前進。 */
  move(dt, game) {
    const v = DIR_VECS[this.dir];
    const dist = this.speed * dt;
    let moved = 0, remain = dist;
    while (remain > 0) {
      const step = Math.min(1, remain);
      const nx = this.x + v.x * step;
      const ny = this.y + v.y * step;
      if (!this.positionFree(nx, ny, game)) break;
      this.x = nx; this.y = ny;
      moved += step;
      remain -= step;
    }
    if (remain > 0.5 && moved < dist * 0.5) this._slideAssist(dist - moved, game);
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

  updateTimers(dt) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }
}
