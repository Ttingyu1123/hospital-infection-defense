'use strict';
/* 網格化地圖。以 20x15 巨集格（每格 2x2 小格）設計固定地圖，
   小格（24px）為碰撞與破壞單位。磚牆每小格有耐久。 */

/* 固定地圖設計（20 欄 x 15 列）：
   . 空地  B 磚牆  S 鋼牆  W 水面  G 草叢
   底部中央的基地區域由程式另行雕刻（清空 + 磚牆環 + 基地）。 */
const MACRO_MAP = [
  '....................',
  '.BB.BB.BB..BB.BB.BB.',
  '.BB.BB.BB..BB.BB.BB.',
  '.BB.BB.BB..BB.BB.BB.',
  '....................',
  '.SS....BB..BB....SS.',
  '....GG.B....B.GG....',
  'WW..GG.B.SS.B.GG..WW',
  'WW..GG.B.SS.B.GG..WW',
  '....GG.B....B.GG....',
  '.BB....BB..BB....BB.',
  '.BB..............BB.',
  '....BB.SS..SS.BB....',
  '.BB.BB........BB.BB.',
  '....................',
];

const CHAR_TO_TILE = { '.': T.EMPTY, 'B': T.BRICK, 'S': T.STEEL, 'W': T.WATER, 'G': T.GRASS };

class GameMap {
  constructor() {
    this.grid = [];   // grid[row][col] = { type, hp }
    this.reset();
  }

  reset() {
    this.grid = [];
    for (let r = 0; r < CONST.ROWS; r++) {
      const row = [];
      for (let c = 0; c < CONST.COLS; c++) {
        const ch = MACRO_MAP[r >> 1][c >> 1];
        const type = CHAR_TO_TILE[ch];
        row.push({ type, hp: type === T.BRICK ? CONST.BRICK_HP : 0 });
      }
      this.grid.push(row);
    }
    this._carveBaseArea();
  }

  /* 基地防禦區：清空 + 8 格磚牆環（基地本體矩形由 Game 管理） */
  _carveBaseArea() {
    for (let r = 26; r <= 29; r++) {
      for (let c = 17; c <= 22; c++) {
        this.grid[r][c] = { type: T.EMPTY, hp: 0 };
      }
    }
    const ring = [
      [27, 18], [28, 18], [29, 18],
      [27, 21], [28, 21], [29, 21],
      [27, 19], [27, 20],
    ];
    for (const [r, c] of ring) {
      this.grid[r][c] = { type: T.BRICK, hp: CONST.BRICK_HP };
    }
  }

  cell(c, r) {
    if (c < 0 || c >= CONST.COLS || r < 0 || r >= CONST.ROWS) return null;
    return this.grid[r][c];
  }

  static tankSolid(type)   { return type === T.BRICK || type === T.STEEL || type === T.WATER; }
  static bulletSolid(type) { return type === T.BRICK || type === T.STEEL; }

