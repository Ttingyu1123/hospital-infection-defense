'use strict';
/* 遊戲主邏輯：狀態機、波次管理、砲彈掃掠碰撞、計分、HUD 與各狀態畫面。 */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = new GameMap();
    this.particles = new ParticleSystem();
    this.baseRect = { x: 456, y: 672, w: 48, h: 48 };
    this.reset();
    this.state = STATE.START;
  }

  get baseCenter() {
    return { x: this.baseRect.x + this.baseRect.w / 2, y: this.baseRect.y + this.baseRect.h / 2 };
  }

  /* 完整重置一局：不殘留砲彈、敵人、粒子與計時器 */
  reset() {
    this.map.reset();
    this.particles.reset();
    this.player = new Player();
    this.enemies = [];
    this.bullets = [];
    this.floatTexts = [];
    this.state = STATE.START;
    this.time = 0;
    if (this.timeGlobal === undefined) this.timeGlobal = 0;
    this.score = 0;
    this.baseAlive = true;

    // 波次
    this.waveIndex = 0;
    this.spawnList = [];
    this.spawnWarns = [];   // { x, y, type, timer }
    this.spawnTimer = 0;
    this.spawnPointIdx = 0;

    // 計時器
    this.transitionTimer = 0;
    this.respawnTimer = 0;
    this.endTimer = 0;
    this.endTarget = null;
    this.pausedFrom = null;
  }

  startGame() {
    this.reset();
    this._enterWave(0);
  }

  _enterWave(index) {
    this.waveIndex = index;
    const wave = CONST.WAVES[index];
    this.spawnList = wave.list.slice();
    this.spawnWarns = [];
    this.spawnTimer = 0.5; // 波次開始後稍等再生成
    this.state = STATE.WAVE_TRANSITION;
    this.transitionTimer = CONST.WAVE_TRANSITION_TIME;
    audioSys.waveStart();
  }

  allTanks() {
    const list = [];
    if (this.player && this.player.alive) list.push(this.player);
    for (const e of this.enemies) if (e.alive) list.push(e);
    return list;
  }

  enemiesRemaining() {
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    return alive + this.spawnList.length + this.spawnWarns.length;
  }

  /* ---------- 輸入（邊緣觸發按鍵） ---------- */
  onKeyDown(code) {
    if (code === 'KeyM') {
      audioSys.toggle();
      return;
    }
    if (code === 'KeyB') {
      audioSys.toggleMusic();
      return;
    }
    switch (this.state) {
      case STATE.START:
        if (code === 'Enter' || code === 'Space') this.startGame();
        break;
      case STATE.PLAYING:
      case STATE.WAVE_TRANSITION:
      case STATE.PLAYER_RESPAWNING:
        if (code === 'KeyP') {
          this.pausedFrom = this.state;
          this.state = STATE.PAUSED;
        }
        break;
      case STATE.PAUSED:
        if (code === 'KeyP') {
          this.state = this.pausedFrom || STATE.PLAYING;
          this.pausedFrom = null;
        }
        break;
      case STATE.GAME_OVER:
      case STATE.VICTORY:
        if (code === 'KeyR') this.startGame();
        break;
    }
  }

  /* ---------- 更新 ---------- */
  update(dt, input) {
    this.timeGlobal += dt; // 不受狀態凍結影響（開始畫面閃爍用）
    // BGM 跟隨狀態：遊玩中（含波次提示/重生）播放，其餘停止
    audioSys.setMusic(
      this.state === STATE.PLAYING ||
      this.state === STATE.WAVE_TRANSITION ||
      this.state === STATE.PLAYER_RESPAWNING
    );
    switch (this.state) {
      case STATE.PAUSED:
      case STATE.START:
        return; // 完全凍結
      case STATE.WAVE_TRANSITION:
        this.time += dt;
        this.particles.update(dt);
        this.transitionTimer -= dt;
        if (this.transitionTimer <= 0) this.state = STATE.PLAYING;
        return;
      case STATE.GAME_OVER:
      case STATE.VICTORY:
        this.time += dt;
        this.particles.update(dt); // 殘餘特效播完
        return;
      case STATE.PLAYING:
        this.time += dt;
        this._updateWorld(dt, input, true);
        return;
      case STATE.PLAYER_RESPAWNING:
        this.time += dt;
        this._updateWorld(dt, input, false);
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.player.respawn();
          this.state = STATE.PLAYING;
        }
        return;
    }
  }

  _updateWorld(dt, input, includePlayer) {
    if (includePlayer && this.player.alive) this.player.update(dt, this, input);

    for (const e of this.enemies) if (e.alive) e.update(dt, this);
    // 安全刪除：反向過濾已死亡敵人
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i].alive) this.enemies.splice(i, 1);
    }

    this._updateSpawning(dt);
    this._updateBullets(dt);
    this.particles.update(dt);
    this._updateFloatTexts(dt);
    this._updateEndTimer(dt);
    this._checkWaveComplete();
  }

  /* ---------- 敵人生成 ---------- */
  _updateSpawning(dt) {
    const wave = CONST.WAVES[this.waveIndex];
    // 生成警示 → 實際生成
    for (let i = this.spawnWarns.length - 1; i >= 0; i--) {
      const w = this.spawnWarns[i];
      w.timer -= dt;
      if (w.timer <= 0) {
        if (this._spawnAreaFree(w.x, w.y)) {
          this.enemies.push(new Enemy(w.type, w.x, w.y));
          this.spawnWarns.splice(i, 1);
        } else {
          w.timer = 0.35; // 出生點被擋：延後再試
        }
      }
    }
    // 排程新的警示
    let aliveCount = 0;
    for (const e of this.enemies) if (e.alive) aliveCount++;
    if (this.spawnList.length > 0 && aliveCount + this.spawnWarns.length < wave.maxAlive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = wave.interval;
        const type = this.spawnList.shift();
        const pt = CONST.ENEMY_SPAWNS[this.spawnPointIdx % CONST.ENEMY_SPAWNS.length];
        this.spawnPointIdx++;
        this.spawnWarns.push({ x: pt.x, y: pt.y, type, timer: CONST.SPAWN_WARN_TIME });
      }
    }
  }

  _spawnAreaFree(x, y) {
    const s = 46; // 用最大坦克尺寸檢查
    for (const t of this.allTanks()) {
      const r = t.rect;
      if (aabbOverlap(x - s / 2, y - s / 2, s, s, r.x, r.y, r.w, r.h)) return false;
    }
    return true;
  }

  /* ---------- 砲彈 ---------- */
  _updateBullets(dt) {
    for (const b of this.bullets) {
      if (b.dead) continue;
      const v = DIR_VECS[b.dir];
      let remain = b.speed * dt;
      // 子步掃掠：每步不超過 BULLET_SUBSTEP，防止高速穿薄牆
      while (remain > 0 && !b.dead) {
        const step = Math.min(CONST.BULLET_SUBSTEP, remain);
        b.x += v.x * step;
        b.y += v.y * step;
        remain -= step;
        this._bulletCollide(b);
      }
    }
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (this.bullets[i].dead) this.bullets.splice(i, 1);
    }
  }

  _bulletCollide(b) {
    const r = b.rect;
    // 1. 地圖邊界
    if (r.x < 0 || r.y < 0 || r.x + r.w > CONST.CANVAS_W || r.y + r.h > CONST.CANVAS_H) {
      b.kill();
      return;
    }
    // 2. 地形（磚牆 / 鋼牆）
    const impact = this.map.bulletImpact(r.x, r.y, r.w, r.h, b.dir, this.particles);
    if (impact === 'brick') {
      this.particles.sparks(b.x, b.y);
      audioSys.brickBreak();
      b.kill();
      return;
    }
    if (impact === 'steel') {
      this.particles.sparks(b.x, b.y);
      audioSys.hitWall();
      b.kill();
      return;
    }
    // 3. 基地
    if (this.baseAlive && aabbOverlap(r.x, r.y, r.w, r.h, this.baseRect.x, this.baseRect.y, this.baseRect.w, this.baseRect.h)) {
      b.kill();
      this._destroyBase();
      return;
    }
    // 4. 坦克
    if (b.owner === 'player') {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const er = e.rect;
        if (aabbOverlap(r.x, r.y, r.w, r.h, er.x, er.y, er.w, er.h)) {
          b.kill(); // 先標記死亡：每顆砲彈只造成一次傷害
          if (e.takeHit(this)) this._enemyDestroyed(e);
          else { this.particles.sparks(b.x, b.y); audioSys.hitWall(); }
          return;
        }
      }
    } else {
      const p = this.player;
      if (p && p.alive) {
        const pr = p.rect;
        if (aabbOverlap(r.x, r.y, r.w, r.h, pr.x, pr.y, pr.w, pr.h)) {
          b.kill();
          if (p.invincible > 0) {
            this.particles.sparks(b.x, b.y); // 護盾吸收
          } else {
            this._playerKilled();
          }
          return;
        }
      }
    }
    // 5. 砲彈互相抵消（僅敵我雙方）
    for (const other of this.bullets) {
      if (other === b || other.dead || other.owner === b.owner) continue;
      const or_ = other.rect;
      if (aabbOverlap(r.x, r.y, r.w, r.h, or_.x, or_.y, or_.w, or_.h)) {
        b.kill();
        other.kill();
        this.particles.sparks((b.x + other.x) / 2, (b.y + other.y) / 2);
        audioSys.bulletCancel();
        return;
      }
    }
  }

  _enemyDestroyed(e) {
    this.particles.tankExplosion(e.x, e.y);
    audioSys.tankExplode();
    this.score += e.cfg.score;
    this.floatTexts.push({ x: e.x, y: e.y - 20, text: `+${e.cfg.score}`, t: 0, maxT: 0.9 });
  }

  _playerKilled() {
    const p = this.player;
    this.particles.tankExplosion(p.x, p.y);
    audioSys.tankExplode();
    audioSys.playerHit();
    p.alive = false;
    p.lives--;
    if (p.lives > 0) {
      this.state = STATE.PLAYER_RESPAWNING;
      this.respawnTimer = CONST.PLAYER.respawnDelay;
    } else {
      this._scheduleEnd(STATE.GAME_OVER, 1.6);
    }
  }

  _destroyBase() {
    if (!this.baseAlive) return;
    this.baseAlive = false;
    const c = this.baseCenter;
    this.particles.baseExplosion(c.x, c.y);
    audioSys.baseExplode();
    this._scheduleEnd(STATE.GAME_OVER, 1.8);
  }

  _scheduleEnd(target, delay) {
    if (this.endTarget) return; // 已排定結局，不重複
    this.endTarget = target;
    this.endTimer = delay;
  }

  _updateEndTimer(dt) {
    if (!this.endTarget) return;
    this.endTimer -= dt;
    if (this.endTimer <= 0) {
      this.state = this.endTarget;
      this.endTarget = null;
      if (this.state === STATE.GAME_OVER) audioSys.gameOver();
      else if (this.state === STATE.VICTORY) audioSys.victory();
    }
  }

  _checkWaveComplete() {
    if (this.endTarget || !this.baseAlive) return;
    if (this.state !== STATE.PLAYING && this.state !== STATE.PLAYER_RESPAWNING) return;
    if (this.enemiesRemaining() > 0) return;
    // 波次完成加分
    const bonus = CONST.WAVE_BONUS * (this.waveIndex + 1);
    this.score += bonus;
    const c = this.baseCenter;
    this.floatTexts.push({ x: c.x, y: c.y - 60, text: `WAVE BONUS +${bonus}`, t: 0, maxT: 1.4 });
    if (this.waveIndex >= CONST.WAVES.length - 1) {
      this._scheduleEnd(STATE.VICTORY, 1.2);
      // 立即切換保護：勝利前不再生成/攻擊
      this.spawnList = [];
      this.spawnWarns = [];
    } else {
      this._enterWave(this.waveIndex + 1);
    }
  }

  _updateFloatTexts(dt) {
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const f = this.floatTexts[i];
      f.t += dt;
      f.y -= 24 * dt;
      if (f.t >= f.maxT) this.floatTexts.splice(i, 1);
    }
  }

  /* ---------- 渲染 ---------- */
  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, CONST.CANVAS_W, CONST.CANVAS_H);

    // 震動只影響渲染位移
    const shake = this.particles.getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    this.map.drawGround(ctx, this.time);
    this._drawBase(ctx);
    this._drawSpawnWarns(ctx);
    for (const e of this.enemies) e.draw(ctx);
    if (this.player.alive && this.state !== STATE.START) this.player.draw(ctx, this.time);
    for (const b of this.bullets) if (!b.dead) b.draw(ctx);
    this.map.drawGrass(ctx);
    this.particles.draw(ctx);
    this._drawFloatTexts(ctx);

    ctx.restore();

    this._drawHUD(ctx);
    this._drawOverlay(ctx);
  }

  _drawBase(ctx) {
    const b = this.baseRect;
    if (this.baseAlive) {
      // 基座
      ctx.fillStyle = '#3a4152';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#232837';
      ctx.fillRect(b.x + 4, b.y + 4, b.w - 8, b.h - 8);
      // 金色五角星旗徽
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.fillStyle = '#f0c040';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const aOut = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const aIn = aOut + Math.PI / 5;
        const R = 16, r = 6.5;
        if (i === 0) ctx.moveTo(cx + R * Math.cos(aOut), cy + R * Math.sin(aOut));
        else ctx.lineTo(cx + R * Math.cos(aOut), cy + R * Math.sin(aOut));
        ctx.lineTo(cx + r * Math.cos(aIn), cy + r * Math.sin(aIn));
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8a6a14';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // 廢墟
      ctx.fillStyle = '#2a2d36';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = '#454a58';
      ctx.fillRect(b.x + 6, b.y + 26, 14, 16);
      ctx.fillRect(b.x + 26, b.y + 30, 16, 12);
      ctx.fillRect(b.x + 14, b.y + 10, 10, 8);
    }
  }

  _drawSpawnWarns(ctx) {
    for (const w of this.spawnWarns) {
      // 閃爍菱形警示
      if (Math.floor(this.time * 8) % 2 === 0) continue;
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 2.5;
      const s = 18;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y - s);
      ctx.lineTo(w.x + s, w.y);
      ctx.lineTo(w.x, w.y + s);
      ctx.lineTo(w.x - s, w.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  _drawFloatTexts(ctx) {
    ctx.font = `bold 15px ${CONST.FONTS.MONO}`;
    ctx.textAlign = 'center';
    for (const f of this.floatTexts) {
      ctx.globalAlpha = 1 - f.t / f.maxT;
      ctx.fillStyle = '#ffe08a';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  _drawHUD(ctx) {
    const M = CONST.FONTS.MONO;
    ctx.fillStyle = 'rgba(8, 10, 16, 0.78)';
    ctx.fillRect(0, 0, CONST.CANVAS_W, CONST.HUD_H);
    ctx.fillStyle = 'rgba(159, 176, 198, 0.18)';
    ctx.fillRect(0, CONST.HUD_H - 1, CONST.CANVAS_W, 1);
    ctx.textBaseline = 'middle';
    const y = CONST.HUD_H / 2 + 1;

    // 小標籤 + 大數值的雙層樣式
    const item = (x, label, value, color) => {
      ctx.font = `10px ${M}`;
      ctx.letterSpacing = '1.5px';
      ctx.fillStyle = '#67738a';
      ctx.fillText(label, x, y);
      const lw = ctx.measureText(label).width;
      ctx.font = `bold 17px ${M}`;
      ctx.letterSpacing = '0px';
      ctx.fillStyle = color;
      ctx.fillText(value, x + lw + 9, y);
    };
    item(14, 'SCORE', `${this.score}`, '#ffe08a');
    item(178, 'LIVES', `${Math.max(this.player.lives, 0)}`, '#8ee08a');
    item(288, 'WAVE', `${this.waveIndex + 1}/${CONST.WAVES.length}`, '#8ab8ff');
    item(412, 'ENEMIES', `${this.enemiesRemaining()}`, '#ff9d8a');
    item(556, 'BASE', this.baseAlive ? 'OK' : 'LOST', this.baseAlive ? '#8ee08a' : '#ff5d5d');

    // 右側開關提示（次要資訊，縮小淡化）
    ctx.font = `bold 12px ${M}`;
    ctx.fillStyle = audioSys.enabled ? '#9fb0c6' : '#525b6c';
    ctx.fillText(`[M]SND ${audioSys.enabled ? 'ON' : 'OFF'}`, 772, y);
    ctx.fillStyle = (audioSys.enabled && audioSys.musicEnabled) ? '#9fb0c6' : '#525b6c';
    ctx.fillText(`[B]BGM ${audioSys.musicEnabled ? 'ON' : 'OFF'}`, 872, y);
    ctx.textBaseline = 'alphabetic';
  }

  /* 大標題：像素風雙層陰影 + 寬字距 */
  _title(ctx, text, x, y, size, color, spacing) {
    const M = CONST.FONTS.MONO;
    ctx.font = `bold ${size}px ${M}`;
    ctx.letterSpacing = `${spacing}px`;
    const off = Math.max(3, Math.round(size / 14));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(text, x + off, y + off);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  }

  _drawOverlay(ctx) {
    const W = CONST.CANVAS_W, H = CONST.CANVAS_H;
    const M = CONST.FONTS.MONO, C = CONST.FONTS.CJK;
    const dim = () => { ctx.fillStyle = 'rgba(5, 7, 12, 0.72)'; ctx.fillRect(0, 0, W, H); };
    ctx.textAlign = 'center';

    switch (this.state) {
      case STATE.START: {
        dim();
        this._title(ctx, 'IRON VANGUARD', W / 2, H / 2 - 108, 56, '#f0c040', 8);
        ctx.fillStyle = '#9fb0c6';
        ctx.font = `500 20px ${C}`;
        ctx.fillText('坦克保衛戰 — 守住基地，撐過 5 波進攻', W / 2, H / 2 - 62);
        ctx.font = `15px ${C}`;
        ctx.fillStyle = '#6b7686';
        ctx.fillText('WASD / 方向鍵 移動 ・ Space 射擊 ・ P 暫停 ・ M 音效 ・ B 音樂', W / 2, H / 2 + 6);
        if (Math.floor(this.timeGlobal * 2) % 2 === 0) {
          ctx.fillStyle = '#ffe08a';
          ctx.font = `bold 22px ${M}`;
          ctx.letterSpacing = '3px';
          ctx.fillText('PRESS ENTER TO START', W / 2, H / 2 + 72);
          ctx.letterSpacing = '0px';
        }
        break;
      }
      case STATE.WAVE_TRANSITION: {
        ctx.fillStyle = 'rgba(5, 7, 12, 0.55)';
        ctx.fillRect(0, H / 2 - 72, W, 132);
        this._title(ctx, `WAVE ${this.waveIndex + 1}`, W / 2, H / 2 - 12, 48, '#8ab8ff', 6);
        ctx.fillStyle = '#9fb0c6';
        ctx.font = `bold 15px ${M}`;
        ctx.letterSpacing = '5px';
        ctx.fillText('READY...', W / 2, H / 2 + 32);
        ctx.letterSpacing = '0px';
        break;
      }
      case STATE.PAUSED: {
        dim();
        this._title(ctx, 'PAUSED', W / 2, H / 2 - 12, 46, '#ffe08a', 6);
        ctx.fillStyle = '#9fb0c6';
        ctx.font = `16px ${C}`;
        ctx.fillText('按 P 繼續', W / 2, H / 2 + 32);
        break;
      }
      case STATE.GAME_OVER: {
        dim();
        this._title(ctx, 'GAME OVER', W / 2, H / 2 - 42, 56, '#ff5d5d', 6);
        ctx.fillStyle = '#ffe08a';
        ctx.font = `bold 24px ${M}`;
        ctx.fillText(`SCORE ${this.score}`, W / 2, H / 2 + 10);
        ctx.fillStyle = '#9fb0c6';
        ctx.font = `bold 17px ${M}`;
        ctx.letterSpacing = '2px';
        ctx.fillText('PRESS R TO RESTART', W / 2, H / 2 + 56);
        ctx.letterSpacing = '0px';
        break;
      }
      case STATE.VICTORY: {
        dim();
        this._title(ctx, 'VICTORY!', W / 2, H / 2 - 42, 56, '#8ee08a', 6);
        ctx.fillStyle = '#ffe08a';
        ctx.font = `bold 24px ${M}`;
        ctx.fillText(`SCORE ${this.score}`, W / 2, H / 2 + 10);
        ctx.fillStyle = '#9fb0c6';
        ctx.font = `16px ${C}`;
        ctx.fillText('成功守住基地！按 R 再玩一次', W / 2, H / 2 + 56);
        break;
      }
    }
    ctx.textAlign = 'left';
  }
}
