'use strict';
/* 全域常數集中管理。所有檔案共用（classic script 順序載入）。
   《醫院防疫大作戰》— 感染管制俯視角防守遊戲。 */

const CONST = Object.freeze({
  CANVAS_W: 960,
  CANVAS_H: 720,
  TILE: 24,          // 小格尺寸（碰撞 / 破壞單位）
  COLS: 40,
  ROWS: 30,
  DT_MAX: 0.05,      // delta time 上限：切換分頁回來不瞬移

  UNIT_SIZE: 34,     // 玩家醫師的碰撞方框
  ALIGN_SNAP: 10,    // 轉向時允許吸附到走道中線的最大距離
  HUD_H: 64,         // 上方狀態列高度（兩排）

  BULLET_SUBSTEP: 8, // 投射物掃掠碰撞子步長，防止穿牆

  PLAYER: Object.freeze({
    speed: 168,
    lives: 3,
    respawnDelay: 1.2,
    invincibleTime: 2.6,
    spawnX: 480,
    spawnY: 636,
  }),

  // 三種感染控制工具。cooldown=攻擊冷卻；energy=能量池，發射扣 use、每秒回 regen。
  TOOLS: Object.freeze({
    alcohol: Object.freeze({
      id: 'alcohol', key: '1', name: '酒精噴霧', short: '酒精',
      color: '#7fd8e8', cooldown: 0.26, range: 120, halfAngle: 0.62,
      energyMax: 100, energyUse: 7, regen: 26, damage: 0.85,
    }),
    antibiotic: Object.freeze({
      id: 'antibiotic', key: '2', name: '抗生素發射器', short: '抗生素',
      color: '#f2c14e', cooldown: 0.34, bulletSpeed: 430,
      energyMax: 100, energyUse: 12, regen: 20, damage: 1.0, maxBullets: 3,
    }),
    uv: Object.freeze({
      id: 'uv', key: '3', name: '紫外線消毒器', short: '紫外線',
      color: '#b98cf0', cooldown: 1.1, range: 460, halfWidth: 22,
      energyMax: 100, energyUse: 34, regen: 13, damage: 2.2, beamTime: 0.28,
    }),
  }),
  TOOL_ORDER: Object.freeze(['alcohol', 'antibiotic', 'uv']),

  // 敵人（病原體）數值。hp 為「命中單位」，工具傷害乘上抗性倍率後扣。
  ENEMY_TYPES: Object.freeze({
    normal:    Object.freeze({ speed: 70,  hp: 1, size: 30, score: 100, color: '#5cbf4a', dark: '#2f7a24', patientDps: 9,  contactDmg: 1, corrode: 0.9 }),
    virus:     Object.freeze({ speed: 118, hp: 1, size: 26, score: 120, color: '#a45bd6', dark: '#5f2f88', patientDps: 8,  contactDmg: 1, corrode: 0.7, erratic: true }),
    spore:     Object.freeze({ speed: 46,  hp: 3, size: 40, score: 180, color: '#c9a24b', dark: '#7c5f1f', patientDps: 10, contactDmg: 1, corrode: 1.1, trail: true }),
    resistant: Object.freeze({ speed: 62,  hp: 6, size: 40, score: 300, color: '#d0392b', dark: '#7a1810', patientDps: 16, contactDmg: 1, corrode: 2.2, targetsPatient: true }),
  }),

  // 抗性矩陣 RES[敵人類型][工具] = 傷害倍率。教育重點：抗生素對病毒 0、酒精對芽孢極低。
  RES: Object.freeze({
    normal:    Object.freeze({ alcohol: 1.0,  antibiotic: 1.0,  uv: 0.6 }),
    virus:     Object.freeze({ alcohol: 0.55, antibiotic: 0.0,  uv: 1.0 }),
    spore:     Object.freeze({ alcohol: 0.14, antibiotic: 0.5,  uv: 1.0 }),
    resistant: Object.freeze({ alcohol: 0.5,  antibiotic: 0.25, uv: 0.9 }),
    boss:      Object.freeze({ alcohol: 0.35, antibiotic: 0.2,  uv: 1.0 }),
  }),

  // 病原體生成點（HUD 下方的空走廊，避開牆與 HUD）
  ENEMY_SPAWNS: Object.freeze([
    Object.freeze({ x: 180, y: 92 }),
    Object.freeze({ x: 480, y: 92 }),
    Object.freeze({ x: 672, y: 92 }),
  ]),

  // 每波：病原體組成、同時在場上限、生成間隔、是否啟用環境污染
  WAVES: Object.freeze([
    Object.freeze({ name: '基礎清潔', list: ['normal','normal','normal','normal','normal'],
                    maxAlive: 3, interval: 2.4, contam: false }),
    Object.freeze({ name: '病毒入侵', list: ['normal','virus','normal','virus','normal','virus','normal'],
                    maxAlive: 4, interval: 2.1, contam: false }),
    Object.freeze({ name: '環境污染', list: ['normal','virus','spore','normal','spore','virus','normal','spore'],
                    maxAlive: 4, interval: 2.0, contam: true }),
    Object.freeze({ name: '抗藥性危機', list: ['spore','resistant','virus','spore','resistant','virus','resistant','spore'],
                    maxAlive: 5, interval: 1.9, contam: true }),
    Object.freeze({ name: '超級抗藥菌王', list: ['normal','virus','spore'], // Boss 期間的少量增援
                    maxAlive: 4, interval: 3.2, contam: true, boss: true }),
  ]),
  WAVE_BONUS: 500,
  BOSS_SCORE: 2000,
  WAVE_TRANSITION_TIME: 2.6,
  SPAWN_WARN_TIME: 0.9,
  PATIENT_WAVE_HEAL: 12,   // 完成波次回復病人生命

  PARTITION_HP: 3,         // 污染隔板耐久（隔離門用 DOOR_HP）
  DOOR_HP: 8,
  DOOR_RECLOSE_CD: 8.0,    // 隔離門重新關閉冷卻
  WASH_CD: 6.0,            // 洗手台使用冷卻

  PATIENT_HP: 100,

  // 病人保護目標框（畫面底部中央）
  PATIENT_RECT: Object.freeze({ x: 384, y: 672, w: 192, h: 48 }),

  // 增益 / 道具時間
  HAND_HYGIENE_TIME: 12.0,
  PPE_ABSORB: 1,           // PPE 可吸收的傷害次數
  ISOLATION_SLOW_TIME: 6.0,
  ITEM_LIFETIME: 12.0,

  // 疫苗接種站：給病人一段時間的傷害減免
  VACCINE_CD: 14.0,
  PATIENT_SHIELD_TIME: 12.0,
  PATIENT_SHIELD_MUL: 0.45,  // 疫苗防護期間病人受傷倍率

  // 難度：套用於敵人數值、病人受傷、玩家無敵時間
  DIFFICULTY: Object.freeze([
    Object.freeze({ name: '簡單', enemyHp: 0.8, enemySpeed: 0.85, spawnMul: 1.3, patientDmg: 0.7, invulnMul: 1.35 }),
    Object.freeze({ name: '普通', enemyHp: 1.0, enemySpeed: 1.0,  spawnMul: 1.0, patientDmg: 1.0, invulnMul: 1.0 }),
    Object.freeze({ name: '困難', enemyHp: 1.3, enemySpeed: 1.15, spawnMul: 0.82, patientDmg: 1.4, invulnMul: 0.8 }),
  ]),

  MAX_PARTICLES: 480,

  SCORE: Object.freeze({
    contamClear: 50, ppe: 20, handHygiene: 30, wave: 500, boss: 2000,
  }),

  FONTS: Object.freeze({
    MONO: "'Consolas', 'Menlo', 'Courier New', monospace",
    CJK: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif",
  }),
});

/* 方向：0上 1右 2下 3左 */
const DIR = Object.freeze({ UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 });
const DIR_VECS = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);
const DIR_ANGLE = Object.freeze([-Math.PI / 2, 0, Math.PI / 2, Math.PI]);

/* 地形種類 */
const T = Object.freeze({
  EMPTY: 0,
  WALL: 1,       // 普通牆壁：不可破壞，擋角色與投射物
  PARTITION: 2,  // 污染隔板：可破壞
  BED: 3,        // 病床：擋角色，不擋投射物
  EQUIP: 4,      // 醫療設備：擋角色與投射物
});

/* 遊戲狀態 */
const STATE = Object.freeze({
  START: 'START',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  WAVE_TRANSITION: 'WAVE_TRANSITION',
  PLAYER_RESPAWNING: 'PLAYER_RESPAWNING',
  BOSS_INTRO: 'BOSS_INTRO',
  GAME_OVER: 'GAME_OVER',
  VICTORY: 'VICTORY',
});

/* 共用小工具 */
function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
