'use strict';
/* 病原體 AI：有限狀態機式的方向權重決策（偏向病人、偶爾追玩家）、
   卡住偵測、對隔板/隔離門的接觸腐蝕、芽孢留下污染。不逐幀換向。 */

class Pathogen extends Entity {
  constructor(type, x, y) {
    const cfg = CONST.ENEMY_TYPES[type];
    super(x, y, cfg.size, cfg.speed);
    this.type = type;
    this.cfg = cfg;
    this.isBoss = false;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.dir = DIR.DOWN;
    this.speedMul = 1;         // 由難度設定
    this.slow = 0;              // 隔離警示減速剩餘秒數
    this.decisionTimer = 0.3 + Math.random() * 0.5;
    this.wobble = Math.random() * Math.PI * 2;
    this.trailTimer = 0;
    // 卡住偵測
    this.lastX = x; this.lastY = y;
    this.stuckCheckTimer = 0.6;
    this.stuckCount = 0;
    this.blockedTime = 0;
  }

  /* 病原體被關閉的隔離門擋住 */
  extraBlocked(x, y, game) {
    const h = this.half;
    for (const d of game.isolationDoors) {
      if (!d.closed) continue;
      if (aabbOverlap(x - h, y - h, this.size, this.size, d.x, d.y, d.w, d.h)) return true;
    }
    return false;
  }

  get speedNow() { return (this.slow > 0 ? this.cfg.speed * 0.5 : this.cfg.speed) * this.speedMul; }

