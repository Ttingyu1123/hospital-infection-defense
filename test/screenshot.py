"""視覺檢查：擷取開始畫面與遊玩中畫面，並量測 FPS。"""
import sys
import time

from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "test/shots"

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 900})
    page.goto("http://127.0.0.1:8777/")
    page.wait_for_function("() => window.__game !== undefined")
    time.sleep(0.6)
    page.screenshot(path=f"{OUT}/01_start.png")

    page.keyboard.press("Enter")
    time.sleep(1.0)
    page.screenshot(path=f"{OUT}/02_wave_banner.png")
    time.sleep(2.2)

    # 玩一下：移動 + 射擊，讓敵人出來
    page.keyboard.down("KeyW"); time.sleep(0.4); page.keyboard.up("KeyW")
    page.keyboard.down("Space"); time.sleep(0.3); page.keyboard.up("Space")
    time.sleep(4.0)
    # FPS 量測：數 1 秒內 RAF 次數
    fps = page.evaluate("""() => new Promise(res => {
        let n = 0; const t0 = performance.now();
        function tick() { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); }
        requestAnimationFrame(tick);
    })""")
    page.screenshot(path=f"{OUT}/03_gameplay.png")
    print(f"FPS ~= {fps}")

    # 草叢 / 水面近照（畫面左側區域）
    page.keyboard.down("KeyA"); time.sleep(0.8); page.keyboard.up("KeyA")
    time.sleep(2.0)
    page.screenshot(path=f"{OUT}/04_gameplay2.png")
    browser.close()
print("done")
