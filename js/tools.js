'use strict';
/* 三種感染控制工具的啟動邏輯與傷害/抗性計算。
   幾何命中在此，特效與計分回呼交給 Game。 */

/* 敵人類型（含 'boss'）對某工具的傷害倍率 */
function resMultiplier(enemyType, toolId) {
  const row = CONST.RES[enemyType];
  return row ? (row[toolId] !== undefined ? row[toolId] : 1) : 1;
}

const Tools = {
  /* 對單一敵人施加工具傷害；處理教育提示（抗生素對病毒無效、酒精對芽孢極低）。
     回傳實際造成的傷害量。 */
  applyDamage(game, enemy, toolId, baseAmount) {
    const type = enemy.isBoss ? 'boss' : enemy.type;
    const mult = resMultiplier(type, toolId);
    // 教育提示觸發
    if (toolId === 'antibiotic' && type === 'virus') game.triggerTip('antibioticVirus');
    if (toolId === 'alcohol' && type === 'spore') game.triggerTip('sporeAlcohol');
    const dmg = baseAmount * mult;
    if (dmg <= 0) {
      game.spawnFloatText(enemy.x, enemy.y - enemy.half - 8, '無效', '#c7d0dc');
      return 0;
    }
    if (mult >= 0.75) game.correctToolUses++;
    enemy.takeDamage(dmg, toolId, game);
    return dmg;
  },

  /* 酒精噴霧：扇形近距離 AoE + 清除前方污染 */
  alcohol(game, player) {
    const cfg = CONST.TOOLS.alcohol;
    const v = DIR_VECS[player.dir];
    const bonus = player.handHygiene > 0 ? 1.5 : 1; // 完成手部衛生後效果提升
    const base = cfg.damage * bonus;
    const facing = DIR_ANGLE[player.dir];

    for (const e of game.livingEnemies()) {
      const dx = e.x - player.x, dy = e.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > cfg.range + e.half) continue;
      let ang = Math.atan2(dy, dx) - facing;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > cfg.halfAngle) continue;
      this.applyDamage(game, e, 'alcohol', base);
    }
    // 清除前方污染
    const px = player.x + v.x * cfg.range * 0.5;
    const py = player.y + v.y * cfg.range * 0.5;
    const cleared = game.map.clearContamCircle(px, py, cfg.range * 0.55);
    if (cleared > 0) game.onContamCleared(cleared, px, py);

    game.effects.push({ type: 'cone', x: player.x, y: player.y, dir: player.dir,
      range: cfg.range, halfAngle: cfg.halfAngle, color: cfg.color, life: 0, maxLife: 0.22 });
    game.particles.alcoholMist(player.x + v.x * 20, player.y + v.y * 20, player.dir);
    audioSys.alcoholSpray();
  },

  /* 抗生素發射器：直線膠囊投射物 */
  antibiotic(game, player) {
    const cfg = CONST.TOOLS.antibiotic;
    const v = DIR_VECS[player.dir];
    const muzzle = player.half + 8;
    const p = new Projectile(player.x + v.x * muzzle, player.y + v.y * muzzle,
      player.dir, cfg.bulletSpeed, 'player', 'antibiotic', cfg.damage, player);
    game.projectiles.push(p);
    player.activeBullets++;
    audioSys.antibioticFire();
  },

  /* 紫外線消毒器：直線光束，穿過並命中多個敵人 + 清除沿線污染 */
  uv(game, player) {
    const cfg = CONST.TOOLS.uv;
    const v = DIR_VECS[player.dir];
    // 光束長度：延伸到牆或射程上限
    let len = cfg.range;
    const step = 8;
    for (let d = player.half; d <= cfg.range; d += step) {
      const px = player.x + v.x * d, py = player.y + v.y * d;
      const cell = game.map.cell(Math.floor(px / CONST.TILE), Math.floor(py / CONST.TILE));
      if (cell && GameMap.projectileSolid(cell.type)) { len = d; break; }
      if (px < 0 || px > CONST.CANVAS_W || py < 0 || py > CONST.CANVAS_H) { len = d; break; }
    }
    // 命中敵人：沿光束軸投影在 [half, len]、垂直距離在半寬內
    for (const e of game.livingEnemies()) {
      const dx = e.x - player.x, dy = e.y - player.y;
      const along = dx * v.x + dy * v.y;
      if (along < 0 || along > len + e.half) continue;
      const perp = Math.abs(dx * -v.y + dy * v.x);
      if (perp > cfg.halfWidth + e.half) continue;
      this.applyDamage(game, e, 'uv', cfg.damage);
    }
    // 沿線清污染
    let cleared = 0;
    for (let d = player.half; d <= len; d += CONST.TILE) {
      cleared += game.map.clearContamCircle(player.x + v.x * d, player.y + v.y * d, CONST.TILE);
    }
    if (cleared > 0) game.onContamCleared(cleared, player.x + v.x * len * 0.5, player.y + v.y * len * 0.5);

    game.effects.push({ type: 'beam', x: player.x, y: player.y, dir: player.dir,
      len, halfWidth: cfg.halfWidth, color: cfg.color, life: 0, maxLife: cfg.beamTime });
    audioSys.uvBeam();
  },

  activate(game, player, toolId) {
    switch (toolId) {
      case 'alcohol': this.alcohol(game, player); break;
      case 'antibiotic': this.antibiotic(game, player); break;
      case 'uv': this.uv(game, player); break;
    }
  },

  /* 特效繪製（cone / beam），依 life 淡出 */
  drawEffect(ctx, fx) {
    const a = 1 - fx.life / fx.maxLife;
    ctx.save();
    ctx.translate(fx.x, fx.y);
    ctx.rotate(DIR_ANGLE[fx.dir]);
    if (fx.type === 'cone') {
      const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, fx.range);
      grad.addColorStop(0, `rgba(180, 240, 250, ${0.5 * a})`);
      grad.addColorStop(1, `rgba(127, 216, 232, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, fx.range, -fx.halfAngle, fx.halfAngle);
      ctx.closePath();
      ctx.fill();
    } else if (fx.type === 'beam') {
      const w = fx.halfWidth;
      const grad = ctx.createLinearGradient(0, -w, 0, w);
      grad.addColorStop(0, `rgba(185, 140, 240, 0)`);
      grad.addColorStop(0.5, `rgba(210, 170, 255, ${0.75 * a})`);
      grad.addColorStop(1, `rgba(185, 140, 240, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, -w, fx.len, w * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * a})`;
      ctx.fillRect(0, -2, fx.len, 4);
    }
    ctx.restore();
  },
};
