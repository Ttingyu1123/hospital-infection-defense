'use strict';
/* 超級抗藥菌王：獨立三階段狀態機。朝 ICU 推進、生成增援、發射污染液滴，
   第三階段週期性護盾（紫外線可快速削弱）。 */

const BOSS_CFG = Object.freeze({
  maxHp: 42, size: 96, speed: 34,
  phase2At: 0.6, phase3At: 0.3,
  shieldHp: 6,               // 第三階段每次護盾量
  corrode: 4.0,              // 對隔板/門的腐蝕
  patientDps: 26, contactDmg: 1,
  score: CONST.BOSS_SCORE,
});

class Boss extends Entity {
  constructor(x, y) {
    super(x, y, BOSS_CFG.size, BOSS_CFG.speed);
    this.isBoss = true;
    this.type = 'boss';
    this.cfg = BOSS_CFG;
    this.hp = BOSS_CFG.maxHp;
    this.maxHp = BOSS_CFG.maxHp;
    this.dir = DIR.DOWN;
    this.phase = 1;
    this.slow = 0;
    this.shieldHp = 0;
    this.shieldTimer = 0;       // 下次上盾倒數（phase3）
    this.decisionTimer = 0.5;
    this.fireTimer = 2.0;
    this.spawnTimer = 5.0;
    this.wobble = 0;
    this.blockedTime = 0;
    this.lastX = x; this.lastY = y;
    this.stuckCheckTimer = 0.7;
    this.stuckCount = 0;
  }

  get speedNow() {
    let s = this.cfg.speed;
    if (this.phase === 2) s *= 1.35;
    if (this.phase === 3) s *= 1.7;
    if (this.slow > 0) s *= 0.55;
    return s;
  }

  update(dt, game) {
    this.updateTimers(dt);
    if (this.slow > 0) this.slow -= dt;
    this.wobble += dt * 3;
    this.speed = this.speedNow;

    this._updatePhase(game);

    // 移動朝病人
    this.decisionTimer -= dt;
    const moved = this.move(dt, game);
    if (moved) this.blockedTime = 0; else { this.blockedTime += dt; this._corrodeAhead(dt, game); }
    if (this.decisionTimer <= 0 || this.blockedTime > 0.35) { this._chooseDirection(game); this.blockedTime = 0; }

    // 卡住偵測
    this.stuckCheckTimer -= dt;
    if (this.stuckCheckTimer <= 0) {
      this.stuckCheckTimer = 0.7;
      const d = Math.hypot(this.x - this.lastX, this.y - this.lastY);
      if (d < 6) this.stuckCount++; else this.stuckCount = 0;
      this.lastX = this.x; this.lastY = this.y;
      if (this.stuckCount >= 2) { this.stuckCount = 0; this._chooseDirection(game, true); }
    }

    // 發射污染液滴
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = this.phase === 3 ? 1.1 : (this.phase === 2 ? 1.7 : 2.4);
      this._fire(game);
    }

