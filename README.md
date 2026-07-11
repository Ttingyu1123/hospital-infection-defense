# 防疫大作戰（工作名）

尚未開始改造的專案骨架。Fork 自本地 `d:\VibeCoding\Game-tank`（IRON VANGUARD 坦克保衛戰，線上版 <https://game-tank.tingyudeco.com/>），目前程式碼與坦克版完全相同，等待依「防疫大作戰」規格 retheme。

技術底座：純 HTML5 Canvas + 原生 JavaScript，無框架、無遊戲引擎、無外部資源檔、無 CDN，可完全離線執行。邏輯解析度固定 960x720，CSS 等比縮放。

## 給接手 session 的架構地圖

```
index.html          頁面骨架（標題、Canvas、操作說明）
style.css           外框樣式；Canvas 以 CSS 等比縮放
js/
  constants.js      全部常數：尺寸、速度、波次、敵人數值、狀態列舉 ← retheme 主戰場
  audio.js          Web Audio 即時合成音效 + chiptune 背景音樂
  particles.js      粒子系統（上限 400）與畫面震動
  map.js            40x30 網格地圖：磚牆/鋼牆/水面/草叢/空地 ← 地形語意待換
  bullet.js         投射物狀態與繪製
  tank.js           移動單位基底：四向移動、AABB 碰撞、走道吸附、發射、繪製 ← 外觀待換
  player.js         玩家：輸入、生命、重生無敵
  enemy.js          敵人 AI：方向權重決策、視線射擊、射磚開路、卡住偵測
  game.js           狀態機、波次管理、碰撞掃掠、計分、HUD、各狀態畫面 ← 文案/勝負條件
  main.js           進入點：輸入監聽、單一 rAF 迴圈
test/
  e2e_test.py       Playwright 驗收測試（原 41 項，retheme 後需同步改寫斷言）
  soak_test.py      60 秒自動遊玩穩定性測試
  screenshot.py     視覺檢查截圖 + FPS 量測
```

## 沿用的工程慣例（來自母專案，建議保留）

- 碰撞用邏輯座標，畫面震動只影響渲染位移
- 砲彈子步掃掠碰撞防止高速穿牆；每彈僅一次傷害
- 音訊初始化失敗不中斷遊戲
- 重新開始零殘留（無重複 rAF、無舊計時器）
- 驗收方式：`python -m http.server 8777` 後跑 `test/e2e_test.py` 與 `test/soak_test.py`

## 待辦

- [ ] 依防疫規格改寫 constants / 繪製 / 文案 / 勝負條件
- [ ] 同步改寫 e2e 測試斷言
- [ ] 重寫本 README
- [ ] 部署（GitHub repo + Pages；母專案的 CNAME 已刻意不帶過來）
