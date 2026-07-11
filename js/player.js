'use strict';
/* 玩家坦克：鍵盤輸入、生命、重生無敵（閃爍 + 護盾圈）。 */

class Player extends Tank {
  constructor() {
    const P = CONST.PLAYER;
    super(P.spawnX, P.spawnY, CONST.TANK_SIZE, P.speed);
    this.maxBullets = P.maxBullets;
    this.lives = P.lives;
    this.invincible = P.invincibleTime; // 開場也給短暫無敵
    this.dir = DIR.UP;
  }

  respawn() {
    const P = CONST.PLAYER;
    this.x = P.spawnX;
    this.y = P.spawnY;
    this.dir = DIR.UP;
    this.alive = true;
    this.cooldown = 0;
    this.invincible = P.invincibleTime;
  }

  update(dt, game, input) {
    this.updateTimers(dt);
    if (this.invincible > 0) this.invincible -= dt;

    const dir = input.currentDir();
    if (dir !== null) {
      this.setDir(dir, game);
      this.move(dt, game);
    }

    if (input.isDown('Space') && this.canShoot()) {
      this.shoot(game, 'player', CONST.PLAYER.bulletSpeed);
      this.cooldown = CONST.PLAYER.cooldown;
      audioSys.playerShoot();
    }
  }

  draw(ctx, time) {
    if (!this.alive) return;
    // 無敵期間閃爍（每 0.1s 半透明一次）
    const blink = this.invincible > 0 && Math.floor(time * 10) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.55;
    this.drawBody(ctx, '#f0c040', '#9c7a1c');
    ctx.globalAlpha = 1;
    // 護盾圈
    if (this.invincible > 0) {
      ctx.strokeStyle = `rgba(120, 220, 255, ${0.4 + 0.3 * Math.sin(time * 12)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.half + 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