    // 生成增援
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.phase === 3 ? 4.5 : (this.phase === 2 ? 6 : 8);
      this._spawnAdds(game);
    }

    // 第三階段污染地面 + 護盾週期
    if (this.phase >= 2) {
      if (Math.random() < dt * (this.phase === 3 ? 3 : 1.4)) game.map.addContam(this.x, this.y, 0.5);
    }
    if (this.phase === 3) {
      this.shieldTimer -= dt;
      if (this.shieldHp <= 0 && this.shieldTimer <= 0) {
        this.shieldHp = this.cfg.shieldHp;
        this.shieldTimer = 9.0;
        game.announce('抗藥性護盾生成！用紫外線破除', 1.6);
        audioSys.bossShield();
      }
    }

    // 病人接觸傷害
    const p = game.patientRect;
    const half = this.half;
    if (aabbOverlap(this.x - half, this.y - half, this.size, this.size, p.x - 6, p.y - 6, p.w + 12, p.h + 12)) {
      game.damagePatient(this.cfg.patientDps * dt, this.x, this.y);
    }
  }

  _updatePhase(game) {
    const frac = this.hp / this.maxHp;
    let np = 1;
    if (frac <= this.cfg.phase3At) np = 3;
    else if (frac <= this.cfg.phase2At) np = 2;
    if (np !== this.phase) {
      this.phase = np;
      if (np === 2) { game.announce('抗藥性升高！', 2.0); game.triggerTip('resistant'); audioSys.bossPhase(); }
      if (np === 3) { game.announce('進入狂暴狀態！', 2.0); this.shieldTimer = 1.0; audioSys.bossPhase(); }
    }
  }

  _chooseDirection(game, forceChange) {
    const goal = game.patientCenter;
    const weights = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      const v = DIR_VECS[d];
      const probe = this.half + 8;
      const free = this.positionFree(this.x + v.x * probe, this.y + v.y * probe, game);
      let w = free ? 1.0 : 0.5; // Boss 撞牆也常保留（會腐蝕破牆）
      if ((v.x !== 0 && Math.sign(goal.x - this.x) === v.x && Math.abs(goal.x - this.x) > 10) ||
          (v.y !== 0 && Math.sign(goal.y - this.y) === v.y && Math.abs(goal.y - this.y) > 10)) w *= 3.4;
      if (d === (this.dir + 2) % 4) w *= 0.3;
      if (forceChange && d === this.dir) w *= 0.1;
      weights[d] = w;
    }
    const total = weights[0] + weights[1] + weights[2] + weights[3];
    let roll = Math.random() * total;
    for (let d = 0; d < 4; d++) { roll -= weights[d]; if (roll <= 0) { this.setDir(d, game); break; } }
    this.decisionTimer = 0.8 + Math.random() * 1.0;
  }

  _corrodeAhead(dt, game) {
    // Boss 體型大：沿前緣多點腐蝕
    const v = DIR_VECS[this.dir];
    const perp = { x: -v.y, y: v.x };
    for (let o = -1; o <= 1; o++) {
      const px = this.x + v.x * (this.half + 4) + perp.x * o * this.half * 0.7;
      const py = this.y + v.y * (this.half + 4) + perp.y * o * this.half * 0.7;
      game.map.damagePartitionAt(px, py, this.cfg.corrode * dt, game.particles);
      for (const door of game.isolationDoors) {
        if (door.closed && px >= door.x && px <= door.x + door.w && py >= door.y && py <= door.y + door.h) {
          game.damageDoor(door, this.cfg.corrode * dt);
        }
      }
    }
  }

  _fire(game) {
    const target = (game.player && game.player.alive && Math.random() < 0.4) ? game.player : game.patientCenter;
    // 選最接近的四方向
    const dx = target.x - this.x, dy = target.y - this.y;
    let dir;
    if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
    else dir = dy > 0 ? DIR.DOWN : DIR.UP;
    game.fireDroplet(this.x, this.y, dir, 240, 12);
    if (this.phase === 3) { // 狂暴：三連發略偏
      const alt = (dir + 1) % 4, alt2 = (dir + 3) % 4;
      game.fireDroplet(this.x, this.y, alt, 220, 12);
      game.fireDroplet(this.x, this.y, alt2, 220, 12);
    }
    audioSys.bossFire();
  }

  _spawnAdds(game) {
    const pool = this.phase === 1 ? ['normal'] : (this.phase === 2 ? ['normal', 'virus'] : ['virus', 'spore']);
    const type = pool[(Math.random() * pool.length) | 0];
    game.spawnPathogenNear(type, this.x, this.y);
  }

  takeDamage(dmg, toolId, game) {
    if (this.shieldHp > 0) {
      if (toolId === 'uv') {
        this.shieldHp -= dmg;
        this.hitFlash = 0.08;
        if (this.shieldHp <= 0) { this.shieldHp = 0; game.announce('護盾破除！', 1.2); audioSys.shieldBreak(); }
      } else {
        game.spawnFloatText(this.x, this.y - this.half - 10, '護盾', '#b98cf0');
      }
      return;
    }
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
    ctx.fillStyle = 'rgba(20,30,20,0.2)';
    ctx.beginPath(); ctx.ellipse(x, y + r - 4, r * 0.85, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    // 多層細胞壁
    const outer = flash ? '#ffffff' : '#5a0f0a';
    const mid = flash ? '#ffd0d0' : '#c0392b';
    const glow = this.phase === 3 ? '#7dff5a' : '#8ab83c';
    // 外圈脈動
    ctx.strokeStyle = glow; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = r * (0.98 + 0.06 * Math.sin(this.wobble * 2 + i));
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = outer;
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mid;
    ctx.beginPath(); ctx.arc(x, y, r * 0.68, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a0f0a';
    ctx.beginPath(); ctx.arc(x, y, r * 0.34, 0, Math.PI * 2); ctx.fill();
    // 抗藥盾符號
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(x, y - 16); ctx.lineTo(x + 14, y - 8); ctx.lineTo(x + 14, y + 6);
    ctx.quadraticCurveTo(x, y + 22, x - 14, y + 6); ctx.lineTo(x - 14, y - 8); ctx.closePath(); ctx.fill();
    // 眼睛
    ctx.fillStyle = '#ffec3d';
    ctx.beginPath(); ctx.arc(x - 14, y - 4, 6, 0, Math.PI * 2); ctx.arc(x + 14, y - 4, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(x - 14, y - 2, 3, 0, Math.PI * 2); ctx.arc(x + 14, y - 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 護盾圈
    if (this.shieldHp > 0) {
      ctx.strokeStyle = `rgba(185, 140, 240, ${0.5 + 0.3 * Math.sin(this.wobble * 6)})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
