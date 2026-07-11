"""60 秒 soak test：自動遊玩，檢查記憶體與物件數是否累積、console 是否出錯。"""
import time

from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--js-flags=--expose-gc"])
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://127.0.0.1:8777/")
    page.wait_for_function("() => window.__game !== undefined")
    page.keyboard.press("Enter")
    time.sleep(3)
    # 玩家不死（測穩定性，不測輸贏），隨機走位開火
    page.evaluate("() => { window.__game.player.lives = 999; }")

    def heap():
        return page.evaluate("() => { if (window.gc) { gc(); gc(); } return performance.memory.usedJSHeapSize; }")

    h0 = heap()
    keys = ["KeyW", "KeyA", "KeyS", "KeyD"]
    t_end = time.time() + 60
    i = 0
    while time.time() < t_end:
        k = keys[i % 4]
        i += 1
        page.keyboard.down(k)
        page.keyboard.down("Space")
        time.sleep(0.7)
        page.keyboard.up("Space")
        page.keyboard.up(k)
        # 玩家無敵狀態下若復活中就等它回來；波次全清會自動推進
        st = page.evaluate("() => window.__game.state")
        if st in ("GAME_OVER", "VICTORY"):
            page.keyboard.press("KeyR")
            time.sleep(3)
            page.evaluate("() => { window.__game.player.lives = 999; }")
    h1 = heap()
    counts = page.evaluate("""() => {
        const g = window.__game;
        return [g.bullets.length, g.particles.particles.length, g.enemies.length, g.floatTexts.length, g.state, g.waveIndex];
    }""")
    growth_mb = (h1 - h0) / 1e6
    print(f"heap: {h0/1e6:.1f}MB -> {h1/1e6:.1f}MB (growth {growth_mb:+.1f}MB)")
    print(f"final counts [bullets, particles, enemies, floats, state, wave]: {counts}")
    print(f"console errors: {len(errors)}")
    if errors:
        print(errors[:5])
    ok = growth_mb < 8 and len(errors) == 0
    print("SOAK", "PASS" if ok else "FAIL")
    browser.close()
    raise SystemExit(0 if ok else 1)