  update(dt, game) {
    this.updateTimers(dt);
    if (this.slow > 0) this.slow -= dt;
    this.wobble += dt * (this.cfg.erratic ? 9 : 5);
    this.decisionTimer -= dt;

    // 污染區增益：病原體在污染上移動略快、緩慢回血
    const contam = game.map.contamAt(this.x, this.y);
    this.speed = this.speedNow * (contam > 0.3 ? 1.12 : 1);
    if (contam > 0.5 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 0.15 * dt);

    const moved = this.move(dt, game);
    if (moved) this.blockedTime = 0; else this.blockedTime += dt;

    // 接觸腐蝕：前方若是隔板或關閉的門，持續啃蝕
    if (!moved) this._corrodeAhead(dt, game);

    // 芽孢污染尾跡
    if (this.cfg.trail) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) { this.trailTimer = 0.4; game.map.addContam(this.x, this.y, 0.35); }
    }

    // 卡住偵測
    this.stuckCheckTimer -= dt;
    if (this.stuckCheckTimer <= 0) {
      this.stuckCheckTimer = 0.6;
      const d = Math.hypot(this.x - this.lastX, this.y - this.lastY);
      if (d < 5) this.stuckCount++; else this.stuckCount = 0;
      this.lastX = this.x; this.lastY = this.y;
      if (this.stuckCount >= 2) { this.stuckCount = 0; this._chooseDirection(game, true); }
    }

    if (this.decisionTimer <= 0 || this.blockedTime > 0.4) {
      this._chooseDirection(game, false);
      this.blockedTime = 0;
    }
  }

  _corrodeAhead(dt, game) {
    const v = DIR_VECS[this.dir];
    const px = this.x + v.x * (this.half + 4);
    const py = this.y + v.y * (this.half + 4);
    // 隔板
    game.map.damagePartitionAt(px, py, this.cfg.corrode * dt, game.particles);
    // 隔離門
    for (const door of game.isolationDoors) {
      if (!door.closed) continue;
      if (px >= door.x && px <= door.x + door.w && py >= door.y && py <= door.y + door.h) {
        game.damageDoor(door, this.cfg.corrode * dt);
      }
    }
  }

  /* 方向權重：可通行 > 沿 flow-field 朝病人 > 偶爾追玩家 > 避免回頭。
     用地圖距離場（flowDir）取代直線判斷，讓病原體會繞牆、明確撲向 ICU。 */
  _chooseDirection(game, forceChange) {
    const player = game.player;
    const chasePlayer = player && player.alive && !this.cfg.targetsPatient &&
      Math.hypot(player.x - this.x, player.y - this.y) < 150 && Math.random() < 0.4;
    const flowD = chasePlayer ? -1 : game.map.flowDir(this.x, this.y);
    const weights = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      const v = DIR_VECS[d];
      const probe = 26;
      const free = this.positionFree(this.x + v.x * probe, this.y + v.y * probe, game);
      let w = free ? 1.0 : 0.16; // 受阻仍保留低權重：讓牠們願意去啃隔板/門
      if (chasePlayer) {
        if ((v.x !== 0 && Math.sign(player.x - this.x) === v.x) || (v.y !== 0 && Math.sign(player.y - this.y) === v.y)) w *= 2.6;
      } else if (d === flowD) {
        w *= this.cfg.targetsPatient ? 4.4 : 3.4;
      }
      if (d === (this.dir + 2) % 4) w *= 0.28;             // 避免立即回頭
      if (this.cfg.erratic) w *= 0.6 + Math.random() * 0.9; // 病毒不規則
      if (forceChange && d === this.dir) w *= 0.1;
      weights[d] = w;
    }
    const total = weights[0] + weights[1] + weights[2] + weights[3];
    let roll = Math.random() * total;
    for (let d = 0; d < 4; d++) { roll -= weights[d]; if (roll <= 0) { this.setDir(d, game); break; } }
    this.decisionTimer = (this.cfg.erratic ? 0.5 : 1.0) + Math.random() * (this.cfg.erratic ? 0.6 : 1.2);
  }

  takeDamage(dmg, toolId, game) {
    this.hp -= dmg;
    this.hitFlash = 0.1;
    audioSys.pathogenHit();
    if (this.hp <= 0) this.alive = false;
  }

  applySlow(t) { this.slow = Math.max(this.slow, t); }

  draw(ctx) {
    if (!this.alive) return;
    const x = this.x, y = this.y, r = this.half;
    const flash = this.hitFlash > 0;
    ctx.save();
    // 影子
    ctx.fillStyle = 'rgba(30,50,60,0.12)';
    ctx.beginPath(); ctx.ellipse(x, y + r - 1, r * 0.75, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();

    // 被擊中縮放彈跳（打擊感）
    if (this.hitPop > 0) { const s = 1 + this.hitPop * 1.4; ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y); }

    const body = flash ? '#ffffff' : enemyColor(this.type);
    const dark = flash ? '#ffb0b0' : enemyDark(this.type);
    switch (this.type) {
      case 'normal': this._drawBlob(ctx, x, y, r, body, dark, 7); break;
      case 'virus':  this._drawVirus(ctx, x, y, r, body, dark); break;
      case 'spore':  this._drawSpore(ctx, x, y, r, body, dark); break;
      case 'resistant': this._drawResistant(ctx, x, y, r, body, dark); break;
    }
    ctx.restore();

    // 血條（多血量者）
    if (this.maxHp > 1 && this.hp < this.maxHp) {
      const bw = this.size, hpFrac = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x - bw / 2, y - r - 8, bw, 4);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillRect(x - bw / 2, y - r - 8, bw * hpFrac, 4);
    }

    // 剋制提示標記（色盲/教學/簡單）：在頭上畫該用哪種工具的小點
    if (SHOW_WEAKNESS) drawWeaknessMarker(ctx, x, y - r - (this.maxHp > 1 ? 14 : 8), this.type);
  }

  _drawBlob(ctx, x, y, r, body, dark, lobes) {
    ctx.fillStyle = body;
    ctx.beginPath();
    for (let i = 0; i <= lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const rr = r * (0.82 + 0.14 * Math.sin(this.wobble + i * 1.7));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    // 內核 + 眼睛
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fill();
    this._eyes(ctx, x, y, r, false);
  }

  _drawVirus(ctx, x, y, r, body, dark) {
    // 突刺
    ctx.strokeStyle = dark; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this.wobble * 0.2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
      ctx.lineTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4));
      ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4), 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2); ctx.fill();
    this._eyes(ctx, x, y, r, true);
  }

  _drawSpore(ctx, x, y, r, body, dark) {
    // 厚外殼
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.95, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.72, r * 0.58, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.2, y - r * 0.2, r * 0.28, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    this._eyes(ctx, x, y, r, false);
  }

  _drawResistant(ctx, x, y, r, body, dark) {
    this._drawBlob(ctx, x, y, r, body, dark, 8);
    // 盾牌符號
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y - 3); ctx.lineTo(x + 6, y + 2);
    ctx.quadraticCurveTo(x, y + 8, x - 6, y + 2);
    ctx.lineTo(x - 6, y - 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.stroke();
  }

  _eyes(ctx, x, y, r, angry) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.1, r * 0.18, 0, Math.PI * 2);
    ctx.arc(x + r * 0.28, y - r * 0.1, r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.05, r * 0.09, 0, Math.PI * 2);
    ctx.arc(x + r * 0.28, y - r * 0.05, r * 0.09, 0, Math.PI * 2); ctx.fill();
    if (angry) {
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.42, y - r * 0.35); ctx.lineTo(x - r * 0.12, y - r * 0.2);
      ctx.moveTo(x + r * 0.42, y - r * 0.35); ctx.lineTo(x + r * 0.12, y - r * 0.2);
      ctx.stroke();
    }
  }
}
