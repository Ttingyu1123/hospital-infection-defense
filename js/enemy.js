'use strict';
/* 敵方坦克 AI：方向權重決策（偏向基地、偶爾追玩家）、視線射擊、
   射磚開路、卡住偵測。不逐幀換向，決策有計時器。 */

class Enemy extends Tank {
  constructor(type, x, y) {
    const cfg = CONST.ENEMY_TYPES[type];
    super(x, y, cfg.size, cfg.speed);
    this.type = type;
    this.cfg = cfg;
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.maxBullets = 1;
    this.dir = DIR.DOWN;
    this.decisionTimer = 0.4 + Math.random() * 0.6;
    this.shootTimer = 0.6 + Math.random();
    // 卡住偵測
    this.lastX = x;
    this.lastY = y;
    this.stuckCheckTimer = 0.6;
    this.stuckCount = 0;
    this.blockedTime = 0;
  }

  update(dt, game) {
    this.updateTimers(dt);
    this.decisionTimer -= dt;
    this.shootTimer -= dt;

    const moved = this.move(dt, game);
    if (moved) this.blockedTime = 0;
    else this.blockedTime += dt;

    // 卡住偵測：每 0.6 秒檢查一次位移量
    this.stuckCheckTimer -= dt;
    if (this.stuckCheckTimer <= 0) {
      this.stuckCheckTimer = 0.6;
      const d = Math.hypot(this.x - this.lastX, this.y - this.lastY);
      if (d < 5) this.stuckCount++;
      else this.stuckCount = 0;
      this.lastX = this.x;
      this.lastY = this.y;
      if (this.stuckCount >= 2) {
        // 卡太久：強制換方向，若前方是磚牆就射擊開路
        this.stuckCount = 0;
        if (this._brickAhead(game) && this.canShoot()) this._fire(game);
        this._chooseDirection(game, true);
      }
    }

    if (this.decisionTimer <= 0 || this.blockedTime > 0.45) {
      this._chooseDirection(game, false);
      this.blockedTime = 0;
    }

    this._maybeShoot(dt, game);
  }

