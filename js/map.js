'use strict';
/* 醫院網格地圖。以 20x15 巨集格（每格 2x2 小格）設計固定地圖，
   小格（24px）為碰撞與破壞單位。另含動態污染層（每小格污染強度 0..1）。
   底部中央的 ICU 病房與隔離門由程式雕刻；洗手台與隔離門為 Game 管理的物件。 */

/* 巨集地圖（20 欄 x 15 列）：
   . 走廊  W 牆壁  P 污染隔板  B 病床  E 醫療設備
   底部 ICU 區由 _carveICU 另行雕刻。 */
const MACRO_MAP = [
  '....................',
  '....................',
  '.WW..EE....EE..WW...',
  '.WW..EE....EE..WW...',
  '....................',
  '.PP..BB....BB..PP...',
  '....................',
  '.EE....PP..PP....EE.',
  '.EE....PP..PP....EE.',
  '....................',
  '.BB..WW....WW..BB...',
  '....................',
  '....................',
  '....................',
  '....................',
];

const CHAR_TO_TILE = { '.': T.EMPTY, 'W': T.WALL, 'P': T.PARTITION, 'B': T.BED, 'E': T.EQUIP };

class GameMap {
  constructor() {
    this.grid = [];    // grid[row][col] = { type, hp }
    this.contam = [];  // contam[row][col] = 污染強度 0..1
    this.reset();
  }

  reset() {
    this.grid = [];
    this.contam = [];
    for (let r = 0; r < CONST.ROWS; r++) {
      const row = [];
      const crow = [];
      for (let c = 0; c < CONST.COLS; c++) {
        const ch = MACRO_MAP[r >> 1][c >> 1];
        const type = CHAR_TO_TILE[ch];
        row.push({ type, hp: type === T.PARTITION ? CONST.PARTITION_HP : 0 });
        crow.push(0);
      }
      this.grid.push(row);
      this.contam.push(crow);
    }
    this._carveICU();
  }

  /* ICU 病房：清出腔室 + 兩側鋼牆 + 前緣可破壞隔板（中央留隔離門缺口）。
     隔離門物件由 Game 建立於 doorGap。 */
  _carveICU() {
    // 腔室內部清空（fine rows 23..29, cols 14..25）
    for (let r = 23; r <= 29; r++) {
      for (let c = 14; c <= 25; c++) {
        this.grid[r][c] = { type: T.EMPTY, hp: 0 };
      }
    }
    // 兩側鋼牆（不可破壞）
    for (let r = 23; r <= 29; r++) {
      this.grid[r][13] = { type: T.WALL, hp: 0 };
      this.grid[r][26] = { type: T.WALL, hp: 0 };
    }
    // 前緣隔板列（row 23），中央 cols 19,20 留門缺口
    for (let c = 14; c <= 25; c++) {
      if (c === 19 || c === 20) continue;
      this.grid[23][c] = { type: T.PARTITION, hp: CONST.PARTITION_HP };
    }
  }

  /* 隔離門缺口的像素矩形（Game 用來建立門物件） */
  get doorGap() { return { x: 19 * CONST.TILE, y: 23 * CONST.TILE, w: 2 * CONST.TILE, h: CONST.TILE }; }

  cell(c, r) {
    if (c < 0 || c >= CONST.COLS || r < 0 || r >= CONST.ROWS) return null;
    return this.grid[r][c];
  }

  static entitySolid(type)     { return type === T.WALL || type === T.PARTITION || type === T.BED || type === T.EQUIP; }
  static projectileSolid(type) { return type === T.WALL || type === T.PARTITION || type === T.EQUIP; }

