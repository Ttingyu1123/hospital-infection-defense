'use strict';
/* 全域常數集中管理。所有檔案共用（classic script 順序載入）。 */

const CONST = Object.freeze({
  CANVAS_W: 960,
  CANVAS_H: 720,
  TILE: 24,          // 小格尺寸（碰撞 / 破壞單位）
  COLS: 40,
  ROWS: 30,
  DT_MAX: 0.05,      // delta time 上限：切換分頁回來不瞬移

  TANK_SIZE: 40,     // 走道寬 48px，留 8px 餘裕
  ALIGN_SNAP: 10,    // 轉向時允許吸附到走道中線的最大距離

  BULLET_SIZE: 8,
  BULLET_SUBSTEP: 8, // 子彈掃掠碰撞的子步長，防止穿牆

  PLAYER: Object.freeze({
    speed: 150,
    cooldown: 0.33,
    maxBullets: 2,
    bulletSpeed: 380,
    lives: 3,
    respawnDelay: 1.2,
    invincibleTime: 3.0,
    spawnX: 360,
    spawnY: 696,
  }),

  ENEMY_TYPES: Object.freeze({
    normal: Object.freeze({ speed: 95,  hp: 1, size: 40, cooldown: 1.3, bulletSpeed: 300, score: 100, color: '#aab2bf', dark: '#6c7480' }),
    fast:   Object.freeze({ speed: 155, hp: 1, size: 38, cooldown: 1.1, bulletSpeed: 330, score: 150, color: '#4fc3e8', dark: '#2b7f9c' }),
    heavy:  Object.freeze({ speed: 62,  hp: 4, size: 44, cooldown: 1.5, bulletSpeed: 280, score: 300, color: '#d06060', dark: '#8a3a3a' }),
  }),

  ENEMY_SPAWNS: Object.freeze([
    Object.freeze({ x: 24,  y: 24 }),
    Object.freeze({ x: 480, y: 24 }),
    Object.freeze({ x: 936, y: 24 }),
  ]),

  // 每波：敵人組成、同時在場上限、生成間隔
  WAVES: Object.freeze([
    Object.freeze({ list: ['normal','normal','normal','normal'],                                            maxAlive: 3, interval: 2.4 }),
    Object.freeze({ list: ['normal','normal','normal','normal','normal','normal'],                          maxAlive: 4, interval: 2.2 }),
    Object.freeze({ list: ['normal','fast','normal','fast','normal','fast'],                                maxAlive: 4, interval: 2.0 }),
    Object.freeze({ list: ['normal','heavy','fast','normal','fast','heavy','normal'],                       maxAlive: 4, interval: 2.0 }),
    Object.freeze({ list: ['fast','normal','heavy','fast','normal','heavy','fast','normal','heavy',
                           'fast','normal'],                                                                 maxAlive: 5, interval: 1.8 }),
  ]),
  WAVE_BONUS: 300,          // 完成波次加分 = WAVE_BONUS * 波數
  WAVE_TRANSITION_TIME: 2.5,
  SPAWN_WARN_TIME: 0.9,     // 生成前的警示閃爍時間

  BRICK_HP: 2,              // 磚牆每小格耐久
  MAX_PARTICLES: 400,

  // 字型堆疊：英數用銳利的系統等寬字型；中文明確指定黑體系，避免掉到預設襯線
  FONTS: Object.freeze({
    MONO: "'Consolas', 'Menlo', 'Courier New', monospace",
    CJK: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif",
  }),
  HUD_H: 30,
});

/* 方向：0上 1右 2下 3左 */
const DIR = Object.freeze({ UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 });
const DIR_VECS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);

/* 地形種類 */
const T = Object.freeze({ EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, GRASS: 4 });

/* 遊戲狀態 */
const STATE = Object.freeze({
  START: 'START',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  WAVE_TRANSITION: 'WAVE_TRANSITION',
  PLAYER_RESPAWNING: 'PLAYER_RESPAWNING',
  GAME_OVER: 'GAME_OVER',
  VICTORY: 'VICTORY',
});

/* 共用小工具 */
function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
