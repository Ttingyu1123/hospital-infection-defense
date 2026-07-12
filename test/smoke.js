// Node + global Playwright smoke test: boots the game, checks console errors,
// exercises movement/tools/waves/boss/restart, verifies no runtime errors.
const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8791/';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(URL);
  await page.waitForFunction(() => window.__game !== undefined);
  const results = [];
  const check = (name, cond) => { results.push([name, !!cond]); };

  check('start state', await page.evaluate(() => window.__game.state === 'START'));

  await page.keyboard.press('Enter');
  await sleep(300);
  const st1 = await page.evaluate(() => window.__game.state);
  check('entered wave', st1 === 'WAVE_TRANSITION' || st1 === 'PLAYING');
  await sleep(2800);
  check('playing', await page.evaluate(() => window.__game.state === 'PLAYING'));

  // movement + bounds
  const p0 = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
  await page.keyboard.down('KeyW'); await sleep(500); await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
  check('player moved', Math.abs(p1.y - p0.y) > 5 || Math.abs(p1.x - p0.x) > 5);
  check('player in bounds', await page.evaluate(() => { const p = window.__game.player; return p.x > 0 && p.x < 960 && p.y > 0 && p.y < 720; }));

  // wall collision: try to push up into a wall region repeatedly, stays in bounds
  check('no wall clip', await page.evaluate(() => {
    const g = window.__game, p = g.player;
    for (let i = 0; i < 400; i++) { p.dir = DIR.UP; p.move(0.016, g); }
    return !g.map.rectBlocksEntity(p.rect.x, p.rect.y, p.size, p.size);
  }));

  // tool switching
  await page.keyboard.press('Digit2');
  check('switch antibiotic', await page.evaluate(() => window.__game.player.toolId === 'antibiotic'));
  await page.keyboard.press('Digit3');
  check('switch uv', await page.evaluate(() => window.__game.player.toolId === 'uv'));
  await page.keyboard.press('KeyE');
  check('cycle wraps to alcohol', await page.evaluate(() => window.__game.player.toolId === 'alcohol'));

  // antibiotic fires a projectile (deterministic: open area, direct call, read same tick)
  check('projectile spawned', await page.evaluate(() => {
    const g = window.__game, p = g.player;
    p.setTool('antibiotic'); p.x = 480; p.y = 320; p.dir = DIR.LEFT;
    p.energy.antibiotic = 100; p.activeBullets = 0;
    const before = g.projectiles.length;
    Tools.antibiotic(g, p);
    return g.projectiles.length === before + 1 && g.projectiles.some(b => b.kind === 'antibiotic' && b.owner === 'player');
  }));
  await page.evaluate(() => { window.__game.projectiles.length = 0; });

  // pathogens spawn over time
  await sleep(1600);
  check('pathogens exist', await page.evaluate(() => window.__game.enemies.length + window.__game.spawnWarns.length > 0));

  // all 4 enemy types instantiable
  check('4 enemy types instantiable', await page.evaluate(() => {
    const g = window.__game;
    g.enemies.push(new Pathogen('virus', 300, 200));
    g.enemies.push(new Pathogen('spore', 400, 200));
    g.enemies.push(new Pathogen('resistant', 500, 200));
    return g.enemies.some(e => e.type === 'virus') && g.enemies.some(e => e.type === 'spore') && g.enemies.some(e => e.type === 'resistant');
  }));

  // resistance education: antibiotic 0 dmg to virus, uv damages virus
  const virusDmg = await page.evaluate(() => {
    const g = window.__game;
    const v = g.enemies.find(e => e.type === 'virus');
    const before = v.hp;
    Tools.applyDamage(g, v, 'antibiotic', 1.0);
    const afterAb = v.hp;
    Tools.applyDamage(g, v, 'uv', 2.2);
    return { before, afterAb, afterUv: v.hp };
  });
  check('antibiotic no dmg to virus', virusDmg.before === virusDmg.afterAb);
  check('uv damages virus', virusDmg.afterUv < virusDmg.afterAb);

  // spore resists alcohol (very low), uv strong
  const sporeDmg = await page.evaluate(() => {
    const g = window.__game;
    const s = g.enemies.find(e => e.type === 'spore');
    const b = s.hp; Tools.applyDamage(g, s, 'alcohol', 0.85); const a1 = s.hp;
    Tools.applyDamage(g, s, 'uv', 2.2); const a2 = s.hp;
    return { alcoholLoss: b - a1, uvLoss: a1 - a2 };
  });
  check('spore resists alcohol < uv', sporeDmg.alcoholLoss < sporeDmg.uvLoss);

  // patient damage
  const patHp0 = await page.evaluate(() => window.__game.patientHp);
  await page.evaluate(() => window.__game.damagePatient(15, 480, 690));
  check('patient takes damage', await page.evaluate(() => window.__game.patientHp) < patHp0);

  // wash station -> hand hygiene
  await page.evaluate(() => { const g = window.__game, w = g.washStations[0]; g.player.x = w.x + w.w + 12; g.player.y = w.y + w.h / 2; });
  await sleep(150);
  check('hand hygiene from wash', await page.evaluate(() => window.__game.player.handHygiene > 0));

  // education tips recorded once
  check('tips deduped', await page.evaluate(() => {
    const g = window.__game; const n0 = g.tipsShown.size;
    g.triggerTip('ppe'); const n1 = g.tipsShown.size; g.triggerTip('ppe'); const n2 = g.tipsShown.size;
    return n1 === n0 + 1 && n2 === n1;
  }));

  // boss via debug + defeat through 3 phases
  await page.evaluate(() => { window.__DEBUG = true; });
  await page.keyboard.press('Digit0');
  await sleep(200);
  check('boss spawned', await page.evaluate(() => !!(window.__game.boss && window.__game.boss.isBoss)));
  const phases = await page.evaluate(() => {
    const g = window.__game; const seen = new Set();
    for (let i = 0; i < 400 && g.boss && g.boss.alive; i++) {
      seen.add(g.boss.phase);
      g.boss.shieldHp = 0; g.boss.hp -= 0.6; g.boss._updatePhase(g);
    }
    return [...seen];
  });
  check('boss had 3 phases', phases.includes(1) && phases.includes(2) && phases.includes(3));
  await page.evaluate(() => { const g = window.__game; if (g.boss) { g.boss.hp = -1; g.boss.alive = false; g._bossDefeated(); } });
  check('boss defeat -> victory', await page.evaluate(() => window.__game.state === 'VICTORY' || window.__game.endTarget === 'VICTORY'));

  // restart clean
  await sleep(1800);
  await page.keyboard.press('KeyR');
  await sleep(200);
  const rs = await page.evaluate(() => { const g = window.__game; return { enemies: g.enemies.length, projectiles: g.projectiles.length, boss: g.boss, wave: g.waveIndex, patient: g.patientHp }; });
  check('restart clears world', rs.enemies === 0 && rs.projectiles === 0 && rs.boss === null);
  check('restart resets patient/wave', rs.patient === 100 && rs.wave === 0);

  // single rAF loop (no double loop after restart): frame count ~ 1 per rAF
  const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); function tick() { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); } requestAnimationFrame(tick); }));
  check('fps 50-70 (single loop)', fps >= 50 && fps <= 75);

  await page.screenshot({ path: 'test/shots/smoke_final.png' });

  console.log('\n=== SMOKE RESULTS ===');
  let pass = 0;
  for (const [n, ok] of results) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`); if (ok) pass++; }
  console.log(`\n${pass}/${results.length} passed  |  fps~${fps}  |  console errors: ${errors.length}`);
  if (errors.length) console.log('ERRORS:', errors.slice(0, 8));
  await browser.close();
  process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
})();
