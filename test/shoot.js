// Capture representative screenshots for visual verification.
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1000, height: 820 } });
  await page.goto('http://127.0.0.1:8791/');
  await page.waitForFunction(() => window.__game !== undefined);
  await sleep(500);
  await page.screenshot({ path: 'test/shots/01_start.png' });

  await page.keyboard.press('Enter');
  await sleep(900);
  await page.screenshot({ path: 'test/shots/02_wave.png' });
  await sleep(2200);

  // play: move around and fire
  for (const k of ['KeyA', 'KeyW', 'KeyD', 'KeyS']) { await page.keyboard.down(k); await page.keyboard.down('Space'); await sleep(600); await page.keyboard.up('Space'); await page.keyboard.up(k); }
  // force some enemies + contamination + an item to show systems
  await page.evaluate(() => {
    const g = window.__game;
    g.enemies.push(new Pathogen('normal', 300, 250));
    g.enemies.push(new Pathogen('virus', 620, 220));
    g.enemies.push(new Pathogen('spore', 420, 300));
    g.enemies.push(new Pathogen('resistant', 540, 260));
    g.map.seedContam(14);
    g.items.push(new Item('ppe', 360, 400));
    g.items.push(new Item('firstaid', 600, 400));
  });
  await sleep(400);
  await page.screenshot({ path: 'test/shots/03_gameplay.png' });

  // UV beam shot
  await page.evaluate(() => { const g = window.__game; g.player.setTool('uv'); g.player.x = 300; g.player.y = 250; g.player.dir = DIR.RIGHT; g.player.energy.uv = 100; Tools.uv(g, g.player); });
  await sleep(60);
  await page.screenshot({ path: 'test/shots/04_uv.png' });

  // boss
  await page.evaluate(() => { window.__DEBUG = true; window.__game.state = 'PLAYING'; if (!window.__game.boss) window.__game._spawnBoss(); window.__game.boss.hp = window.__game.boss.maxHp * 0.25; });
  await sleep(600);
  await page.screenshot({ path: 'test/shots/05_boss.png' });
  await page.close();

  // touch controls view (forced) + start menu with bigger fonts
  const tp = await b.newPage({ viewport: { width: 1000, height: 820 } });
  await tp.goto('http://127.0.0.1:8791/?touch=1');
  await tp.waitForFunction(() => window.__game !== undefined);
  await sleep(400);
  await tp.screenshot({ path: 'test/shots/06_touch_start.png' });
  await tp.evaluate(() => { document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await sleep(3200);
  await tp.evaluate(() => { const g = window.__game; g.enemies.push(new Pathogen('normal', 300, 260), new Pathogen('virus', 620, 240)); g.patientShield = 10; });
  await sleep(300);
  await tp.screenshot({ path: 'test/shots/07_touch_play.png' });

  await b.close();
  console.log('shots done');
})();