  /* 方向權重：可通行 > 朝基地 > 朝玩家 > 避免回頭 */
  _chooseDirection(game, forceChange) {
    const base = game.baseCenter;
    const player = game.player;
    const weights = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      const v = DIR_VECS[d];
      // 探測前方 28px 是否可走
      const probe = 28;
      const free = this.positionFree(this.x + v.x * probe, this.y + v.y * probe, game);
      let w = free ? 1.0 : 0.12;
      // 朝基地
      if ((v.x !== 0 && Math.sign(base.x - this.x) === v.x && Math.abs(base.x - this.x) > 12) ||
          (v.y !== 0 && Math.sign(base.y - this.y) === v.y && Math.abs(base.y - this.y) > 12)) {
        w *= 3.0;
      }
      // 偶爾朝玩家
      if (player && player.alive && Math.random() < 0.35) {
        if ((v.x !== 0 && Math.sign(player.x - this.x) === v.x) ||
            (v.y !== 0 && Math.sign(player.y - this.y) === v.y)) {
          w *= 1.8;
        }
      }
      // 避免立即回頭
      if (d === (this.dir + 2) % 4) w *= 0.25;
      if (forceChange && d === this.dir) w *= 0.1;
      weights[d] = w;
    }
    const total = weights[0] + weights[1] + weights[2] + weights[3];
    let roll = Math.random() * total;
    for (let d = 0; d < 4; d++) {
      roll -= weights[d];
      if (roll <= 0) { this.setDir(d, game); break; }
    }
    this.decisionTimer = 1.2 + Math.random() * 1.8;
  }

  _brickAhead(game) {
    const v = DIR_VECS[this.dir];
    const px = this.x + v.x * (this.half + CONST.TILE * 0.6);
    const py = this.y + v.y * (this.half + CONST.TILE * 0.6);
    const cell = game.map.cell(Math.floor(px / CONST.TILE), Math.floor(py / CONST.TILE));
    return !!cell && cell.type === T.BRICK;
  }

  /* 目標與自身在同軸線上且面向該方向 */
  _alignedWith(tx, ty) {
    const dx = tx - this.x, dy = ty - this.y;
    if (Math.abs(dx) < 20 && ((dy < 0 && this.dir === DIR.UP) || (dy > 0 && this.dir === DIR.DOWN))) return true;
    if (Math.abs(dy) < 20 && ((dx < 0 && this.dir === DIR.LEFT) || (dx > 0 && this.dir === DIR.RIGHT))) return true;
    return false;
  }

  /* 目標在同軸線上（不論面向），回傳該方向；否則 -1 */
  _alignDir(tx, ty) {
    const dx = tx - this.x, dy = ty - this.y;
    if (Math.abs(dx) < 20) return dy < 0 ? DIR.UP : DIR.DOWN;
    if (Math.abs(dy) < 20) return dx < 0 ? DIR.LEFT : DIR.RIGHT;
    return -1;
  }

  _maybeShoot(dt, game) {
    if (!this.canShoot() || this.shootTimer > 0) return;
    if (game.state === STATE.WAVE_TRANSITION) return; // 波次提示期間不攻擊

    const player = game.player;
    const base = game.baseCenter;
    let rate = 0.35; // 基礎隨機射擊率（次/秒）

    // 與玩家同線且視線清晰 → 高機率轉向並射擊
    if (player && player.alive) {
      const ad = this._alignDir(player.x, player.y);
      if (ad >= 0 && game.map.lineOfSightClear(this.x, this.y, player.x, player.y)) {
        rate = 2.5;
        if (Math.random() < dt * rate) {
          this.setDir(ad, game);
          this._fire(game);
          return;
        }
        return;
      }
    }
    // 與基地同線且視線清晰
    if (game.baseAlive) {
      const ad = this._alignDir(base.x, base.y);
      if (ad >= 0 && game.map.lineOfSightClear(this.x, this.y, base.x, base.y)) {
        rate = 2.0;
        if (Math.random() < dt * rate) {
          this.setDir(ad, game);
          this._fire(game);
          return;
        }
        return;
      }
    }
    // 前方是磚牆 → 偶爾開路
    if (this._brickAhead(game)) rate = 0.9;
    if (Math.random() < dt * rate) this._fire(game);
  }

  _fire(game) {
    if (!this.canShoot()) return;
    this.shoot(game, 'enemy', this.cfg.bulletSpeed);
    this.cooldown = this.cfg.cooldown;
    this.shootTimer = 0.25;
    audioSys.enemyShoot();
  }

  takeHit(game) {
    this.hp--;
    this.hitFlash = 0.12;
    if (this.hp <= 0) {
      this.alive = false;
      return true; // 已摧毀
    }
    return false;
  }

  draw(ctx) {
    if (!this.alive) return;
    this.drawBody(ctx, this.cfg.color, this.cfg.dark);
    // 重裝型：裝甲鉚釘 + 血量格
    if (this.type === 'heavy') {
      ctx.fillStyle = '#3a2020';
      const h = this.half;
      ctx.fillRect(this.x - h + 4, this.y - h + 4, 4, 4);
      ctx.fillRect(this.x + h - 8, this.y - h + 4, 4, 4);
      ctx.fillRect(this.x - h + 4, this.y + h - 8, 4, 4);
      ctx.fillRect(this.x + h - 8, this.y + h - 8, 4, 4);
      // 血量格
      const bw = this.size;
      for (let i = 0; i < this.maxHp; i++) {
        ctx.fillStyle = i < this.hp ? '#ff6b6b' : 'rgba(255,255,255,0.15)';
        ctx.fillRect(this.x - bw / 2 + i * (bw / this.maxHp) + 1, this.y - this.half - 8, bw / this.maxHp - 2, 3);
      }
    }
  }
}
