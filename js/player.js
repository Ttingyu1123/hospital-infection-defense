'use strict';
/* 玩家：感染管制醫師。四方向移動、三種工具（能量+冷卻）、PPE 護盾、
   洗手增益、生命與重生無敵。繪製為卡通俯視醫師。 */

class Player extends Entity {
  constructor() {
    const P = CONST.PLAYER;
    super(P.spawnX, P.spawnY, CONST.UNIT_SIZE, P.speed);
    this.lives = P.lives;
    this.invincible = P.invincibleTime;
    this.dir = DIR.UP;

    this.toolId = 'alcohol';
    this.cooldowns = { alcohol: 0, antibiotic: 0, uv: 0 };
    this.energy = { alcohol: CONST.TOOLS.alcohol.energyMax, antibiotic: CONST.TOOLS.antibiotic.energyMax, uv: CONST.TOOLS.uv.energyMax };
    this.activeBullets = 0; // 場上抗生素膠囊數

    this.ppe = 0;            // PPE 護盾可吸收次數
    this.handHygiene = 0;    // 洗手增益剩餘秒數
    this.supplyBoost = 0;    // 消毒補給：短暫縮短冷卻

    this.moving = false;
    this.attackAnim = 0;     // 攻擊動作計時（繪製用）
  }

  respawnReset() {
    const P = CONST.PLAYER;
    this.x = P.spawnX; this.y = P.spawnY;
    this.dir = DIR.UP;
    this.alive = true;
    this.invincible = P.invincibleTime;
    this.activeBullets = 0;
    for (const k in this.cooldowns) this.cooldowns[k] = 0;
  }

  setTool(id) {
    if (this.toolId === id) return;
    this.toolId = id;
    audioSys.toolSwitch();
  }

  cycleTool(delta) {
    const order = CONST.TOOL_ORDER;
    const i = order.indexOf(this.toolId);
    this.setTool(order[(i + delta + order.length) % order.length]);
  }

  update(dt, game, input) {
    this.updateTimers(dt);
    if (this.invincible > 0) this.invincible -= dt;
    if (this.handHygiene > 0) this.handHygiene -= dt;
    if (this.supplyBoost > 0) this.supplyBoost -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;

    // 工具冷卻與能量回充
    for (const id of CONST.TOOL_ORDER) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] -= dt;
      const cfg = CONST.TOOLS[id];
      if (this.energy[id] < cfg.energyMax) this.energy[id] = Math.min(cfg.energyMax, this.energy[id] + cfg.regen * dt);
    }

    // 移動
    const dir = input.currentDir();
    this.moving = false;
    if (dir !== null) {
      this.setDir(dir, game);
      this.moving = this.move(dt, game);
    }

    // 攻擊
    if (input.isDown('Space')) this.tryUseTool(game);
  }

  canUseTool(id) {
    const cfg = CONST.TOOLS[id];
    if (this.cooldowns[id] > 0) return false;
    if (this.energy[id] < cfg.energyUse) return false;
    if (id === 'antibiotic' && this.activeBullets >= cfg.maxBullets) return false;
    return true;
  }

  tryUseTool(game) {
    const id = this.toolId;
    if (!this.canUseTool(id)) return;
    const cfg = CONST.TOOLS[id];
    this.energy[id] -= cfg.energyUse;
    this.cooldowns[id] = cfg.cooldown * (this.supplyBoost > 0 ? 0.6 : 1);
    this.attackAnim = 0.18;
    Tools.activate(game, this, id);
  }

  /* 受到一次傷害；PPE 先擋，否則扣命並進入無敵。回傳 'ppe' | 'hit' | 'ignore'。 */
  takeHit(game) {
    if (this.invincible > 0) return 'ignore';
    if (this.ppe > 0) {
      this.ppe--;
      this.invincible = 1.0;
      this.hitFlash = 0.12;
      game.particles.shieldBreak(this.x, this.y);
      audioSys.shieldBreak();
      return 'ppe';
    }
    this.lives--;
    this.hitFlash = 0.15;
    this.alive = false; // Game 依 lives 決定重生或結束
    audioSys.playerHit();
    return 'hit';
  }

  /* 站在污染區的持續傷害由 Game 處理減速；這裡提供實效速度 */
  effectiveSpeed(contam) {
    let s = CONST.PLAYER.speed;
    if (contam > 0.2) s *= (this.handHygiene > 0 ? 0.85 : 0.62); // 手部衛生降低污染影響
    return s;
  }

  draw(ctx, time) {
    if (!this.alive) return;
    const blink = this.invincible > 0 && Math.floor(time * 12) % 2 === 0;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.5;

    const x = this.x, y = this.y, h = this.half;
    // 影子
    ctx.fillStyle = 'rgba(30,50,60,0.18)';
    ctx.beginPath(); ctx.ellipse(x, y + h - 2, h * 0.8, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    // 手持工具（在面向方向的前方）
    const v = DIR_VECS[this.dir];
    const reach = h + (this.attackAnim > 0 ? 8 : 2);
    const tx = x + v.x * reach, ty = y + v.y * reach;
    const toolCol = CONST.TOOLS[this.toolId].color;
    ctx.fillStyle = '#3a4652';
    ctx.fillRect(x + v.x * (h - 4) - 3, y + v.y * (h - 4) - 3, 6, 6); // 手
    ctx.fillStyle = toolCol;
    ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();

    // 白袍身體
    const flash = this.hitFlash > 0;
    ctx.fillStyle = flash ? '#ffd0d0' : '#ffffff';
    this._roundRect(ctx, x - h + 3, y - h + 6, this.size - 6, this.size - 6, 8);
    ctx.fill();
    ctx.strokeStyle = '#b7c6d0'; ctx.lineWidth = 1.5; ctx.stroke();
    // 藍綠內搭 V 領
    ctx.fillStyle = flash ? '#e07a7a' : '#1fb7a6';
    ctx.beginPath();
    ctx.moveTo(x, y - h + 8);
    ctx.lineTo(x - 6, y + 4); ctx.lineTo(x + 6, y + 4); ctx.closePath(); ctx.fill();
    // 名牌
    ctx.fillStyle = '#2b7fb8';
    ctx.fillRect(x + 2, y - 2, 6, 4);
    // 聽診器
    ctx.strokeStyle = '#4a5560'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x - 3, y - 1, 5, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();

    // 頭 + 口罩 + 帽
    ctx.fillStyle = flash ? '#ffe0e0' : '#f4c9a0';
    ctx.beginPath(); ctx.arc(x, y - h + 6, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eaf4f2'; // 口罩
    ctx.beginPath(); ctx.arc(x, y - h + 8, 7, 0.1, Math.PI - 0.1); ctx.fill();
    ctx.fillStyle = '#1fb7a6'; // 手術帽
    ctx.beginPath(); ctx.arc(x, y - h + 5, 8, Math.PI, Math.PI * 2); ctx.fill();

    ctx.restore();

    // 護盾（無敵或 PPE）
    if (this.invincible > 0 || this.ppe > 0) {
      const col = this.ppe > 0 ? '90, 200, 224' : '120, 220, 255';
      ctx.strokeStyle = `rgba(${col}, ${0.45 + 0.3 * Math.sin(time * 12)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, h + 6, 0, Math.PI * 2); ctx.stroke();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
