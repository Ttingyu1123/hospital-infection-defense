// 60s soak: autoplay with invincible player, verify no console errors,
// bounded object arrays, and no heap runaway / double game loop.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8791/');
  await page.waitForFunction(() => window.__game !== undefined);
  await page.keyboard.press('Enter');
  await sleep(3000);
  await page.evaluate(() => { window.__game.player.lives = 999; window.__game.patientHp = 100; });

  const heap = () => page.evaluate(() => { if (window.gc) { gc(); gc(); } return performance.memory ? performance.memory.usedJSHeapSize : 0; });
  const h0 = await heap();
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const tools = ['Digit1', 'Digit2', 'Digit3'];
  let maxArr = 0;
  const tEnd = Date.now() + 60000;
  let i = 0;
  while (Date.now() < tEnd) {
    const k = keys[i % 4];
    if (i % 5 === 0) await page.keyboard.press(tools[(i / 5 | 0) % 3]);
    await page.keyboard.down(k); await page.keyboard.down('Space');
    await sleep(650);
    await page.keyboard.up('Space'); await page.keyboard.up(k);
    i++;
    const s = await page.evaluate(() => {
      const g = window.__game;
      const arr = g.projectiles.length + g.particles.particles.length + g.enemies.length + g.floatTexts.length + g.effects.length + g.items.length;
      return { state: g.state, arr, patient: g.patientHp };
    });
    maxArr = Math.max(maxArr, s.arr);
    // keep alive: top up lives/patient; advance if ended
    if (s.state === 'GAME_OVER' || s.state === 'VICTORY') {
      await page.keyboard.press('KeyR'); await sleep(2500);
      await page.evaluate(() => { window.__game.player.lives = 999; });
    } else if (s.patient < 30) {
      await page.evaluate(() => { window.__game.patientHp = 100; });
    }
  }
  const h1 = await heap();
  const growthMb = (h1 - h0) / 1e6;
  const finalCounts = await page.evaluate(() => {
    const g = window.__game;
    return { projectiles: g.projectiles.length, particles: g.particles.particles.length, enemies: g.enemies.length, floats: g.floatTexts.length, state: g.state, wave: g.waveIndex };
  });
  console.log(`heap: ${(h0 / 1e6).toFixed(1)}MB -> ${(h1 / 1e6).toFixed(1)}MB (growth ${growthMb >= 0 ? '+' : ''}${growthMb.toFixed(1)}MB)`);
  console.log('peak combined array size:', maxArr, '(particle cap', ' MAX_PARTICLES 480)');
  console.log('final counts:', JSON.stringify(finalCounts));
  console.log('console errors:', errors.length, errors.slice(0, 5));
  const ok = growthMb < 12 && errors.length === 0 && maxArr < 700;
  console.log('SOAK', ok ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
