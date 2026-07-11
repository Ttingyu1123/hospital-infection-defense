"""IRON VANGUARD e2e 驗收測試（Playwright, headless Chromium）。

對應 spec 驗收條件 1-28。透過 window.__game 檢查內部狀態，
並以真實鍵盤事件驅動玩家操作。
"""
import sys
import time

from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8777/"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f" -- {detail}" if detail and not cond else ""))


def g(page, expr):
    return page.evaluate(f"(() => {{ const g = window.__game; return {expr}; }})()")


def wait_state(page, state, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if g(page, "g.state") == state:
            return True
        time.sleep(0.1)
    return False


def fire(page):
    """按住 Space 約 80ms，確保遊戲迴圈輪詢得到按鍵。"""
    page.keyboard.down("Space")
    time.sleep(0.08)
    page.keyboard.up("Space")


def freeze_spawns(page):
    """暫停敵人生成（spawnList 保持非空，波次不會誤判完成）。"""
    page.evaluate("""() => {
        const g = window.__game;
        g.spawnTimer = 99999;
        g.spawnWarns = [];
        g.enemies.forEach(e => e.alive = false);
        if (g.spawnList.length === 0) g.spawnList.push('normal');
    }""")


def main():
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 960})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE_URL)
        page.wait_for_function("() => window.__game !== undefined", timeout=5000)

        # 1-2. 頁面開啟 / Canvas 顯示
        box = page.locator("#game").bounding_box()
        check("1. 頁面正常開啟", True)
        check("2. Canvas 顯示且維持 4:3", box and abs(box["width"] / box["height"] - 4 / 3) < 0.02,
              f"box={box}")
        check("初始狀態為 START", g(page, "g.state") == "START")

        # 開始遊戲
        page.keyboard.press("Enter")
        check("Enter 進入 WAVE_TRANSITION", g(page, "g.state") == "WAVE_TRANSITION")
        check("21a. 波次提示顯示 WAVE 1", g(page, "g.waveIndex") == 0)
        wait_state(page, "PLAYING", timeout=5)
        check("波次提示 2.5s 後進入 PLAYING", g(page, "g.state") == "PLAYING")
        freeze_spawns(page)  # 後續為確定性測試，先凍結敵人生成

        # 3. 四方向移動 + 朝向
        pos0 = g(page, "[g.player.x, g.player.y, g.player.dir]")
        page.keyboard.down("KeyA"); time.sleep(0.35); page.keyboard.up("KeyA")
        pos1 = g(page, "[g.player.x, g.player.y, g.player.dir]")
        check("3a. 左移且朝向更新", pos1[0] < pos0[0] - 20 and pos1[2] == 3, f"{pos0} -> {pos1}")
        page.keyboard.down("KeyD"); time.sleep(0.35); page.keyboard.up("KeyD")
        pos2 = g(page, "[g.player.x, g.player.y, g.player.dir]")
        check("3b. 右移且朝向更新", pos2[0] > pos1[0] + 20 and pos2[2] == 1, f"{pos1} -> {pos2}")
        page.keyboard.down("KeyW"); time.sleep(0.3); page.keyboard.up("KeyW")
        pos3 = g(page, "[g.player.x, g.player.y, g.player.dir]")
        check("3c. 上移且朝向更新", pos3[1] < pos2[1] - 20 and pos3[2] == 0, f"{pos2} -> {pos3}")
        page.keyboard.down("KeyS"); time.sleep(0.3); page.keyboard.up("KeyS")
        pos4 = g(page, "[g.player.x, g.player.y, g.player.dir]")
        check("3d. 下移且朝向更新", pos4[1] > pos3[1] + 20 and pos4[2] == 2, f"{pos3} -> {pos4}")

        # 4. 不可穿牆：回到出生點向上推 — 會被鋼牆擋住（y 不低於 644）
        page.evaluate("() => { const g = window.__game; g.player.x = 360; g.player.y = 696; }")
        page.keyboard.down("KeyW"); time.sleep(1.2); page.keyboard.up("KeyW")
        py = g(page, "g.player.y")
        check("4. 玩家被鋼牆擋住不可穿牆", 643 <= py <= 646, f"y={py}")

        # 26. 縮放不影響碰撞：改視窗大小後邏輯座標不變
        page.set_viewport_size({"width": 640, "height": 480})
        time.sleep(0.2)
        py2 = g(page, "g.player.y")
        box2 = page.locator("#game").bounding_box()
        check("26. 縮放後邏輯座標不變且比例維持",
              py2 == py and abs(box2["width"] / box2["height"] - 4 / 3) < 0.02,
              f"y={py2}, box={box2}")
        page.set_viewport_size({"width": 1280, "height": 960})

        # 5-6. 射擊 + 砲彈方向；8. 鋼牆不可摧毀（往上射，砲口貼鋼牆）
        steel_before = g(page, "g.map.grid.flat().filter(c => c.type === 2).length")
        fire(page)
        time.sleep(0.15)
        steel_after = g(page, "g.map.grid.flat().filter(c => c.type === 2).length")
        check("8. 鋼牆不能被普通砲彈摧毀", steel_before == steel_after,
              f"{steel_before} -> {steel_after}")

        # 開闊處驗證砲彈直線飛行方向 + 同時存在數量上限
        page.evaluate("() => { const g = window.__game; g.player.x = 480; g.player.y = 216; g.player.dir = 1; g.player.cooldown = 0; }")
        time.sleep(0.05)
        page.keyboard.down("Space")
        time.sleep(0.12)
        b0 = g(page, "g.bullets.filter(b => b.owner === 'player').map(b => [b.x, b.y, b.dir])")
        time.sleep(0.15)
        b1 = g(page, "g.bullets.filter(b => b.owner === 'player').map(b => [b.x, b.y, b.dir])")
        check("5. 玩家可射擊", len(b0) >= 1, f"bullets={b0}")
        moved_right = len(b0) >= 1 and len(b1) >= 1 and b1[0][0] > b0[0][0] and b1[0][1] == b0[0][1]
        check("6. 砲彈沿朝向直線飛行", moved_right, f"{b0} -> {b1}")
        time.sleep(0.6)
        maxb = g(page, "g.bullets.filter(b => b.owner === 'player').length")
        page.keyboard.up("Space")
        check("玩家同時砲彈數 <= 2", maxb <= 2, f"count={maxb}")
        time.sleep(1.5)  # 讓砲彈飛完

        # 7. 磚牆可被摧毀（射基地護牆磚，兩發打穿一格）
        page.evaluate("() => { const g = window.__game; g.player.x = 360; g.player.y = 696; g.player.dir = 1; g.player.cooldown = 0; }")
        brick_before = g(page, "g.map.grid[29][18].type")
        for _ in range(2):
            fire(page)
            time.sleep(0.55)
        brick_after = g(page, "g.map.grid[29][18].type")
        check("7. 磚牆可被砲彈摧毀（含耐久）", brick_before == 1 and brick_after == 0,
              f"type {brick_before} -> {brick_after}")

        # 17-18. 基地可被摧毀 → 遊戲結束（護牆已破，往右第三發直擊基地）
        fire(page)
        time.sleep(0.6)
        base_alive = g(page, "g.baseAlive")
        check("17. 基地被砲彈擊中後摧毀", base_alive is False)
        ok = wait_state(page, "GAME_OVER", timeout=4)
        check("18. 基地摧毀後 GAME_OVER", ok)

        # 23-24. R 重新開始；不產生雙重迴圈（timeGlobal 前進速率 ~1x）
        page.keyboard.press("KeyR")
        st = g(page, "g.state")
        clean = g(page, "[g.score, g.enemies.length, g.bullets.length, g.baseAlive, g.player.lives]")
        check("23. R 重新開始", st == "WAVE_TRANSITION", f"state={st}")
        check("24a. 重開後無殘留物件", clean == [0, 0, 0, True, 3], f"{clean}")
        t0 = g(page, "g.timeGlobal")
        time.sleep(1.0)
        t1 = g(page, "g.timeGlobal")
        rate = t1 - t0
        check("24b. 單一遊戲迴圈（時間速率~1x）", 0.7 < rate < 1.35, f"rate={rate:.2f}")

        wait_state(page, "PLAYING", timeout=5)
        freeze_spawns(page)  # 後續仍是確定性測試

        # 20. 暫停：位置與時間凍結
        page.keyboard.press("KeyP")
        s1 = g(page, "[g.state, g.time, g.player.x, g.player.y]")
        time.sleep(0.5)
        s2 = g(page, "[g.state, g.time, g.player.x, g.player.y]")
        check("20a. P 暫停且全部凍結", s1[0] == "PAUSED" and s1 == s2, f"{s1} vs {s2}")
        page.keyboard.press("KeyP")
        check("20b. P 恢復", g(page, "g.state") == "PLAYING")

        # 27. 音效關閉後遊戲仍正常（audioSys 是頂層 const，用裸名存取）
        page.keyboard.press("KeyM")
        snd = page.evaluate("() => audioSys.enabled")
        time.sleep(0.3)
        check("27. 音效關閉後遊戲仍運作", snd is False and g(page, "g.state") == "PLAYING")
        page.keyboard.press("KeyM")

        # BGM：遊玩中應為播放狀態；B 鍵可單獨開關；遊戲仍運作
        bgm_on = page.evaluate("() => audioSys.musicOn")
        page.keyboard.press("KeyB")
        bgm_toggled = page.evaluate("() => audioSys.musicEnabled")
        time.sleep(0.3)
        check("BGM 遊玩中播放且 B 鍵可關閉", bgm_on is True and bgm_toggled is False
              and g(page, "g.state") == "PLAYING", f"on={bgm_on}, enabled={bgm_toggled}")
        page.keyboard.press("KeyB")

        # 9. 水面阻擋坦克但不阻擋砲彈
        page.evaluate("() => { const g = window.__game; g.player.x = 144; g.player.y = 384; g.player.dir = 3; g.player.cooldown = 0; }")
        page.keyboard.down("KeyA"); time.sleep(0.6); page.keyboard.up("KeyA")
        px = g(page, "g.player.x")
        check("9a. 水面阻擋坦克", 114 <= px <= 118, f"x={px}")
        water_before = g(page, "g.map.grid.flat().filter(c => c.type === 3).length")
        fire(page)
        time.sleep(0.1)
        over_water = g(page, "g.bullets.some(b => b.owner === 'player' && b.x < 96)")
        time.sleep(0.3)
        water_after = g(page, "g.map.grid.flat().filter(c => c.type === 3).length")
        check("9b. 砲彈飛越水面且水面不受損", over_water and water_before == water_after,
              f"over={over_water}, water {water_before}->{water_after}")

        # 10. 草叢遮擋坦克（像素檢查：草簇蓋在坦克上、縫隙露出坦克）
        page.evaluate("""() => {
            const g = window.__game;
            g.player.x = 204; g.player.y = 324; g.player.invincible = 0;
            g.particles.reset();
        }""")
        time.sleep(0.15)
        px_data = page.evaluate("""() => {
            const ctx = document.getElementById('game').getContext('2d');
            const tuft = ctx.getImageData(194, 320, 1, 1).data;
            const gap = ctx.getImageData(194, 314, 1, 1).data;
            return { tuft: [tuft[0], tuft[1], tuft[2]], gap: [gap[0], gap[1], gap[2]] };
        }""")
        tuft_green = px_data["tuft"][1] > px_data["tuft"][0] and px_data["tuft"][1] > 60
        gap_not_green = not (px_data["gap"][1] > px_data["gap"][0] and abs(px_data["gap"][1] - 92) < 25)
        check("10. 草叢繪於坦克上方且部分遮擋", tuft_green and gap_not_green, f"{px_data}")

        # 11-13. 敵人生成 / 移動 / 射擊（自然運行觀察 14 秒）
        # 恢復生成；觀察期間保護基地（暫時停用摧毀）與玩家（無敵）避免干擾後續測試
        page.evaluate("""() => {
            const g = window.__game;
            g.player.x = 360; g.player.y = 696; g.player.dir = 0;
            g.player.invincible = 9999;
            g.__origDestroyBase = g._destroyBase;
            g._destroyBase = () => {};
            g.spawnTimer = 0;
        }""")
        seen_enemy_bullet = False
        max_enemy_y = 0
        enemy_seen = 0
        for _ in range(28):
            time.sleep(0.5)
            snap = g(page, "[g.enemies.length, Math.max(0, ...g.enemies.map(e => e.y)), g.bullets.some(b => b.owner === 'enemy')]")
            enemy_seen = max(enemy_seen, snap[0])
            max_enemy_y = max(max_enemy_y, snap[1])
            seen_enemy_bullet = seen_enemy_bullet or snap[2]
        check("11. 敵人可以生成", enemy_seen > 0, f"max seen={enemy_seen}")
        check("12. 敵人不會全卡在出生點", max_enemy_y > 150, f"max y={max_enemy_y}")
        check("13. 敵人可以射擊", seen_enemy_bullet)

        # 15. 玩家可摧毀敵人（用 API 放一台普通敵人在玩家正上方開闊處直接射擊）
        page.evaluate("""() => {
            const g = window.__game;
            g._destroyBase = g.__origDestroyBase;   // 恢復基地摧毀
            g.player.invincible = 0;
            g.enemies.forEach(e => e.alive = false);
            g.spawnTimer = 99999;
            if (g.spawnList.length === 0) g.spawnList.push('normal');
            g.spawnWarns = [];
            g.enemies.push(new Enemy('normal', 168, 216));
            g.player.x = 168; g.player.y = 400; g.player.dir = 0; g.player.cooldown = 0;
            g.bullets.forEach(b => b.kill());
        }""")
        score_before = g(page, "g.score")
        fire(page)
        time.sleep(0.8)
        killed = g(page, "g.enemies.filter(e => e.alive && e.type === 'normal').length === 0")
        score_after = g(page, "g.score")
        check("15. 玩家可摧毀敵人並得分", killed and score_after == score_before + 100,
              f"score {score_before}->{score_after}")

        # 16. 重裝型需多次命中
        hits = page.evaluate("""() => {
            const g = window.__game;
            const h = new Enemy('heavy', 480, 216);
            g.enemies.push(h);
            const seq = [];
            for (let i = 0; i < 4; i++) seq.push([h.takeHit(g), h.hp, h.alive]);
            g.enemies.forEach(e => e.alive = false);
            return seq;
        }""")
        check("16. 重裝敵人需 4 次命中", [h[0] for h in hits] == [False, False, False, True], f"{hits}")

        # 砲彈互相抵消
        cancel = page.evaluate("""() => {
            const g = window.__game;
            g.bullets.forEach(b => b.kill());
            g.bullets.push(new Bullet(480, 300, 2, 300, 'enemy', null));
            g.bullets.push(new Bullet(480, 340, 0, 300, 'player', null));
            return g.bullets.length;
        }""")
        time.sleep(0.4)
        remaining = g(page, "g.bullets.filter(b => !b.dead).length")
        check("玩家與敵方砲彈互相抵消", remaining == 0, f"remaining={remaining}")

        # 14. 敵人可傷害玩家 + 重生無敵 + 不重複扣血
        page.evaluate("""() => {
            const g = window.__game;
            g.player.lives = 3;  // 觀察期可能被扣過，重設以便斷言
            g.player.invincible = 0;
            g.bullets.push(new Bullet(g.player.x, g.player.y - 60, 2, 400, 'enemy', null));
            g.bullets.push(new Bullet(g.player.x, g.player.y + 60, 0, 400, 'enemy', null));
        }""")
        time.sleep(0.4)
        lives_after = g(page, "[g.player.lives, g.state]")
        check("14. 敵人砲彈傷害玩家（單次扣血）", lives_after[0] == 2 and lives_after[1] == "PLAYER_RESPAWNING",
              f"{lives_after}")
        time.sleep(1.4)
        resp = g(page, "[g.state, g.player.alive, g.player.invincible > 0]")
        check("重生後短暫無敵", resp[0] == "PLAYING" and resp[1] and resp[2], f"{resp}")

        # 19. 生命歸零 → GAME_OVER
        page.evaluate("""() => {
            const g = window.__game;
            g.player.lives = 1; g.player.invincible = 0;
            g.bullets.push(new Bullet(g.player.x, g.player.y - 60, 2, 400, 'enemy', null));
        }""")
        ok = wait_state(page, "GAME_OVER", timeout=4)
        check("19. 生命歸零後 GAME_OVER", ok, f"state={g(page, 'g.state')}")
        time.sleep(0.2)
        check("BGM 於 GAME_OVER 停止", page.evaluate("() => audioSys.musicOn") is False)

        # 21-22. 波次切換 + 第 5 波完成 → VICTORY
        page.keyboard.press("KeyR")
        wait_state(page, "PLAYING", timeout=5)
        page.evaluate("""() => {
            const g = window.__game;
            g.spawnList = []; g.spawnWarns = [];
            g.enemies.forEach(e => e.alive = false);
        }""")
        time.sleep(0.3)
        st = g(page, "[g.state, g.waveIndex]")
        check("21b. 清除波次後進入下一波提示", st[0] == "WAVE_TRANSITION" and st[1] == 1, f"{st}")
        page.evaluate("""() => {
            const g = window.__game;
            g.transitionTimer = 0.1;
        }""")
        time.sleep(0.5)
        page.evaluate("""() => {
            const g = window.__game;
            g.waveIndex = 4;
            g.spawnList = []; g.spawnWarns = [];
            g.enemies.forEach(e => e.alive = false);
        }""")
        ok = wait_state(page, "VICTORY", timeout=4)
        check("22. 第 5 波完成後 VICTORY", ok, f"state={g(page, 'g.state')}")

        # 28. 物件數量有界（無明顯累積）
        counts = g(page, "[g.bullets.length, g.particles.particles.length, g.enemies.length, g.floatTexts.length]")
        check("28. 物件陣列有界", counts[0] < 40 and counts[1] <= 400 and counts[2] < 12 and counts[3] < 20,
              f"{counts}")

        # 25. Console 無錯誤
        check("25. Console 無錯誤", len(errors) == 0, f"errors={errors[:5]}")

        browser.close()

    print()
    failed = [r for r in results if not r[1]]
    print(f"=== {len(results) - len(failed)}/{len(results)} PASSED ===")
    for name, _, detail in failed:
        print(f"FAILED: {name} -- {detail}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