  /* 矩形是否撞到坦克不可通過的地形或地圖邊界 */
  rectBlocksTank(x, y, w, h) {
    if (x < 0 || y < 0 || x + w > CONST.CANVAS_W || y + h > CONST.CANVAS_H) return true;
    const t = CONST.TILE;
    const c0 = Math.floor(x / t), c1 = Math.floor((x + w - 0.01) / t);
    const r0 = Math.floor(y / t), r1 = Math.floor((y + h - 0.01) / t);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cell(c, r);
        if (cell && GameMap.tankSolid(cell.type)) return true;
      }
    }
    return false;
  }

  /* 子彈命中處理：回傳 'brick' | 'steel' | null。
     命中磚牆時對垂直於飛行方向 ±expand 範圍的磚格造成傷害（破口約兩格寬）。 */
  bulletImpact(x, y, w, h, dir, particles) {
    const t = CONST.TILE;
    const c0 = Math.floor(x / t), c1 = Math.floor((x + w - 0.01) / t);
    const r0 = Math.floor(y / t), r1 = Math.floor((y + h - 0.01) / t);
    let hitBrick = false, hitSteel = false;
    let impactRow = -1, impactCol = -1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.cell(c, r);
        if (!cell) continue;
        if (cell.type === T.BRICK) { hitBrick = true; impactRow = r; impactCol = c; }
        else if (cell.type === T.STEEL) hitSteel = true;
      }
    }
    if (hitBrick) {
      // 沿垂直軸擴大破壞範圍：上下向 → 左右擴 1 格；左右向 → 上下擴 1 格
      const cells = [];
      const vertical = (dir === DIR.UP || dir === DIR.DOWN);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          cells.push([r, c]);
          if (vertical) { cells.push([r, c - 1]); cells.push([r, c + 1]); }
          else { cells.push([r - 1, c]); cells.push([r + 1, c]); }
        }
      }
      for (const [r, c] of cells) {
        const cell = this.cell(c, r);
        if (cell && cell.type === T.BRICK) {
          cell.hp--;
          if (cell.hp <= 0) {
            cell.type = T.EMPTY;
            if (particles) particles.brickDebris(c * t + t / 2, r * t + t / 2);
          }
        }
      }
      return 'brick';
    }
    if (hitSteel) return 'steel';
    return null;
  }

  /* 檢查某方向直線上是否無阻擋（供敵人視線判斷）。 */
  lineOfSightClear(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 12);
    for (let i = 1; i < steps; i++) {
      const px = x0 + (dx * i) / steps;
      const py = y0 + (dy * i) / steps;
      const cell = this.cell(Math.floor(px / CONST.TILE), Math.floor(py / CONST.TILE));
      if (cell && GameMap.bulletSolid(cell.type)) return false;
    }
    return true;
  }

  /* 底層地形（草叢除外，草叢畫在坦克上方） */
  drawGround(ctx, time) {
    const t = CONST.TILE;
    for (let r = 0; r < CONST.ROWS; r++) {
      for (let c = 0; c < CONST.COLS; c++) {
        const cell = this.grid[r][c];
        const x = c * t, y = r * t;
        switch (cell.type) {
          case T.BRICK: this._drawBrick(ctx, x, y, cell.hp); break;
          case T.STEEL: this._drawSteel(ctx, x, y); break;
          case T.WATER: this._drawWater(ctx, x, y, time, c, r); break;
          default: break; // 空地 = 背景色
        }
      }
    }
  }

  _drawBrick(ctx, x, y, hp) {
    const t = CONST.TILE;
    ctx.fillStyle = hp >= CONST.BRICK_HP ? '#a5541a' : '#7c3f13';
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = hp >= CONST.BRICK_HP ? '#c26a28' : '#94531f';
    // 磚塊紋理：兩排錯位磚
    ctx.fillRect(x + 1, y + 1, 10, 4);
    ctx.fillRect(x + 13, y + 1, 10, 4);
    ctx.fillRect(x + 1, y + 7, 4, 4);
    ctx.fillRect(x + 7, y + 7, 10, 4);
    ctx.fillRect(x + 19, y + 7, 4, 4);
    ctx.fillRect(x + 1, y + 13, 10, 4);
    ctx.fillRect(x + 13, y + 13, 10, 4);
    ctx.fillRect(x + 1, y + 19, 4, 4);
    ctx.fillRect(x + 7, y + 19, 10, 4);
    ctx.fillRect(x + 19, y + 19, 4, 4);
    if (hp < CONST.BRICK_HP) {
      // 受損裂痕
      ctx.strokeStyle = '#2b1608';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + 12, y + 12); ctx.lineTo(x + 8, y + 21);
      ctx.moveTo(x + 20, y + 4); ctx.lineTo(x + 13, y + 13);
      ctx.stroke();
    }
  }

  _drawSteel(ctx, x, y) {
    const t = CONST.TILE;
    ctx.fillStyle = '#8f99a8';
    ctx.fillRect(x, y, t, t);
    ctx.fillStyle = '#c7d0dc';
    ctx.fillRect(x + 3, y + 3, t - 6, t - 6);
    ctx.fillStyle = '#5d6674';
    ctx.fillRect(x + 8, y + 8, t - 16, t - 16);
  }

  _drawWater(ctx, x, y, time, c, r) {
    const t = CONST.TILE;
    ctx.fillStyle = '#123a5e';
    ctx.fillRect(x, y, t, t);
    // 簡單波紋：依時間與座標相位移動的亮紋
    const phase = Math.sin(time * 2.2 + c * 1.3 + r * 0.9);
    ctx.fillStyle = 'rgba(90, 170, 230, 0.5)';
    const off = (phase + 1) * 6;
    ctx.fillRect(x + 2, y + 4 + off * 0.6, t - 4, 2);
    ctx.fillRect(x + 4, y + 14 - off * 0.4, t - 8, 2);
  }

  /* 草叢層：畫在坦克上方，帶縫隙讓坦克部分可見 */
  drawGrass(ctx) {
    const t = CONST.TILE;
    for (let r = 0; r < CONST.ROWS; r++) {
      for (let c = 0; c < CONST.COLS; c++) {
        if (this.grid[r][c].type !== T.GRASS) continue;
        const x = c * t, y = r * t;
        ctx.fillStyle = '#1d5c2a';
        // 4x4 棋盤狀草簇，留縫隙
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            if ((i + j + c + r) % 2 === 0) {
              ctx.fillRect(x + i * 6, y + j * 6, 5, 5);
            }
          }
        }
        ctx.fillStyle = '#2e8b3d';
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 4; j++) {
            if ((i + j + c + r) % 2 === 1 && (i * 7 + j * 5) % 3 === 0) {
              ctx.fillRect(x + i * 6 + 1, y + j * 6 + 1, 3, 3);
            }
          }
        }
      }
    }
  }
}
