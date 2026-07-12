// Tests for the added extensions: difficulty scaling, endless mode, vaccination
// station, and touch-control presence.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const results = [];
  const check = (n, c) => results.push([n, !!c]);

  // ---------- desktop: no touch UI unless forced ----------
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:8791/');
    await page.waitForFunction(() => window.__game !== undefined);
    check('no touch UI on desktop', await page.evaluate(() => !document.getElementById('touch')));
    await page.close();
  }

  // ---------- forced touch UI via ?touch=1 ----------
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:8791/?touch=1');
    await page.waitForFunction(() => window.__game !== undefined);
    check('touch UI present with ?touch=1', await page.evaluate(() => {
      const t = document.getElementById('touch');
      return !!t && !!t.querySelector('#tc-stick') && t.querySelectorAll('.tc-btn').length >= 5;
    }));
    // tapping canvas starts the game
    await page.evaluate(() => document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await sleep(100);
    check('canvas tap starts game', await page.evaluate(() => window.__game.state !== 'START'));
    await page.close();
  }

  // ---------- difficulty menu + scaling ----------
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:8791/');
    await page.waitForFunction(() => window.__game !== undefined);
    // default 普通
    check('default difficulty 普通', await page.evaluate(() => window.__game.menuDifficulty === 1));
    // arrow left -> 簡單
    await page.keyboard.press('ArrowLeft');
    check('ArrowLeft -> 簡單', await page.evaluate(() => window.__game.menuDifficulty === 0));
    // arrow up toggles endless
    await page.keyboard.press('ArrowUp');
    check('ArrowUp toggles endless', await page.evaluate(() => window.__game.menuEndless === true));
    // set 困難 + scripted, start, verify enemy scaled harder than 普通
    const scaling = await page.evaluate(() => {
      const g = window.__game;
      g.menuEndless = false;
      // sample normal hp at 簡單(0), 普通(1), 困難(2)
      const hpAt = (d) => { g.menuDifficulty = d; g.startGame(); const p = new Pathogen('normal', 300, 300); g._applyDiff(p); return p.maxHp; };
      return { easy: hpAt(0), normal: hpAt(1), hard: hpAt(2), speedHard: (() => { g.menuDifficulty = 2; g.startGame(); const p = new Pathogen('normal', 300, 300); g._applyDiff(p); return p.speedMul; })() };
    });
    check('hard hp > normal > easy', scaling.hard > scaling.normal && scaling.normal > scaling.easy);
    check('hard speedMul > 1', scaling.speedHard > 1);
    await page.close();
  }

  // ---------- endless mode: dynamic waves, boss every 5th, never victory-on-wave ----------
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:8791/');
    await page.waitForFunction(() => window.__game !== undefined);
    const r = await page.evaluate(() => {
      const g = window.__game; g.menuEndless = true; g.menuDifficulty = 1; g.startGame();
      const step = (pred, max = 3000) => { for (let i = 0; i < max; i++) { g.update(0.05, window.__input); if (pred()) return true; } return false; };
      const waves = []; let bossWave = -1;
      for (let w = 0; w < 6; w++) {
        step(() => g.state === 'PLAYING' || g.state === 'BOSS_INTRO');
        if (g.state === 'BOSS_INTRO') step(() => g.state === 'PLAYING' && g.boss);
        waves.push(g.currentWave.name);
        if (g.currentWave.boss) bossWave = w;
        if (g.boss) g.boss.alive = false; // defeat boss
        g._forceWaveComplete();
        step(() => g.waveIndex !== w, 800);
      }
      return { waves, bossWave, reachedWave: g.waveIndex, everVictory: g.state === 'VICTORY' || g.endTarget === 'VICTORY' };
    });
    check('endless generates 6+ dynamic waves', r.waves.length >= 6 && r.waves[0].includes('無盡'));
    check('endless boss on 5th wave (index 4)', r.bossWave === 4);
    check('endless never triggers victory', r.everVictory === false && r.reachedWave >= 5);
    await page.close();
  }

  // ---------- vaccination station: buff + patient damage reduction + tip ----------
  {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:8791/');
    await page.waitForFunction(() => window.__game !== undefined);
    await page.keyboard.press('Enter'); await sleep(200);
    const r = await page.evaluate(() => {
      const g = window.__game; const o = {};
      // move player onto a vaccine station
      const v = g.vaccineStations[0];
      g.player.x = v.x + v.w + 12; g.player.y = v.y + v.h / 2;
      g._updateVaccineStations(0.1);
      o.shieldSet = g.patientShield > 0;
      o.tipShown = g.tipsShown.has('vaccine');
      // damage reduction: with shield vs without
      g.patientHp = 100; g.patientShield = 10; g.damagePatient(20, 480, 690); const withShield = 100 - g.patientHp;
      g.patientHp = 100; g.patientShield = 0; g.damagePatient(20, 480, 690); const without = 100 - g.patientHp;
      o.reduces = withShield < without;
      // vaccine station blocks movement
      g.player.x = v.x - 40; g.player.y = v.y + v.h / 2; g.player.dir = DIR.RIGHT;
      for (let i = 0; i < 120; i++) g.player.move(0.016, g);
      o.blocks = g.player.x < v.x; // stopped before station
      return o;
    });
    check('vaccine sets patient shield', r.shieldSet);
    check('vaccine tip shown', r.tipShown);
    check('vaccine reduces patient damage', r.reduces);
    check('vaccine station blocks movement', r.blocks);
    await page.close();
  }

  console.log('\n=== FEATURE RESULTS ===');
  let pass = 0;
  for (const [n, ok] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (ok) pass++; }
  console.log(`\n${pass}/${results.length} passed | console/page errors: ${errors.length}`);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 6));
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
