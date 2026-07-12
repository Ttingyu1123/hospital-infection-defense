// Tests for the six gameplay improvements: pathfinding, hit juice, tutorial,
// end-game summary, colorblind palette, endless high score.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8791/?v=' + Date.now());
  await page.waitForFunction(() => window.__game !== undefined);
  const results = [];
  const check = (n, c) => results.push([n, !!c]);

  // ---------- #4 flow-field pathfinding ----------
  const pf = await page.evaluate(() => {
    const g = window.__game;
    // field computed at reset
    const spawn = CONST.ENEMY_SPAWNS[1];
    const dirAtSpawn = g.map.flowDir(spawn.x, spawn.y);
    const finiteField = isFinite(g.map.flowVal(Math.floor(spawn.x / CONST.TILE), Math.floor(spawn.y / CONST.TILE)));
    // release a pathogen from a spawn and let it navigate; distance to patient should drop
    const e = new Pathogen('normal', spawn.x, spawn.y);
    g.enemies = [e];
    const pc = g.patientCenter;
    const d0 = Math.hypot(e.x - pc.x, e.y - pc.y);
    for (let i = 0; i < 260; i++) { e.update(0.05, g); }
    const d1 = Math.hypot(e.x - pc.x, e.y - pc.y);
    // recompute on partition destroy
    g.map.reset();
    const before = g.map.flowVal(19, 22);
    // knock out a front partition -> flowDirty -> recompute
    g.map.grid[23][15].type = T.EMPTY; g.map.flowDirty = true; g.map.computeFlowField();
    const dirty = g.map.flowDirty === false;
    return { dirAtSpawn, finiteField, d0, d1, approached: d1 < d0 - 60, dirty };
  });
  check('flow field computed (finite at spawn)', pf.finiteField);
  check('flowDir valid at spawn', pf.dirAtSpawn >= 0);
  check('pathogen navigates toward patient', pf.approached);
  check('flow recompute clears dirty', pf.dirty);

  // ---------- #5 hit juice ----------
  const juice = await page.evaluate(() => {
    const g = window.__game; g.startGame();
    const e = new Pathogen('normal', 300, 300); g.enemies = [e];
    const p0 = g.particles.particles.length;
    g.onToolHit(e, 'uv', 1.0);
    const popped = e.hitPop > 0, moreParticles = g.particles.particles.length > p0;
    g.hitStop = 0; g._enemyDestroyed(e);
    return { popped, moreParticles, hitStop: g.hitStop > 0 };
  });
  check('hit sets hitPop', juice.popped);
  check('hit spawns particles', juice.moreParticles);
  check('kill triggers hit-stop', juice.hitStop);

  // ---------- #2 tutorial ----------
  const tut = await page.evaluate(() => {
    const g = window.__game; g.startTutorial();
    const started = g.state === 'TUTORIAL' && g.tutorial.step === 0;
    // simulate movement -> step 1 (spawns a dummy)
    for (let i = 0; i < 30; i++) { g.player.x += 4; g._updateTutorial(0.05, window.__input); }
    const step1 = g.tutorial.step === 1 && g.enemies.length === 1;
    // kill dummies through the steps 1->2->3->4
    const steps = [g.tutorial.step];
    for (let s = 0; s < 4; s++) {
      g.enemies.forEach(e => e.alive = false);
      g._updateTutorial(0.05, window.__input);
      steps.push(g.tutorial.step);
    }
    const reached4 = g.tutorial.step >= 4;
    // Enter on last step starts the game
    g.onKeyDown('Enter');
    return { started, step1, reached4, startedGame: g.state !== 'TUTORIAL' && g.state !== 'START' };
  });
  check('tutorial enters at step 0', tut.started);
  check('movement advances to step 1 + dummy', tut.step1);
  check('killing dummies reaches step 4', tut.reached4);
  check('Enter on last step starts game', tut.startedGame);

  // tutorial skippable
  check('Esc skips tutorial', await page.evaluate(() => {
    const g = window.__game; g.startTutorial(); g.onKeyDown('Escape');
    return g.state !== 'TUTORIAL' && g.state !== 'START';
  }));

  // ---------- #3 end-game summary (wrong-tool tracking) ----------
  const sum = await page.evaluate(() => {
    const g = window.__game; g.startGame();
    g.correctToolUses = 0; g.wrongToolUses = 0;
    const v = new Pathogen('virus', 300, 300); g.enemies = [v];
    Tools.applyDamage(g, v, 'antibiotic', 1.0); // 0 dmg -> wrong
    const wrongAfterImmune = g.wrongToolUses;
    const n = new Pathogen('normal', 320, 300); g.enemies.push(n);
    Tools.applyDamage(g, n, 'alcohol', 0.85); // effective -> correct
    return { wrongAfterImmune, correct: g.correctToolUses, wrong: g.wrongToolUses };
  });
  check('immune hit counts as wrong tool', sum.wrongAfterImmune === 1);
  check('effective hit counts as correct', sum.correct === 1);

  // ---------- #6 colorblind palette + weakness ----------
  const cb = await page.evaluate(() => {
    const g = window.__game;
    COLORBLIND = false; const normA = enemyColor('normal');
    COLORBLIND = true; const normB = enemyColor('normal');
    COLORBLIND = false;
    // showWeakness on easy / cb / tutorial
    g.menuColorblind = true; const wCB = g.showWeakness;
    g.menuColorblind = false; g.difficultyIndex = 0; const wEasy = g.showWeakness;
    g.difficultyIndex = 1; const wNormal = g.showWeakness;
    return { paletteDiffers: normA !== normB, wCB, wEasy, wNormal };
  });
  check('colorblind palette differs', cb.paletteDiffers);
  check('weakness shown in colorblind/easy, hidden on normal', cb.wCB && cb.wEasy && !cb.wNormal);

  // ---------- #7 endless high score ----------
  const hs = await page.evaluate(() => {
    const g = window.__game;
    try { localStorage.removeItem('hid_endless_best'); } catch (e) {}
    g.endless = true; g.score = 4242; g.newRecord = false;
    g._recordEndlessScore();
    const best = g._loadBest(), rec = g.newRecord;
    // lower score should not beat best
    g.score = 1000; g.newRecord = false; g._recordEndlessScore();
    const stillBest = g._loadBest();
    return { best, rec, stillBest };
  });
  check('endless score saved to localStorage', hs.best === 4242 && hs.rec === true);
  check('lower score does not overwrite best', hs.stillBest === 4242);

  console.log('\n=== IMPROVEMENT RESULTS ===');
  let pass = 0;
  for (const [n, ok] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (ok) pass++; }
  console.log(`\n${pass}/${results.length} passed | console/page errors: ${errors.length}`);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