  /* 矩形是否撞到角色不可通過的地形或地圖邊界 */
  rectBlocksEntity(x, y, w, h) {
    if (x < 0 || y < 0 || x + w > CONST.CANVAS_W || y + h > CONST.CANVAS_H) return true;
    const t = CONST.TILE;
    const c0 = Math.floor(x / t), c1 = Math.floor((x + w - 0.01) / t);
    const r0 = Math.floor(y / t), r1 = Math.floor((y + h - 0.01) / t);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cell(c, r);
        if (cell && GameMap.entitySolid(cell.type)) return true;
      }
    }
    return false;
  }

  /* 抗生素投射物命中處理：回傳 'wall' | 'partition' | null。
     命中隔板時對命中格造成傷害；沿垂直於飛行方向擴 1 格（破口約兩格寬）。 */
  projectileImpact(x, y, w, h, dir, particles) {
    const t = CONST.TILE;
    const c0 = Math.floor(x / t), c1 = Math.floor((x + w - 0.01) / t);
    const r0 = Math.floor(y / t), r1 = Math.floor((y + h - 0.01) / t);
    let hitPart = false, hitWall = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cell(c, r);
        if (!cell) continue;
        if (cell.type === T.PARTITION) hitPart = true;
        else if (cell.type === T.WALL || cell.type === T.EQUIP) hitWall = true;
      }
    }
    if (hitPart) {
      const vertical = (dir === DIR.UP || dir === DIR.DOWN);
      const cells = [];
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          cells.push([r, c]);
          if (vertical) { cells.push([r, c - 1]); cells.push([r, c + 1]); }
          else { cells.push([r - 1, c]); cells.push([r + 1, c]); }
        }
      }
      for (const [r, c] of cells) {
        const cell = this.cell(c, r);
        if (cell && cell.type === T.PARTITION) {
          cell.hp--;
          if (cell.hp <= 0) {
            cell.type = T.EMPTY;
            if (particles) particles.partitionDebris(c * t + t / 2, r * t + t / 2);
          }
        }
      }
      return 'partition';
    }
    if (hitWall) return 'wall';
    return null;
  }

  /* 對某小格的隔板造成 dmg 點傷害（病原體腐蝕用）。回傳是否剛好破壞。 */
  damagePartitionAt(px, py, dmg, particles) {
    const t = CONST.TILE;
    const c = Math.floor(px / t), r = Math.floor(py / t);
    const cell = this.cell(c, r);
    if (!cell || cell.type !== T.PARTITION) return false;
    cell.hp -= dmg;
    if (cell.hp <= 0) {
      cell.type = T.EMPTY;
      if (particles) particles.partitionDebris(c * t + t / 2, r * t + t / 2);
      return true;
    }
    return false;
  }

  /* 視線是否無阻擋（供敵人視線判斷；隔板/牆/設備擋線） */
  lineOfSightClear(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 12);
    for (let i = 1; i < steps; i++) {
      const px = x0 + (dx * i) / steps;
      const py = y0 + (dy * i) / steps;
      const cell = this.cell(Math.floor(px / CONST.TILE), Math.floor(py / CONST.TILE));
      if (cell && GameMap.projectileSolid(cell.type)) return false;
    }
    return true;
  }

  /* ---------- 污染層 ---------- */
  contamAt(x, y) {
    const c = Math.floor(x / CONST.TILE), r = Math.floor(y / CONST.TILE);
    if (c < 0 || c >= CONST.COLS || r < 0 || r >= CONST.ROWS) return 0;
    return this.contam[r][c];
  }

  addContam(x, y, amount) {
    const c = Math.floor(x / CONST.TILE), r = Math.floor(y / CONST.TILE);
    if (c < 0 || c >= CONST.COLS || r < 0 || r >= CONST.ROWS) return;
    if (GameMap.entitySolid(this.grid[r][c].type)) return; // 不污染實心地形
    this.contam[r][c] = clamp(this.contam[r][c] + amount, 0, 1);
  }

  /* 清除以像素座標為中心、半徑 radius 內的污染。回傳清掉的格數（>0.15 才算）。 */
  clearContamCircle(cx, cy, radius) {
    const t = CONST.TILE;
    const c0 = Math.floor((cx - radius) / t), c1 = Math.floor((cx + radius) / t);
    const r0 = Math.floor((cy - radius) / t), r1 = Math.floor((cy + radius) / t);
    let cleared = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= CONST.COLS || r < 0 || r >= CONST.ROWS) continue;
        const dx = (c + 0.5) * t - cx, dy = (r + 0.5) * t - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        if (this.contam[r][c] > 0.15) cleared++;
        this.contam[r][c] = 0;
      }
    }
    return cleared;
  }

  /* 隨機在走道播撒污染（波次機制用） */
  seedContam(count) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 12) {
      tries++;
      const c = 4 + ((Math.random() * (CONST.COLS - 8)) | 0);
      const r = 6 + ((Math.random() * 14) | 0);
      if (r >= 23) continue; // 不種在 ICU 腔室
      if (GameMap.entitySolid(this.grid[r][c].type)) continue;
      this.contam[r][c] = clamp(this.contam[r][c] + 0.6, 0, 1);
      placed++;
    }
  }

  update(dt) {
    // 污染自然極緩慢消退（避免整張圖永久堆積）
    const decay = 0.006 * dt;
    for (let r = 0; r < CONST.ROWS; r++) {
      for (let c = 0; c < CONST.COLS; c++) {
        if (this.contam[r][c] > 0) this.contam[r][c] = Math.max(0, this.contam[r][c] - decay);
      }
    }
  }

  /* ---------- 繪製 ---------- */
  drawGround(ctx, time) {
    const t = CONST.TILE;
    // 地板底色 + 淡格線（醫院磁磚感）
    ctx.fillStyle = '#e8eef1';
    ctx.fillRect(0, 0, CONST.CANVAS_W, CONST.CANVAS_H);
    ctx.strokeStyle = 'rgba(150, 172, 185, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= CONST.CANVAS_W; x += t * 2) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, CONST.CANVAS_H); }
    for (let y = 0; y <= CONST.CANVAS_H; y += t * 2) { ctx.moveTo(0, y + 0.5); ctx.lineTo(CONST.CANVAS_W, y + 0.5); }
    ctx.stroke();

    // 污染層（半透明黃綠）
    for (let r = 0; r < CONST.ROWS; r++) {
      for (let c = 0; c < CONST.COLS; c++) {
        const v = this.contam[r][c];
        if (v <= 0.02) continue;
        const x = c * t, y = r * t;
        const pulse = 0.12 * Math.sin(time * 3 + c + r);
        ctx.fillStyle = `rgba(120, 190, 60, ${clamp(v * 0.55 + pulse, 0, 0.7)})`;
        ctx.fillRect(x, y, t, t);
        if (v > 0.5) {
          ctx.fillStyle = `rgba(150, 210, 80, ${0.25 * v})`;
          ctx.fillRect(x + 4, y + 4, t - 8, t - 8);
        }
      }
    }

    // 地形
    for (let r = 0; r < CONST.ROWS; r++) {
      for (let c = 0; c < CONST.COLS; c++) {
        const cell = this.grid[r][c];
        const x = c * t, y = r * t;
        switch (cell.type) {
          case T.WALL: this._drawWall(ctx, x, y); break;
          case T.PARTITION: this._drawPartition(ctx, x, y, cell.hp); break;
          case T.BED: this._drawBed(ctx, x, y, c, r); break;
          case T.EQUIP: this._drawEquip(ctx, x, y, c, r); break;
          default: break;
        }
      }
    }
  }

  _drawWall(ctx, x, y) {
    const t = CONST.TILE;
    ctx.fillStyle = '#9fb2c4';
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = '#c3d0dc';
    ctx.fillRect(x + 2, y + 2, t - 4, t - 4);
    ctx.fillStyle = '#7d8ea0';
    ctx.fillRect(x + 2, y + t - 6, t - 4, 4);
  }

  _drawPartition(ctx, x, y, hp) {
    const t = CONST.TILE;
    const dmg = hp < CONST.PARTITION_HP;
    // 塑膠隔簾感：淡藍半透明條紋
    ctx.fillStyle = dmg ? '#8fd0c4' : '#a7e0d6';
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 3 + i * 7, y + 2, 3, t - 4);
    ctx.strokeStyle = '#4f9c8c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
    if (dmg) {
      ctx.strokeStyle = 'rgba(40, 90, 80, 0.8)';
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + 12, y + 13); ctx.lineTo(x + 8, y + 21);
      ctx.stroke();
    }
  }

  _drawBed(ctx, x, y, c, r) {
    const t = CONST.TILE;
    // 每張病床由 2x1 巨集構成；用左上小格畫床頭較費工，這裡逐小格畫床面
    ctx.fillStyle = '#dfeaf0';
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = '#bcd0dd';
    ctx.fillRect(x, y, t, 5);           // 床頭板
    ctx.fillStyle = '#9fc7e6';
    ctx.fillRect(x + 3, y + 8, t - 6, t - 12); // 藍色床墊
    ctx.strokeStyle = '#8aa6b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, t - 1, t - 1);
  }

  _drawEquip(ctx, x, y, c, r) {
    const t = CONST.TILE;
    ctx.fillStyle = '#cdd6de';
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = '#5a6b7a';
    ctx.fillRect(x + 3, y + 3, t - 6, t - 10); // 螢幕外框
    // 監視器綠色波形
    ctx.fillStyle = '#57e08a';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 11);
    ctx.lineTo(x + 8, y + 11); ctx.lineTo(x + 10, y + 6);
    ctx.lineTo(x + 12, y + 15); ctx.lineTo(x + 15, y + 11);
    ctx.lineTo(x + 20, y + 11);
    ctx.strokeStyle = '#57e08a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#8a97a4';
    ctx.fillRect(x + 8, y + t - 5, t - 16, 4); // 底座
  }
}
