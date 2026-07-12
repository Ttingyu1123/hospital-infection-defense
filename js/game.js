'use strict';
/* 遊戲主邏輯：狀態機、波次管理、碰撞掃掠、計分、HUD、教育提示與各狀態畫面。
   保護目標為底部中央的 ICU 重症病人。 */

/* 教育提示文字（每則只顯示一次） */
const TIPS = Object.freeze({
  antibioticVirus: '抗生素無法治療病毒感染',
  contam: '環境污染可能增加院內感染風險',
  wash: '手部衛生是預防院內感染的重要措施',
  sporeAlcohol: '部分芽孢對酒精耐受性較高',
  resistant: '抗藥性會使治療選擇受到限制',
  ppe: '適當使用個人防護裝備可降低暴露風險',
  vaccine: '疫苗接種可降低重症感染風險',
});

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = new GameMap();
    this.particles = new ParticleSystem();
    this.patientRect = { ...CONST.PATIENT_RECT };
    this.showHitboxes = false;
    this.timeGlobal = 0;
    // 開始選單設定（跨重新開始保留）
    this.menuDifficulty = 1;   // 0 簡單 / 1 普通 / 2 困難
    this.menuEndless = false;  // 劇情五波 / 無盡模式
    this.menuColorblind = false; // 色盲友善配色
    this.reset();
    this.state = STATE.START;
  }

  get patientCenter() { return { x: this.patientRect.x + this.patientRect.w / 2, y: this.patientRect.y + this.patientRect.h / 2 }; }

  /* 完整重置一局：不殘留任何實體與計時器 */
  reset() {
    // 套用選單設定
    this.difficultyIndex = this.menuDifficulty;
    this.diff = CONST.DIFFICULTY[this.difficultyIndex];
    this.endless = this.menuEndless;

    this.map.reset();
    this.particles.reset();
    this.player = new Player();
    this.player.invincibleMul = this.diff.invulnMul;
    this.player.invincible = CONST.PLAYER.invincibleTime * this.diff.invulnMul;
    this.enemies = [];
    this.boss = null;
    this.projectiles = [];
    this.effects = [];
    this.items = [];
    this.floatTexts = [];

    // ICU 隔離門、洗手台、疫苗接種站
    const g = this.map.doorGap;
    this.isolationDoors = [{ x: g.x, y: g.y, w: g.w, h: g.h, hp: CONST.DOOR_HP, maxHp: CONST.DOOR_HP, closed: true, recloseCd: 0 }];
    this.washStations = [
      { x: 96 - 22, y: 300 - 22, w: 44, h: 44, cd: 0 },
      { x: 864 - 22, y: 300 - 22, w: 44, h: 44, cd: 0 },
    ];
    this.vaccineStations = [
      { x: 216 - 22, y: 528 - 22, w: 44, h: 44, cd: 0 },
      { x: 744 - 22, y: 528 - 22, w: 44, h: 44, cd: 0 },
    ];

    this.patientHp = CONST.PATIENT_HP;
    this.patientFlash = 0;
    this.patientAlarmCd = 0;
    this.patientShield = 0;   // 疫苗防護剩餘秒數

    this.state = STATE.START;
    this.time = 0;
    this.score = 0;

    // 波次
    this.currentWave = null;
    this.waveIndex = 0;
    this.spawnList = [];
    this.spawnWarns = [];
    this.spawnTimer = 0;
    this.spawnPointIdx = 0;
    this.bossSpawned = false;
    this.noHitThisWave = true;

    // 道具
    this.itemTimer = 10;

    // 教育提示
    this.tipsShown = new Set();
    this.tip = null;         // { text, timer }
    this.announceText = null; // { text, timer, maxTimer }

    // 統計（結算畫面）
    this.correctToolUses = 0;
    this.wrongToolUses = 0;
    this.contamClearedTotal = 0;
    this.newRecord = false;

    // 打擊感
    this.hitStop = 0;

    // 教學
    this.tutorial = null;

    // 計時器
    this.transitionTimer = 0;
    this.respawnTimer = 0;
    this.bossIntroTimer = 0;
    this.endTimer = 0;
    this.endTarget = null;
    this.pausedFrom = null;

    // 色盲配色 / 剋制提示（依選單與難度）
    COLORBLIND = this.menuColorblind;
  }

  /* 是否顯示剋制提示標記：色盲模式 / 教學 / 簡單難度 */
  get showWeakness() {
    return this.menuColorblind || this.state === STATE.TUTORIAL || this.difficultyIndex === 0;
  }

  startGame() {
    this.reset();
    this._enterWave(0);
  }

  /* ---------- 教學關 ---------- */
  startTutorial() {
    this.reset();
    this.state = STATE.TUTORIAL;
    this.player.x = 480; this.player.y = 430; this.player.dir = DIR.UP;
    this.player.invincible = 0; // 教學無威脅，不需無敵閃爍
    this.player.setTool('alcohol');
    this.tutorial = { step: 0, moved: 0, lastX: this.player.x, lastY: this.player.y };
  }

  _tutorialSpawn(type, x, y) { const e = new Pathogen(type, x, y); e.frozen = true; this.enemies.push(e); }

  _tutorialSetup(step) {
    this.enemies = []; // 清掉前一步的靶
    if (step === 1) this._tutorialSpawn('normal', 480, 330);
    else if (step === 2) this._tutorialSpawn('normal', 480, 210);
    else if (step === 3) this._tutorialSpawn('virus', 480, 300);
  }

  get tutorialText() {
    switch (this.tutorial ? this.tutorial.step : 0) {
      case 0: return '① 用 W A S D／方向鍵移動看看';
      case 1: return '② 面向上方病原體（按 W），按住 Space 用「酒精噴霧」消滅它';
      case 2: return '③ 按 2 換「抗生素」，從遠處射掉上方病原體（酒精射程不夠）';
      case 3: return '④ 按 3 換「紫外線」。抗生素對病毒無效——用紫外線消滅紫色病毒';
      default: return '很好！正式遊戲要守住底部 ICU 病人、撐過五波。按 Enter 開始';
    }
  }

  _updateTutorial(dt, input) {
    const t = this.tutorial;
    const p = this.player;
    // 只更新玩家與投射物/特效，靶不移動、不攻擊
    p.update(dt, this, input);
    // 移動距離累計（step 0）
    t.moved += Math.hypot(p.x - t.lastX, p.y - t.lastY);
    t.lastX = p.x; t.lastY = p.y;

    this._updateProjectiles(dt);
    this._updateEffects(dt);
    this.particles.update(dt);
    this._updateFloatTexts(dt);

    // 靶死亡 → 特效 + 進下一步
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i].alive) {
        const e = this.enemies[i];
        this.particles.pathogenBurst(e.x, e.y, enemyColor(e.type));
        audioSys.pathogenDestroy();
        this.enemies.splice(i, 1);
      }
    }

    // 步驟推進
    if (t.step === 0) { if (t.moved > 70) { t.step = 1; this._tutorialSetup(1); } }
    else if (t.step >= 1 && t.step <= 3) { if (this.enemies.length === 0) { t.step++; this._tutorialSetup(t.step); } }
    // step 4：等待 Enter（onKeyDown 處理）
  }

  /* ---------- 高分（無盡模式，localStorage） ---------- */
  _loadBest() {
    try { return parseInt(localStorage.getItem('hid_endless_best') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  _saveBest(v) {
    try { localStorage.setItem('hid_endless_best', String(v)); } catch (e) { /* ignore */ }
  }
  _recordEndlessScore() {
    if (!this.endless) return;
    const best = this._loadBest();
    if (this.score > best) { this._saveBest(this.score); this.newRecord = true; }
  }

  _enterWave(index) {
    this.waveIndex = index;
    const wave = this.endless ? this._makeEndlessWave(index) : CONST.WAVES[index];
    this.currentWave = wave;
    this.spawnList = wave.list.slice();
    this.spawnWarns = [];
    this.spawnTimer = 0.6;
    this.noHitThisWave = true;
    this.bossSpawned = false;
    if (wave.contam) this.map.seedContam(10);
    if (wave.boss) {
      this.state = STATE.BOSS_INTRO;
      this.bossIntroTimer = 2.8;
      audioSys.bossIntro();
    } else {
      this.state = STATE.WAVE_TRANSITION;
      this.transitionTimer = CONST.WAVE_TRANSITION_TIME;
      audioSys.waveStart();
    }
  }

  /* 無盡模式：依波數程序化生成組成，每五波一隻菌王 */
  _makeEndlessWave(n) {
    const boss = n > 0 && n % 5 === 4;
    const pool = ['normal'];
    if (n >= 1) pool.push('virus');
    if (n >= 2) pool.push('spore');
    if (n >= 3) pool.push('resistant');
    const count = Math.min(6 + n * 2, 22);
    const list = [];
    for (let i = 0; i < count; i++) list.push(pool[(Math.random() * pool.length) | 0]);
    return {
      name: `無盡 第 ${n + 1} 波`, list,
      maxAlive: Math.min(4 + (n / 2 | 0), 8),
      interval: Math.max(2.4 - n * 0.08, 0.9),
      contam: n >= 2, boss,
    };
  }

  /* 依難度縮放敵人數值 */
  _applyDiff(e) {
    e.maxHp *= this.diff.enemyHp;
    e.hp = e.maxHp;
    e.speedMul = this.diff.enemySpeed;
    return e;
  }

  allUnits() {
    const list = [];
    if (this.player && this.player.alive) list.push(this.player);
    for (const e of this.enemies) if (e.alive) list.push(e);
    if (this.boss && this.boss.alive) list.push(this.boss);
    return list;
  }

  livingEnemies() {
    const list = [];
    for (const e of this.enemies) if (e.alive) list.push(e);
    if (this.boss && this.boss.alive) list.push(this.boss);
    return list;
  }

  enemiesRemaining() {
    let alive = 0;
    for (const e of this.enemies) if (e.alive) alive++;
    return alive + this.spawnList.length + this.spawnWarns.length + (this.boss && this.boss.alive ? 1 : 0);
  }

  /* ---------- 輸入 ---------- */
  onKeyDown(code) {
    if (code === 'KeyM') { audioSys.toggle(); return; }
    if (code === 'KeyB') { audioSys.toggleMusic(); return; }
    if (code === 'Backquote') { window.__DEBUG = !window.__DEBUG; return; }
    if (window.__DEBUG) this._debugKey(code);

    switch (this.state) {
      case STATE.START:
        if (code === 'ArrowLeft' || code === 'KeyA') { this.menuDifficulty = (this.menuDifficulty + 2) % 3; audioSys.toolSwitch(); }
        else if (code === 'ArrowRight' || code === 'KeyD') { this.menuDifficulty = (this.menuDifficulty + 1) % 3; audioSys.toolSwitch(); }
        else if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyW' || code === 'KeyS') { this.menuEndless = !this.menuEndless; audioSys.toolSwitch(); }
        else if (code === 'KeyV') { this.menuColorblind = !this.menuColorblind; COLORBLIND = this.menuColorblind; audioSys.toolSwitch(); }
        else if (code === 'KeyT') this.startTutorial();
        else if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') this.startGame();
        break;
      case STATE.TUTORIAL:
        if (code === 'Escape') this.startGame();                     // 略過教學直接開始
        else if (this.tutorial && this.tutorial.step >= 4 && (code === 'Enter' || code === 'Space' || code === 'NumpadEnter')) this.startGame();
        else if (code === 'Digit1' || code === 'Numpad1') this._switchTool('alcohol');
        else if (code === 'Digit2' || code === 'Numpad2') this._switchTool('antibiotic');
        else if (code === 'Digit3' || code === 'Numpad3') this._switchTool('uv');
        else if (code === 'KeyQ') { this.player.cycleTool(-1); this._toolFeedback(); }
        else if (code === 'KeyE') { this.player.cycleTool(1); this._toolFeedback(); }
        break;
      case STATE.PLAYING:
      case STATE.WAVE_TRANSITION:
      case STATE.PLAYER_RESPAWNING:
      case STATE.BOSS_INTRO:
        if (code === 'KeyP') { this.pausedFrom = this.state; this.state = STATE.PAUSED; break; }
        if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { if (this.tip) this.tip = null; }
        if (code === 'Digit1' || code === 'Numpad1') this._switchTool('alcohol');
        if (code === 'Digit2' || code === 'Numpad2') this._switchTool('antibiotic');
        if (code === 'Digit3' || code === 'Numpad3') this._switchTool('uv');
        if (code === 'KeyQ') { this.player.cycleTool(-1); this._toolFeedback(); }
        if (code === 'KeyE') { this.player.cycleTool(1); this._toolFeedback(); }
        if (code === 'KeyC') this.recloseDoors();
        break;
      case STATE.PAUSED:
        if (code === 'KeyP') { this.state = this.pausedFrom || STATE.PLAYING; this.pausedFrom = null; }
        break;
      case STATE.GAME_OVER:
      case STATE.VICTORY:
        if (code === 'KeyR') this.startGame();
        break;
    }
  }

  _debugKey(code) {
    switch (code) {
      case 'Digit7': this.patientHp = Math.min(CONST.PATIENT_HP, this.patientHp + 30); break;
      case 'Digit8': this._forceWaveComplete(); break;
      case 'Digit9': for (const e of this.enemies) { e.alive = false; } break;
      case 'Digit0': if (!this.boss) this._spawnBoss(); break;
      case 'KeyI': this.player.invincible = this.player.invincible > 100 ? 0 : 9999; break;
      case 'KeyH': this.showHitboxes = !this.showHitboxes; break;
      case 'KeyK': if (this.boss) { this.boss.shieldHp = 0; this.boss.hp -= 10; } break;
    }
  }

  /* ---------- 更新 ---------- */
  update(dt, input) {
    this.timeGlobal += dt;
    audioSys.setMusic(this.state === STATE.PLAYING || this.state === STATE.WAVE_TRANSITION ||
      this.state === STATE.PLAYER_RESPAWNING || this.state === STATE.BOSS_INTRO);

    // 提示卡計時（不凍結，但 PAUSED/START 除外）
    if (this.state !== STATE.PAUSED && this.state !== STATE.START) this._updateTipTimers(dt);

    switch (this.state) {
      case STATE.PAUSED:
      case STATE.START:
        return;
      case STATE.WAVE_TRANSITION:
        this.time += dt;
        this.particles.update(dt);
        this.transitionTimer -= dt;
        if (this.transitionTimer <= 0) this.state = STATE.PLAYING;
        return;
      case STATE.BOSS_INTRO:
        this.time += dt;
        this.particles.update(dt);
        this.bossIntroTimer -= dt;
        if (this.bossIntroTimer <= 0) { this._spawnBoss(); this.state = STATE.PLAYING; }
        return;
      case STATE.GAME_OVER:
      case STATE.VICTORY:
        this.time += dt;
        this.particles.update(dt);
        this._updateEffects(dt);
        return;
      case STATE.TUTORIAL:
        this.time += dt;
        this._updateTutorial(dt, input);
        return;
      case STATE.PLAYING:
        this.time += dt;
        if (this.hitStop > 0) { this.hitStop -= dt; this.particles.update(dt); return; } // 擊殺頓幀
        this._updateWorld(dt, input, true);
        return;
      case STATE.PLAYER_RESPAWNING:
        this.time += dt;
        this._updateWorld(dt, input, false);
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) { this.player.respawnReset(); this.state = STATE.PLAYING; }
        return;
    }
  }

  _updateWorld(dt, input, includePlayer) {
    // 玩家污染減速
    if (includePlayer && this.player.alive) {
      const contam = this.map.contamAt(this.player.x, this.player.y);
      if (contam > 0.2) this.triggerTip('contam');
      this.player.speed = this.player.effectiveSpeed(contam);
      this.player.update(dt, this, input);
    }

    for (const e of this.enemies) if (e.alive) e.update(dt, this);
    if (this.boss && this.boss.alive) this.boss.update(dt, this);

    // 安全刪除死亡敵人（並計分）
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i].alive) { this._enemyDestroyed(this.enemies[i]); this.enemies.splice(i, 1); }
    }
    if (this.boss && !this.boss.alive) { this._bossDefeated(); }

    this._updateSpawning(dt);
    this._updateProjectiles(dt);
    this._updateContactDamage(dt, includePlayer);
    this._updateWashStations(dt);
    this._updateVaccineStations(dt);
    this._updateDoors(dt);
    this._updateItems(dt);
    this._updateEffects(dt);
    this.map.update(dt);
    if (this.map.flowDirty) this.map.computeFlowField(); // 隔板/門破壞後更新尋路
    this.particles.update(dt);
    this._updateFloatTexts(dt);
    if (this.patientFlash > 0) this.patientFlash -= dt;
    if (this.patientAlarmCd > 0) this.patientAlarmCd -= dt;
    if (this.patientShield > 0) this.patientShield -= dt;
    this._updateEndTimer(dt);
    this._checkWaveComplete();

    // 玩家死亡處置
    if (includePlayer && !this.player.alive && !this.endTarget) this._onPlayerDown();
  }

  /* ---------- 生成 ---------- */
  _updateSpawning(dt) {
    const wave = this.currentWave;
    for (let i = this.spawnWarns.length - 1; i >= 0; i--) {
      const w = this.spawnWarns[i];
      w.timer -= dt;
      if (w.timer <= 0) {
        if (this._spawnAreaFree(w.x, w.y)) {
          this.enemies.push(this._applyDiff(new Pathogen(w.type, w.x, w.y)));
          this.spawnWarns.splice(i, 1);
        } else w.timer = 0.35;
      }
    }
    let aliveCount = 0;
    for (const e of this.enemies) if (e.alive) aliveCount++;
    if (this.spawnList.length > 0 && aliveCount + this.spawnWarns.length < wave.maxAlive) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = wave.interval;
        const type = this.spawnList.shift();
        if (type === 'spore') this.triggerTip('sporeAlcohol');
        if (type === 'resistant') this.triggerTip('resistant');
        const pt = CONST.ENEMY_SPAWNS[this.spawnPointIdx % CONST.ENEMY_SPAWNS.length];
        this.spawnPointIdx++;
        this.spawnWarns.push({ x: pt.x, y: pt.y, type, timer: CONST.SPAWN_WARN_TIME });
      }
    }
  }

  _spawnAreaFree(x, y) {
    const s = 46;
    for (const t of this.allUnits()) {
      const r = t.rect;
      if (aabbOverlap(x - s / 2, y - s / 2, s, s, r.x, r.y, r.w, r.h)) return false;
    }
    return true;
  }

  /* Boss 就近生成增援：在附近找一個可站立點 */
  spawnPathogenNear(type, x, y) {
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const px = clamp(x + Math.cos(ang) * 80, 40, CONST.CANVAS_W - 40);
      const py = clamp(y + Math.sin(ang) * 80, 90, CONST.CANVAS_H - 120);
      const p = new Pathogen(type, px, py);
      if (p.positionFree(px, py, this) && this._spawnAreaFree(px, py)) { this.enemies.push(this._applyDiff(p)); return; }
    }
  }

  _spawnBoss() {
    this.boss = this._applyDiff(new Boss(480, 120));
    this.bossSpawned = true;
    this.announce('超級抗藥菌王 登場！', 2.2);
  }

  /* ---------- 投射物 ---------- */
  fireDroplet(x, y, dir, speed, damage) {
    const v = DIR_VECS[dir];
    const p = new Projectile(x + v.x * 30, y + v.y * 30, dir, speed, 'enemy', 'droplet', damage, null);
    this.projectiles.push(p);
  }

  _updateProjectiles(dt) {
    for (const b of this.projectiles) {
      if (b.dead) continue;
      b.update(dt);
      const v = DIR_VECS[b.dir];
      let remain = b.speed * dt;
      while (remain > 0 && !b.dead) {
        const step = Math.min(CONST.BULLET_SUBSTEP, remain);
        b.x += v.x * step; b.y += v.y * step;
        remain -= step;
        this._projectileCollide(b);
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
  }

  _projectileCollide(b) {
    const r = b.rect;
    if (r.x < 0 || r.y < 0 || r.x + r.w > CONST.CANVAS_W || r.y + r.h > CONST.CANVAS_H) { b.kill(); return; }

    // 地形（玩家抗生素可破壞隔板；病原液滴被牆與隔板擋下）
    if (b.owner === 'player') {
      const impact = this.map.projectileImpact(r.x, r.y, r.w, r.h, b.dir, this.particles);
      if (impact) { this.particles.sparks(b.x, b.y); b.kill(); return; }
    } else {
      const c = this.map.cell(Math.floor(b.x / CONST.TILE), Math.floor(b.y / CONST.TILE));
      if (c && GameMap.projectileSolid(c.type)) { this.particles.sparks(b.x, b.y); b.kill(); return; }
    }

    // 病人
    if (aabbOverlap(r.x, r.y, r.w, r.h, this.patientRect.x, this.patientRect.y, this.patientRect.w, this.patientRect.h)) {
      if (b.owner === 'enemy') this.damagePatient(b.damage, b.x, b.y);
      b.kill(); return;
    }

    if (b.owner === 'player') {
      for (const e of this.livingEnemies()) {
        const er = e.rect;
        if (aabbOverlap(r.x, r.y, r.w, r.h, er.x, er.y, er.w, er.h)) {
          Tools.applyDamage(this, e, 'antibiotic', b.damage);
          b.kill(); return;
        }
      }
    } else {
      const p = this.player;
      if (p && p.alive) {
        const pr = p.rect;
        if (aabbOverlap(r.x, r.y, r.w, r.h, pr.x, pr.y, pr.w, pr.h)) {
          const res = p.takeHit(this);
          if (res === 'hit') this.noHitThisWave = false;
          b.kill(); return;
        }
      }
    }
  }

  /* ---------- 接觸傷害（病原體 vs 玩家 / 病人） ---------- */
  _updateContactDamage(dt, includePlayer) {
    const p = this.player;
    const pr = this.patientRect;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const er = e.rect;
      // 病人
      if (aabbOverlap(er.x, er.y, er.w, er.h, pr.x - 4, pr.y - 4, pr.w + 8, pr.h + 8)) {
        this.damagePatient(e.cfg.patientDps * dt, e.x, e.y);
      }
      // 玩家
      if (includePlayer && p.alive && p.invincible <= 0 && aabbOverlap(er.x, er.y, er.w, er.h, p.rect.x, p.rect.y, p.rect.w, p.rect.h)) {
        const res = p.takeHit(this);
        if (res === 'hit') this.noHitThisWave = false;
      }
    }
    // Boss 對玩家接觸傷害（Boss 對病人在自身 update 處理）
    if (this.boss && this.boss.alive && includePlayer && p.alive && p.invincible <= 0) {
      const br = this.boss.rect;
      if (aabbOverlap(br.x, br.y, br.w, br.h, p.rect.x, p.rect.y, p.rect.w, p.rect.h)) {
        const res = p.takeHit(this);
        if (res === 'hit') this.noHitThisWave = false;
      }
    }
  }

  damagePatient(dmg, x, y) {
    if (this.patientHp <= 0) return;
    dmg *= this.diff.patientDmg;
    if (this.patientShield > 0) dmg *= CONST.PATIENT_SHIELD_MUL; // 疫苗防護減傷
    this.patientHp = Math.max(0, this.patientHp - dmg);
    this.patientFlash = 0.25;
    if (this.patientAlarmCd <= 0) {
      this.patientAlarmCd = 0.9;
      audioSys.patientAlarm();
      this.particles.patientHitFx(x || this.patientCenter.x, y || this.patientCenter.y);
      this.announce('ICU 病人感染風險上升', 1.2, true);
    }
    if (this.patientHp <= 0 && !this.endTarget) {
      this.announce('ICU 病人生命歸零', 1.5);
      this._scheduleEnd(STATE.GAME_OVER, 1.4);
    }
  }

  /* ---------- 洗手台 / 隔離門 ---------- */
  _updateWashStations(dt) {
    const p = this.player;
    for (const w of this.washStations) {
      if (w.cd > 0) w.cd -= dt;
      if (!p.alive || w.cd > 0) continue;
      const near = aabbOverlap(p.rect.x - 8, p.rect.y - 8, p.rect.w + 16, p.rect.h + 16, w.x, w.y, w.w, w.h);
      if (near) {
        w.cd = CONST.WASH_CD;
        p.handHygiene = CONST.HAND_HYGIENE_TIME;
        this.score += CONST.SCORE.handHygiene;
        this.particles.washDrops(p.x, p.y);
        audioSys.handWash();
        this.spawnFloatText(p.x, p.y - 26, '完成手部衛生', '#9bd8ff');
        this.triggerTip('wash');
      }
    }
  }

  _updateVaccineStations(dt) {
    const p = this.player;
    for (const v of this.vaccineStations) {
      if (v.cd > 0) v.cd -= dt;
      if (!p.alive || v.cd > 0) continue;
      const near = aabbOverlap(p.rect.x - 8, p.rect.y - 8, p.rect.w + 16, p.rect.h + 16, v.x, v.y, v.w, v.h);
      if (near) {
        v.cd = CONST.VACCINE_CD;
        this.patientShield = CONST.PATIENT_SHIELD_TIME;
        this.score += 40;
        this.particles.pickupSparkle(p.x, p.y, '#8ee08a');
        audioSys.handWash();
        this.spawnFloatText(this.patientCenter.x, this.patientRect.y - 28, '疫苗防護啟動', '#8ee08a');
        this.triggerTip('vaccine');
      }
    }
  }

  _updateDoors(dt) {
    for (const d of this.isolationDoors) {
      if (d.recloseCd > 0) d.recloseCd -= dt;
    }
  }

  damageDoor(door, dmg) {
    if (!door.closed) return;
    door.hp -= dmg;
    if (door.hp <= 0) {
      door.hp = 0;
      door.closed = false;
      door.recloseCd = CONST.DOOR_RECLOSE_CD;
      this.particles.partitionDebris(door.x + door.w / 2, door.y + door.h / 2);
      audioSys.doorClose();
    }
  }

  /* 切換工具並在角色上方顯示明確提示（讓玩家知道換了什麼、記得按 Space 使用） */
  _switchTool(id) {
    const changed = this.player.toolId !== id;
    this.player.setTool(id);
    if (changed) this._toolFeedback();
  }

  _toolFeedback() {
    const tool = CONST.TOOLS[this.player.toolId];
    this.spawnFloatText(this.player.x, this.player.y - this.player.half - 12, `▶ ${tool.name}（按 Space 使用）`, tool.color);
  }

  recloseDoors() {
    let closed = 0, cooling = 0, blocked = 0, intact = 0;
    for (const d of this.isolationDoors) {
      if (d.closed) { intact++; continue; }
      if (d.recloseCd > 0) { cooling++; continue; }
      // 門口有病原體時無法關閉
      let hasEnemy = false;
      for (const e of this.livingEnemies()) {
        if (aabbOverlap(e.rect.x, e.rect.y, e.rect.w, e.rect.h, d.x - 4, d.y - 4, d.w + 8, d.h + 8)) { hasEnemy = true; break; }
      }
      if (hasEnemy) { blocked++; continue; }
      d.closed = true; d.hp = d.maxHp; d.recloseCd = CONST.DOOR_RECLOSE_CD;
      closed++;
    }
    // 依結果給明確回饋（讓玩家知道按鍵有作用）
    const fy = this.patientRect.y - 16, fx = this.patientCenter.x;
    if (closed > 0) { audioSys.doorClose(); this.spawnFloatText(fx, fy, '隔離門已重新關閉', '#a7e0d6'); }
    else if (blocked > 0) { this.spawnFloatText(fx, fy, '門口有病原體，無法關閉', '#ff9d8a'); }
    else if (cooling > 0) { this.spawnFloatText(fx, fy, `隔離門整備中（${Math.ceil(this.isolationDoors[0].recloseCd)}s）`, '#f2c14e'); }
    else if (intact > 0) { this.spawnFloatText(fx, fy, '隔離門完好，無需關閉', '#a7e0d6'); }
  }

  /* ---------- 道具 ---------- */
  _updateItems(dt) {
    this.itemTimer -= dt;
    if (this.itemTimer <= 0) { this.itemTimer = 13 + Math.random() * 6; this._maybeSpawnItem(); }
    for (const it of this.items) it.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.dead) { this.items.splice(i, 1); continue; }
      if (this.player.alive && aabbOverlap(it.rect.x, it.rect.y, it.rect.w, it.rect.h, this.player.rect.x, this.player.rect.y, this.player.rect.w, this.player.rect.h)) {
        this.pickupItem(it);
        this.items.splice(i, 1);
      }
    }
  }

  _maybeSpawnItem() {
    // 依需求加權挑選道具類型
    const pool = [];
    if (this.patientHp < 55) pool.push('firstaid', 'firstaid');
    pool.push('ppe', 'supply', 'isolation');
    if (this.waveIndex >= 3) pool.push('ppe');
    const type = pool[(Math.random() * pool.length) | 0];
    const pos = this._randomFloor();
    if (pos) this.items.push(new Item(type, pos.x, pos.y));
  }

  _randomFloor() {
    for (let tries = 0; tries < 30; tries++) {
      const c = 3 + ((Math.random() * (CONST.COLS - 6)) | 0);
      const r = 4 + ((Math.random() * 16) | 0);
      const cell = this.map.cell(c, r);
      if (!cell || GameMap.entitySolid(cell.type)) continue;
      const x = c * CONST.TILE + CONST.TILE / 2, y = r * CONST.TILE + CONST.TILE / 2;
      const rr = { x: x - 16, y: y - 16, w: 32, h: 32 };
      if (aabbOverlap(rr.x, rr.y, rr.w, rr.h, this.patientRect.x, this.patientRect.y, this.patientRect.w, this.patientRect.h)) continue;
      return { x, y };
    }
    return null;
  }

  pickupItem(it) {
    const p = this.player;
    audioSys.itemPickup();
    this.particles.pickupSparkle(it.x, it.y, ITEM_DEFS[it.type].color);
    switch (it.type) {
      case 'ppe':
        p.ppe = Math.min(2, p.ppe + CONST.PPE_ABSORB);
        this.score += CONST.SCORE.ppe;
        this.spawnFloatText(it.x, it.y - 18, 'PPE 護盾', '#5ac6e0');
        this.triggerTip('ppe');
        break;
      case 'supply':
        for (const id of CONST.TOOL_ORDER) p.energy[id] = CONST.TOOLS[id].energyMax;
        p.supplyBoost = 5;
        this.spawnFloatText(it.x, it.y - 18, '補給完成', '#7ed957');
        break;
      case 'firstaid':
        this.patientHp = Math.min(CONST.PATIENT_HP, this.patientHp + 22);
        this.spawnFloatText(it.x, it.y - 18, '病人 +22', '#ff8a8a');
        break;
      case 'isolation':
        for (const e of this.livingEnemies()) e.applySlow(CONST.ISOLATION_SLOW_TIME);
        this.spawnFloatText(it.x, it.y - 18, '隔離措施：病原體減速', '#f2c14e');
        break;
    }
  }

  /* ---------- 特效 / 浮字 ---------- */
  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life += dt;
      if (fx.life >= fx.maxLife) this.effects.splice(i, 1);
    }
  }

  spawnFloatText(x, y, text, color) {
    this.floatTexts.push({ x, y, text, color: color || '#ffe08a', t: 0, maxT: 1.0 });
  }

  _updateFloatTexts(dt) {
    for (let i = this.floatTexts.length - 1; i >= 0; i--) {
      const f = this.floatTexts[i];
      f.t += dt; f.y -= 22 * dt;
      if (f.t >= f.maxT) this.floatTexts.splice(i, 1);
    }
  }

  onContamCleared(count, x, y) {
    if (count <= 0) return;
    this.contamClearedTotal += count;
    this.score += Math.min(count, 6) * 8;
    this.particles.contamPuff(x, y);
    audioSys.contamClear();
  }

  triggerTip(id) {
    if (this.tipsShown.has(id)) return;
    this.tipsShown.add(id);
    this.tip = { text: TIPS[id], timer: 3.8 };
  }

  announce(text, time, minor) {
    // minor 提示不覆蓋重要公告
    if (this.announceText && minor) return;
    this.announceText = { text, timer: time, maxTimer: time };
  }

  _updateTipTimers(dt) {
    if (this.tip) { this.tip.timer -= dt; if (this.tip.timer <= 0) this.tip = null; }
    if (this.announceText) { this.announceText.timer -= dt; if (this.announceText.timer <= 0) this.announceText = null; }
  }

  /* ---------- 結局 / 波次 ---------- */
  _onPlayerDown() {
    this.particles.pathogenBurst(this.player.x, this.player.y, '#ffffff');
    if (this.player.lives > 0) { this.state = STATE.PLAYER_RESPAWNING; this.respawnTimer = CONST.PLAYER.respawnDelay; }
    else { this.announce('感染管制醫師倒下', 1.5); this._scheduleEnd(STATE.GAME_OVER, 1.5); }
  }

  _enemyDestroyed(e) {
    this.particles.pathogenBurst(e.x, e.y, enemyColor(e.type));
    audioSys.pathogenDestroy();
    this.score += e.cfg.score;
    this.spawnFloatText(e.x, e.y - e.half - 6, `+${e.cfg.score}`, '#ffe08a');
    this.hitStop = Math.max(this.hitStop, HIT_STOP); // 擊殺頓幀
  }

  /* 工具命中回饋（打擊感 + 正確用工具的計數） */
  onToolHit(enemy, toolId, mult) {
    const col = CONST.TOOLS[toolId].color;
    this.particles.sparks(enemy.x, enemy.y);
    if (mult >= 1.0) { this.particles.critSpark(enemy.x, enemy.y, col); enemy.hitPop = 0.12; } // 正確工具：亮火花 + 縮放彈跳
    else enemy.hitPop = 0.06;
  }

  _bossDefeated() {
    this.boss = null;
    this.score += CONST.BOSS_SCORE;
    const c = this.patientCenter;
    this.particles.bossExplosion(480, 300);
    this.particles.disinfectFlash(c.x, c.y);
    audioSys.bossExplode();
    // 清除所有污染與剩餘敵人
    this.map.clearContamCircle(480, 360, 1200);
    for (const e of this.enemies) e.alive = false;
    this.spawnList = []; this.spawnWarns = [];
    if (this.endless) {
      this.patientHp = Math.min(CONST.PATIENT_HP, this.patientHp + CONST.PATIENT_WAVE_HEAL);
      this.announce('菌王已清除，防疫任務繼續', 2.2);
      this._enterWave(this.waveIndex + 1);
    } else {
      this.announce('院內感染控制成功', 2.5);
      this._scheduleEnd(STATE.VICTORY, 1.6);
    }
  }

  _scheduleEnd(target, delay) {
    if (this.endTarget) return;
    this.endTarget = target;
    this.endTimer = delay;
  }

  _updateEndTimer(dt) {
    if (!this.endTarget) return;
    this.endTimer -= dt;
    if (this.endTimer <= 0) {
      this.state = this.endTarget;
      this.endTarget = null;
      this._recordEndlessScore();
      if (this.state === STATE.GAME_OVER) audioSys.gameOver();
      else if (this.state === STATE.VICTORY) audioSys.victory();
    }
  }

  _forceWaveComplete() {
    for (const e of this.enemies) e.alive = false;
    this.spawnList = []; this.spawnWarns = [];
    if (this.boss) this.boss.alive = false;
  }

  _checkWaveComplete() {
    if (this.endTarget || this.patientHp <= 0) return;
    if (this.state !== STATE.PLAYING && this.state !== STATE.PLAYER_RESPAWNING) return;
    if (this.enemiesRemaining() > 0) return;
    const wave = this.currentWave;
    if (wave.boss) return; // Boss 波由 _bossDefeated 處理

    // 完成波次獎勵
    this.score += CONST.WAVE_BONUS;
    let bonusMsg = `波次完成 +${CONST.WAVE_BONUS}`;
    if (this.noHitThisWave) { this.score += 200; bonusMsg += ' ・無暴露+200'; }
    if (this.patientHp > CONST.PATIENT_HP * 0.75) { this.score += 150; bonusMsg += ' ・防疫優良+150'; }
    this.patientHp = Math.min(CONST.PATIENT_HP, this.patientHp + CONST.PATIENT_WAVE_HEAL);
    this.spawnFloatText(this.patientCenter.x, this.patientRect.y - 40, bonusMsg, '#8ee0c0');

    if (!this.endless && this.waveIndex >= CONST.WAVES.length - 1) this._scheduleEnd(STATE.VICTORY, 1.2);
    else this._enterWave(this.waveIndex + 1);
  }

  /* ---------- 渲染 ---------- */
  render() {
    SHOW_WEAKNESS = this.showWeakness; // 剋制提示標記顯示與否
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1420';
    ctx.fillRect(0, 0, CONST.CANVAS_W, CONST.CANVAS_H);

    const shake = this.particles.getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    this.map.drawGround(ctx, this.time);
    this._drawWashStations(ctx);
    this._drawVaccineStations(ctx);
    this._drawPatient(ctx);
    this._drawDoors(ctx);
    for (const it of this.items) it.draw(ctx, this.time);
    this._drawSpawnWarns(ctx);
    for (const e of this.enemies) e.draw(ctx);
    if (this.boss) this.boss.draw(ctx);
    if (this.player.alive && this.state !== STATE.START) this.player.draw(ctx, this.time);
    for (const fx of this.effects) Tools.drawEffect(ctx, fx);
    for (const b of this.projectiles) if (!b.dead) b.draw(ctx);
    this.particles.draw(ctx);
    this._drawFloatTexts(ctx);
    if (this.showHitboxes) this._drawHitboxes(ctx);

    ctx.restore();

    this._drawHUD(ctx);
    this._drawAnnounce(ctx);
    this._drawTip(ctx);
    this._drawOverlay(ctx);
  }

  _drawPatient(ctx) {
    const b = this.patientRect;
    const flash = this.patientFlash > 0 && Math.floor(this.time * 12) % 2 === 0;
    // 疫苗防護光罩
    if (this.patientShield > 0) {
      ctx.strokeStyle = `rgba(120, 224, 160, ${0.4 + 0.25 * Math.sin(this.time * 6)})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x - 10, b.y - 10, b.w + 20, b.h + 20);
      ctx.fillStyle = 'rgba(120, 224, 160, 0.08)';
      ctx.fillRect(b.x - 10, b.y - 10, b.w + 20, b.h + 20);
    }
    // 病床框
    ctx.fillStyle = '#f2f7fa';
    ctx.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.strokeStyle = flash ? '#ff5d5d' : '#8fb8c4';
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    // 床墊
    ctx.fillStyle = '#cfe6f0';
    ctx.fillRect(b.x + 4, b.y + 6, b.w - 8, b.h - 10);
    // 病人（被單 + 頭）
    ctx.fillStyle = flash ? '#ffd0d0' : '#eaf3f7';
    ctx.fillRect(b.x + 10, b.y + 10, b.w - 20, b.h - 16);
    ctx.fillStyle = '#f4c9a0';
    ctx.beginPath(); ctx.arc(b.x + 22, b.y + b.h / 2, 9, 0, Math.PI * 2); ctx.fill();
    // 心電監視器
    ctx.fillStyle = '#12303c';
    ctx.fillRect(b.x + b.w - 42, b.y + 8, 34, 22);
    ctx.strokeStyle = this.patientHp > 0 ? '#57e08a' : '#ff5d5d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const my = b.y + 19;
    const beat = this.patientHp > 0 ? Math.sin(this.time * 6) : 0;
    ctx.moveTo(b.x + b.w - 40, my);
    ctx.lineTo(b.x + b.w - 32, my);
    ctx.lineTo(b.x + b.w - 28, my - 7 * (beat > 0.9 ? 1 : 0.2));
    ctx.lineTo(b.x + b.w - 24, my + 5);
    ctx.lineTo(b.x + b.w - 20, my);
    ctx.lineTo(b.x + b.w - 10, my);
    ctx.stroke();
    // ICU 標示
    ctx.fillStyle = '#2b7fb8';
    ctx.font = `bold 11px ${CONST.FONTS.MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('ICU', b.x + b.w / 2, b.y - 10);
    // 病人生命條
    const bw = b.w, frac = clamp(this.patientHp / CONST.PATIENT_HP, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(b.x, b.y + b.h + 6, bw, 6);
    ctx.fillStyle = frac > 0.5 ? '#57e08a' : (frac > 0.25 ? '#f2c14e' : '#ff5d5d');
    ctx.fillRect(b.x, b.y + b.h + 6, bw * frac, 6);
    ctx.textAlign = 'left';
  }

  _drawWashStations(ctx) {
    for (const w of this.washStations) {
      const ready = w.cd <= 0;
      ctx.fillStyle = '#cdd6de';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = ready ? '#9bd8ff' : '#7d94a6';
      ctx.fillRect(w.x + 6, w.y + 6, w.w - 12, w.h - 20); // 水槽
      ctx.fillStyle = '#5a6b7a';
      ctx.fillRect(w.x + w.w / 2 - 2, w.y + 4, 4, 12);     // 水龍頭
      // 水滴圖示
      ctx.fillStyle = ready ? '#3aa6e0' : '#889';
      ctx.beginPath();
      ctx.arc(w.x + w.w / 2, w.y + w.h - 8, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8aa6b8'; ctx.lineWidth = 1;
      ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
  }

  _drawVaccineStations(ctx) {
    for (const v of this.vaccineStations) {
      const ready = v.cd <= 0;
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      ctx.fillStyle = '#eef4f0';
      ctx.fillRect(v.x, v.y, v.w, v.h);
      ctx.strokeStyle = ready ? '#57e08a' : '#7d94a6'; ctx.lineWidth = 2;
      ctx.strokeRect(v.x + 0.5, v.y + 0.5, v.w - 1, v.h - 1);
      // 針筒圖示（斜放）
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = ready ? '#57e08a' : '#93a6b2';
      ctx.fillRect(-11, -4, 16, 8);       // 筒身
      ctx.fillStyle = '#cfe6d8'; ctx.fillRect(-9, -3, 8, 6); // 藥液
      ctx.fillStyle = ready ? '#3a8a5a' : '#6a7d88';
      ctx.fillRect(5, -2.5, 4, 5);        // 推桿頭
      ctx.fillRect(-15, -1.5, 4, 3);      // 針頭
      ctx.restore();
      // 十字標記
      ctx.fillStyle = ready ? '#57e08a' : '#93a6b2';
      ctx.fillRect(cx - 1, v.y + 3, 2, 6); ctx.fillRect(cx - 3, v.y + 5, 6, 2);
    }
  }

  _drawDoors(ctx) {
    for (const d of this.isolationDoors) {
      if (d.closed) {
        const frac = clamp(d.hp / d.maxHp, 0, 1);
        ctx.fillStyle = '#f2c14e';
        ctx.fillRect(d.x, d.y, d.w, d.h);
        // 黃黑警示斜紋
        ctx.fillStyle = '#1a1a1a';
        for (let i = -1; i < d.w / 8 + 1; i++) {
          ctx.beginPath();
          ctx.moveTo(d.x + i * 8, d.y);
          ctx.lineTo(d.x + i * 8 + 4, d.y);
          ctx.lineTo(d.x + i * 8 - 4 + d.h, d.y + d.h);
          ctx.lineTo(d.x + i * 8 - 8 + d.h, d.y + d.h);
          ctx.closePath(); ctx.fill();
        }
        // 耐久條
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(d.x, d.y - 4, d.w, 3);
        ctx.fillStyle = frac > 0.4 ? '#57e08a' : '#ff5d5d';
        ctx.fillRect(d.x, d.y - 4, d.w * frac, 3);
      } else {
        // 開啟：地面軌道殘影
        ctx.fillStyle = 'rgba(242,193,78,0.25)';
        ctx.fillRect(d.x, d.y, d.w, d.h);
      }
    }
  }

  _drawSpawnWarns(ctx) {
    for (const w of this.spawnWarns) {
      if (Math.floor(this.time * 8) % 2 === 0) continue;
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 2.5;
      const s = 16;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y - s); ctx.lineTo(w.x + s, w.y);
      ctx.lineTo(w.x, w.y + s); ctx.lineTo(w.x - s, w.y);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,93,93,0.15)';
      ctx.fill();
    }
  }

  _drawFloatTexts(ctx) {
    ctx.font = `bold 14px ${CONST.FONTS.CJK}`;
    ctx.textAlign = 'center';
    for (const f of this.floatTexts) {
      ctx.globalAlpha = 1 - f.t / f.maxT;
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  _drawHitboxes(ctx) {
    ctx.strokeStyle = '#00ffcc'; ctx.lineWidth = 1;
    const boxes = [this.player, ...this.enemies];
    if (this.boss) boxes.push(this.boss);
    for (const u of boxes) { if (!u || !u.alive) continue; const r = u.rect; ctx.strokeRect(r.x, r.y, r.w, r.h); }
    ctx.strokeStyle = '#ff00ff';
    ctx.strokeRect(this.patientRect.x, this.patientRect.y, this.patientRect.w, this.patientRect.h);
  }

  /* ---------- HUD ---------- */
  _drawHUD(ctx) {
    const M = CONST.FONTS.MONO, C = CONST.FONTS.CJK;
    ctx.fillStyle = 'rgba(16, 28, 46, 0.9)';
    ctx.fillRect(0, 0, CONST.CANVAS_W, CONST.HUD_H);
    ctx.fillStyle = 'rgba(120, 200, 220, 0.3)';
    ctx.fillRect(0, CONST.HUD_H - 1, CONST.CANVAS_W, 1);
    ctx.textBaseline = 'middle';

    // 第一排
    const y1 = 18;
    ctx.font = `bold 17px ${C}`;
    ctx.fillStyle = '#7fe0d0';
    ctx.fillText('醫院防疫大作戰', 12, y1);

    const item = (x, y, label, value, color) => {
      ctx.font = `11px ${M}`; ctx.fillStyle = '#7c93aa';
      ctx.fillText(label, x, y);
      const lw = ctx.measureText(label).width;
      ctx.font = `bold 17px ${M}`; ctx.fillStyle = color;
      ctx.fillText(value, x + lw + 7, y);
      return x + lw + 7 + ctx.measureText(value).width;
    };
    item(156, y1, 'SCORE', `${this.score}`, '#ffe08a');
    item(302, y1, 'LIVES', '♥'.repeat(Math.max(this.player.lives, 0)) || '—', '#ff8a8a');
    item(424, y1, 'WAVE', this.endless ? `${this.waveIndex + 1}` : `${this.waveIndex + 1}/${CONST.WAVES.length}`, '#8ab8ff');
    item(524, y1, 'PATHOGENS', `${this.enemiesRemaining()}`, '#a4d67a');

    // PATIENT 生命條
    ctx.font = `11px ${M}`; ctx.fillStyle = '#7c93aa';
    ctx.fillText('PATIENT', 700, y1);
    const pbx = 756, pbw = 146;
    const pf = clamp(this.patientHp / CONST.PATIENT_HP, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(pbx, y1 - 6, pbw, 12);
    ctx.fillStyle = pf > 0.5 ? '#57e08a' : (pf > 0.25 ? '#f2c14e' : '#ff5d5d');
    ctx.fillRect(pbx, y1 - 6, pbw * pf, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(pbx, y1 - 6, pbw, 12);
    ctx.fillStyle = '#fff'; ctx.font = `bold 10px ${M}`; ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(this.patientHp)}%`, pbx + pbw / 2, y1);
    ctx.textAlign = 'left';

    // 第二排：工具 + 能量 + 增益 + 開關
    const y2 = 45;
    const tool = CONST.TOOLS[this.player.toolId];
    ctx.font = `11px ${M}`; ctx.fillStyle = '#7c93aa'; ctx.fillText('TOOL', 12, y2);
    ctx.font = `bold 15px ${C}`; ctx.fillStyle = tool.color; ctx.fillText(tool.name, 48, y2);
    // 能量條
    const ebx = 158, ebw = 120, e = this.player.energy[this.player.toolId], ef = e / tool.energyMax;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(ebx, y2 - 7, ebw, 13);
    ctx.fillStyle = this.player.canUseTool(this.player.toolId) ? tool.color : '#66788c';
    ctx.fillRect(ebx, y2 - 7, ebw * ef, 13);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(ebx, y2 - 7, ebw, 13);
    ctx.fillStyle = '#cfe0ee'; ctx.font = `10px ${M}`; ctx.fillText('ENERGY', ebx, y2 - 13);
    // 工具快捷
    ctx.font = `12px ${M}`; ctx.fillStyle = '#7c93aa';
    ctx.fillText('[1]酒精 [2]抗生素 [3]紫外線 [Q/E]切換', 300, y2);

    // 增益指示
    let gx = 618;
    if (this.player.ppe > 0) { ctx.fillStyle = '#5ac6e0'; ctx.font = `bold 13px ${C}`; ctx.fillText(`PPE×${this.player.ppe}`, gx, y2); gx += 64; }
    if (this.player.handHygiene > 0) { ctx.fillStyle = '#9bd8ff'; ctx.font = `bold 13px ${C}`; ctx.fillText(`洗手 ${this.player.handHygiene.toFixed(0)}s`, gx, y2); gx += 78; }
    if (this.patientShield > 0) { ctx.fillStyle = '#8ee08a'; ctx.font = `bold 13px ${C}`; ctx.fillText(`疫苗 ${this.patientShield.toFixed(0)}s`, gx, y2); gx += 78; }

    // 音效開關
    ctx.font = `bold 12px ${M}`;
    ctx.fillStyle = audioSys.enabled ? '#9fb0c6' : '#525b6c';
    ctx.fillText(`[M]音效 ${audioSys.enabled ? 'ON' : 'OFF'}`, 800, y2);
    ctx.fillStyle = (audioSys.musicEnabled) ? '#9fb0c6' : '#525b6c';
    ctx.fillText(`[B]音樂 ${audioSys.musicEnabled ? 'ON' : 'OFF'}`, 800, y1 + 0);
    ctx.textBaseline = 'alphabetic';

    // Boss 血條
    if (this.boss && this.boss.alive) this._drawBossBar(ctx);
  }

  _drawBossBar(ctx) {
    const C = CONST.FONTS.CJK;
    const x = 180, w = 600, y = CONST.HUD_H + 8, h = 14;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const f = clamp(this.boss.hp / this.boss.maxHp, 0, 1);
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(x, y, w * f, h);
    // 護盾疊加
    if (this.boss.shieldHp > 0) {
      ctx.fillStyle = 'rgba(185,140,240,0.7)';
      ctx.fillRect(x, y, w * f * clamp(this.boss.shieldHp / this.boss.cfg.shieldHp, 0, 1), h);
    }
    ctx.strokeStyle = '#ffec3d'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#fff'; ctx.font = `bold 12px ${C}`; ctx.textAlign = 'center';
    ctx.fillText(`超級抗藥菌王　第 ${this.boss.phase} 階段`, x + w / 2, y + h - 2);
    ctx.textAlign = 'left';
  }

  _drawAnnounce(ctx) {
    if (!this.announceText) return;
    const a = clamp(this.announceText.timer / Math.min(0.5, this.announceText.maxTimer), 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = `bold 26px ${CONST.FONTS.CJK}`;
    const y = 150;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(this.announceText.text, CONST.CANVAS_W / 2 + 2, y + 2);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(this.announceText.text, CONST.CANVAS_W / 2, y);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  _drawTip(ctx) {
    if (!this.tip) return;
    const C = CONST.FONTS.CJK;
    const W = CONST.CANVAS_W;
    ctx.font = `bold 19px ${C}`;
    const tw = ctx.measureText(this.tip.text).width;
    const boxW = tw + 96, boxH = 62, x = (W - boxW) / 2, y = CONST.CANVAS_H - 132;
    ctx.fillStyle = 'rgba(16, 40, 56, 0.95)';
    this._roundRect(ctx, x, y, boxW, boxH, 12); ctx.fill();
    ctx.strokeStyle = '#7fe0d0'; ctx.lineWidth = 2.5;
    this._roundRect(ctx, x, y, boxW, boxH, 12); ctx.stroke();
    // 圖示
    ctx.fillStyle = '#7fe0d0';
    ctx.beginPath(); ctx.arc(x + 30, y + boxH / 2, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0e2430'; ctx.font = `bold 19px ${CONST.FONTS.MONO}`; ctx.textAlign = 'center';
    ctx.fillText('i', x + 30, y + boxH / 2 + 7);
    ctx.fillStyle = '#eaf7f4'; ctx.font = `bold 19px ${C}`; ctx.textAlign = 'left';
    ctx.fillText(this.tip.text, x + 54, y + 28);
    ctx.fillStyle = '#7c93aa'; ctx.font = `13px ${C}`;
    ctx.fillText('衛教提示 ・ 按 Enter 關閉', x + 54, y + 48);
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

  _title(ctx, text, x, y, size, color) {
    ctx.font = `bold ${size}px ${CONST.FONTS.CJK}`;
    const off = Math.max(2, Math.round(size / 16));
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(text, x + off, y + off);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  /* 結算：波次/存活率/工具正確率/清污染，以及無盡最高分 */
  _drawScoreSummary(ctx, y) {
    const W = CONST.CANVAS_W, C = CONST.FONTS.CJK;
    const total = this.correctToolUses + this.wrongToolUses;
    const acc = total > 0 ? Math.round((this.correctToolUses / total) * 100) : 0;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8d6e2'; ctx.font = `17px ${C}`;
    const waveLabel = this.endless ? `無盡到達 第 ${this.waveIndex + 1} 波` : `到達 第 ${this.waveIndex + 1} 波`;
    ctx.fillText(`${waveLabel} ・ 病人存活率 ${Math.max(0, Math.ceil(this.patientHp))}%`, W / 2, y);
    ctx.fillText(`工具選擇正確率 ${acc}%（正確 ${this.correctToolUses}／用錯 ${this.wrongToolUses}）・ 清除污染 ${this.contamClearedTotal} 格`, W / 2, y + 26);
    if (this.endless) {
      ctx.fillStyle = this.newRecord ? '#ffd166' : '#8ee0c0';
      ctx.font = `bold 16px ${C}`;
      ctx.fillText(this.newRecord ? `★ 新紀錄！最高分 ${this.score}` : `目前最高分 ${this._loadBest()}`, W / 2, y + 52);
    }
  }

  /* 衛教重點 recap（結算畫面強化學習） */
  _drawRecap(ctx, y) {
    const W = CONST.CANVAS_W, C = CONST.FONTS.CJK;
    const lines = [
      '抗生素治不了病毒；病毒與芽孢要靠紫外線／環境消毒',
      '抗藥性限制治療選擇，需要組合手段',
      '勤洗手、正確使用 PPE、接種疫苗，都能降低感染風險',
    ];
    const boxW = 640, x = (W - boxW) / 2, boxH = 24 + lines.length * 26;
    ctx.fillStyle = 'rgba(16, 40, 56, 0.85)';
    this._roundRect(ctx, x, y, boxW, boxH, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(127,224,208,0.5)'; ctx.lineWidth = 1.5;
    this._roundRect(ctx, x, y, boxW, boxH, 10); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7fe0d0'; ctx.font = `bold 15px ${C}`;
    ctx.fillText('衛教重點', W / 2, y + 20);
    ctx.fillStyle = '#d3e0ea'; ctx.font = `14px ${C}`;
    for (let i = 0; i < lines.length; i++) ctx.fillText('・' + lines[i], W / 2, y + 44 + i * 26);
  }

  _drawOverlay(ctx) {
    const W = CONST.CANVAS_W, H = CONST.CANVAS_H, C = CONST.FONTS.CJK, M = CONST.FONTS.MONO;
    const dim = (a) => { ctx.fillStyle = `rgba(6, 14, 24, ${a})`; ctx.fillRect(0, 0, W, H); };
    ctx.textAlign = 'center';

    switch (this.state) {
      case STATE.START: {
        dim(0.84);
        this._title(ctx, '醫院防疫大作戰', W / 2, 128, 54, '#7fe0d0');
        ctx.fillStyle = '#9fc6d0'; ctx.font = `18px ${C}`;
        ctx.fillText('Hospital Infection Defense', W / 2, 160);
        // 故事
        ctx.fillStyle = '#d3e0ea'; ctx.font = `17px ${C}`;
        ctx.fillText('你是一名感染管制醫師，病原體正湧入醫院。', W / 2, 208);
        ctx.fillText('善用感染控制工具，守護底部 ICU 的重症病人，擊退五波進攻與最終 Boss。', W / 2, 236);
        // 工具
        ctx.textAlign = 'left';
        const lx = W / 2 - 268;
        ctx.font = `bold 17px ${C}`;
        ctx.fillStyle = '#7fd8e8'; ctx.fillText('① 酒精噴霧', lx, 288);
        ctx.fillStyle = '#c8d6e2'; ctx.font = `15px ${C}`; ctx.fillText('近距離扇形，清一般細菌與污染，對病毒普通、芽孢極差', lx + 128, 288);
        ctx.fillStyle = '#f2c14e'; ctx.font = `bold 17px ${C}`; ctx.fillText('② 抗生素', lx, 320);
        ctx.fillStyle = '#c8d6e2'; ctx.font = `15px ${C}`; ctx.fillText('直線膠囊，遠射一般細菌；對病毒無效', lx + 128, 320);
        ctx.fillStyle = '#b98cf0'; ctx.font = `bold 17px ${C}`; ctx.fillText('③ 紫外線', lx, 352);
        ctx.fillStyle = '#c8d6e2'; ctx.font = `15px ${C}`; ctx.fillText('慢速光束穿透多敵，剋病毒、芽孢與污染，破 Boss 護盾', lx + 128, 352);
        ctx.textAlign = 'center';
        // 難度 / 模式 / 色盲
        const diffs = CONST.DIFFICULTY;
        ctx.font = `bold 15px ${C}`; ctx.fillStyle = '#8fa8ba';
        ctx.fillText('難度（← →）', W / 2 - 250, 394);
        for (let i = 0; i < diffs.length; i++) {
          const sel = i === this.menuDifficulty;
          ctx.fillStyle = sel ? '#ffe08a' : '#5f7688';
          ctx.font = `bold ${sel ? 18 : 15}px ${C}`;
          ctx.fillText(diffs[i].name, W / 2 - 130 + i * 66, 394);
        }
        ctx.font = `bold 15px ${C}`; ctx.fillStyle = '#8fa8ba';
        ctx.fillText('色盲友善（V）', W / 2 + 100, 394);
        ctx.font = `bold 16px ${C}`; ctx.fillStyle = this.menuColorblind ? '#7fe0d0' : '#5f7688';
        ctx.fillText(this.menuColorblind ? 'ON' : 'OFF', W / 2 + 200, 394);

        ctx.font = `bold 15px ${C}`; ctx.fillStyle = '#8fa8ba';
        ctx.fillText('模式（↑ ↓）', W / 2 - 250, 422);
        ctx.font = `bold 16px ${C}`;
        ctx.fillStyle = !this.menuEndless ? '#7fe0d0' : '#5f7688';
        ctx.fillText('劇情五波', W / 2 - 130, 422);
        ctx.fillStyle = this.menuEndless ? '#7fe0d0' : '#5f7688';
        ctx.fillText('無盡模式', W / 2 - 40, 422);
        if (this.menuEndless) {
          ctx.fillStyle = '#ffd166'; ctx.font = `bold 14px ${C}`;
          ctx.fillText(`最高分 ${this._loadBest()}`, W / 2 + 150, 422);
        }
        // 新手教學提示
        ctx.fillStyle = '#7fe0d0'; ctx.font = `bold 16px ${C}`;
        ctx.fillText('▶ 新手建議先看教學：按 T', W / 2, 452);
        // 操作 + 聲明
        ctx.fillStyle = '#9db6c8'; ctx.font = `13px ${C}`;
        ctx.fillText('WASD/方向鍵 移動 ・ Space 使用工具 ・ 1/2/3 或 Q/E 切換 ・ C 關隔離門 ・ P 暫停 ・ M 音效', W / 2, 476);
        ctx.fillStyle = '#7a93a4'; ctx.font = `12px ${C}`;
        ctx.fillText('本遊戲為教育與娛樂用途，不取代正式醫療建議或感染管制指引。', W / 2, 498);
        if (Math.floor(this.timeGlobal * 2) % 2 === 0) {
          ctx.fillStyle = '#ffe08a'; ctx.font = `bold 24px ${M}`;
          ctx.fillText('PRESS ENTER TO START', W / 2, 528);
        }
        break;
      }
      case STATE.TUTORIAL: {
        // 頂部教學指示條
        const step = this.tutorial ? this.tutorial.step : 0;
        ctx.fillStyle = 'rgba(16, 40, 56, 0.92)';
        ctx.fillRect(0, CONST.HUD_H, W, 46);
        ctx.fillStyle = '#7fe0d0'; ctx.font = `bold 13px ${C}`; ctx.textAlign = 'left';
        ctx.fillText(`教學 ${Math.min(step + 1, 5)}/5`, 16, CONST.HUD_H + 28);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#eaf7f4'; ctx.font = `bold 18px ${C}`;
        ctx.fillText(this.tutorialText, W / 2, CONST.HUD_H + 29);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#7c93aa'; ctx.font = `13px ${C}`;
        ctx.fillText('Esc 略過', W - 16, CONST.HUD_H + 28);
        ctx.textAlign = 'center';
        if (step >= 4 && Math.floor(this.timeGlobal * 2) % 2 === 0) {
          ctx.fillStyle = '#ffe08a'; ctx.font = `bold 22px ${M}`;
          ctx.fillText('PRESS ENTER', W / 2, H - 40);
        }
        break;
      }
      case STATE.WAVE_TRANSITION: {
        const wave = this.currentWave || CONST.WAVES[this.waveIndex];
        ctx.fillStyle = 'rgba(6, 14, 24, 0.5)';
        ctx.fillRect(0, H / 2 - 70, W, 132);
        this._title(ctx, `第 ${this.waveIndex + 1} 波`, W / 2, H / 2 - 10, 46, '#8ab8ff');
        ctx.fillStyle = '#c8d6e2'; ctx.font = `bold 24px ${C}`;
        ctx.fillText(wave ? wave.name : '', W / 2, H / 2 + 32);
        break;
      }
      case STATE.BOSS_INTRO: {
        dim(0.5 + 0.2 * Math.sin(this.timeGlobal * 6));
        this._title(ctx, '警告', W / 2, H / 2 - 30, 48, '#ff5d5d');
        ctx.fillStyle = '#ffd166'; ctx.font = `bold 24px ${C}`;
        ctx.fillText('超級抗藥菌王 接近 ICU！', W / 2, H / 2 + 20);
        break;
      }
      case STATE.PAUSED: {
        dim(0.72);
        this._title(ctx, '暫停', W / 2, H / 2 - 10, 44, '#ffe08a');
        ctx.fillStyle = '#9fb0c6'; ctx.font = `16px ${C}`;
        ctx.fillText('按 P 繼續', W / 2, H / 2 + 34);
        break;
      }
      case STATE.GAME_OVER: {
        dim(0.82);
        this._title(ctx, '院內感染失控', W / 2, 150, 50, '#ff5d5d');
        ctx.fillStyle = '#ffe08a'; ctx.font = `bold 26px ${M}`;
        ctx.fillText(`最終分數 ${this.score}`, W / 2, 200);
        this._drawScoreSummary(ctx, 244);
        this._drawRecap(ctx, 330);
        ctx.fillStyle = '#9fb0c6'; ctx.font = `bold 19px ${M}`;
        ctx.fillText('PRESS R TO RESTART', W / 2, 512);
        break;
      }
      case STATE.VICTORY: {
        dim(0.82);
        this._title(ctx, this.endless ? '防疫任務結束' : '院內感染控制成功', W / 2, 148, 46, '#57e08a');
        ctx.fillStyle = '#ffe08a'; ctx.font = `bold 26px ${M}`;
        ctx.fillText(`最終分數 ${this.score}`, W / 2, 198);
        this._drawScoreSummary(ctx, 242);
        this._drawRecap(ctx, 330);
        ctx.fillStyle = '#9fb0c6'; ctx.font = `16px ${C}`;
        ctx.fillText('按 R 再玩一次', W / 2, 512);
        break;
      }
    }
    if (window.__DEBUG) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#00ffcc'; ctx.font = `11px ${M}`;
      ctx.fillText('DEBUG: [7]療病人 [8]過波 [9]清敵 [0]召Boss [I]無敵 [H]碰撞框 [K]傷Boss', 10, H - 10);
    }
    ctx.textAlign = 'left';
  }
}
