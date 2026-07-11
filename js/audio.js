'use strict';
/* Web Audio 即時合成音效與背景音樂。首次使用者互動後才建立 AudioContext；
   初始化失敗絕不拋出、不影響遊戲流程。 */

/* 背景音樂音序（A 小調，130 BPM，8 分音符 x 32 步循環）
   數字為 MIDI 音高，null 為休止。 */
const BGM = Object.freeze({
  bpm: 130,
  steps: 32,
  bass: Object.freeze([
    45, null, 45, null, 45, null, 52, null,
    41, null, 41, null, 48, null, 41, null,
    43, null, 43, null, 50, null, 43, null,
    45, null, 45, null, 52, null, 45, null,
  ]),
  melody: Object.freeze([
    69, null, 72, 74, 76, null, 74, 72,
    69, null, 65, null, 69, 72, 69, null,
    67, null, 71, 74, 79, null, 74, 71,
    76, 74, 72, 74, 69, null, null, null,
  ]),
});

function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.noiseBuf = null;
    this.failed = false;
    // 背景音樂
    this.musicGain = null;
    this.musicEnabled = true;
    this.musicOn = false;      // 目前是否應播放（跟隨遊戲狀態）
    this.musicTimer = null;    // lookahead 排程器
    this.musicStep = 0;
    this.musicNextTime = 0;
  }

  /* 在使用者手勢（keydown/click）時呼叫 */
  ensure() {
    if (this.failed) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.failed = true; return; }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.25;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.4; // BGM 比音效低
        this.musicGain.connect(this.master);
        // 預先產生 1 秒白噪音 buffer 供爆炸等音效使用
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (e) {
      this.failed = true;
      this.ctx = null;
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    return this.musicEnabled;
  }

  /* ---------- 背景音樂：lookahead 音序器 ---------- */

  /* 由遊戲每幀呼叫，冪等：want=true 開始循環、false 停止 */
  setMusic(want) {
    if (want && !this.musicOn) {
      this.musicOn = true;
      this.musicStep = 0;
      this.musicNextTime = this.ctx ? this.ctx.currentTime + 0.08 : 0;
      if (!this.musicTimer) {
        this.musicTimer = setInterval(() => this._scheduleMusic(), 100);
      }
    } else if (!want && this.musicOn) {
      this.musicOn = false;
    }
  }

  _scheduleMusic() {
    if (!this.musicOn || !this.musicEnabled || !this._ready()) return;
    const now = this.ctx.currentTime;
    // 靜音/暫停後恢復：排程時間落後就重新對齊，避免補播堆積的音符
    if (this.musicNextTime < now - 0.1) this.musicNextTime = now + 0.05;
    const stepDur = 60 / BGM.bpm / 2; // 8 分音符
    while (this.musicNextTime < now + 0.25) {
      const t = this.musicNextTime;
      const s = this.musicStep % BGM.steps;
      const bass = BGM.bass[s];
      const mel = BGM.melody[s];
      if (bass !== null) this._musicNote(midiToFreq(bass), t, stepDur * 0.9, 'square', 0.22);
      if (mel !== null) this._musicNote(midiToFreq(mel), t, stepDur * 0.85, 'triangle', 0.3);
      if (s % 4 === 0) this._musicTick(t, s % 8 === 4 ? 0.09 : 0.05);
      this.musicStep++;
      this.musicNextTime += stepDur;
    }
  }

  _musicNote(freq, t, dur, type, vol) {
    if (!this.musicGain) return;
    try {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  /* 節奏打點（短噪音） */
  _musicTick(t, vol) {
    if (!this.musicGain || !this.noiseBuf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 5000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      src.connect(filter); filter.connect(g); g.connect(this.musicGain);
      src.start(t); src.stop(t + 0.06);
    } catch (e) { /* ignore */ }
  }

  _ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  /* 頻率滑移的簡單音 */
  _beep(f0, f1, dur, type, vol, delay) {
    if (!this._ready()) return;
    try {
      const t = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) { /* 音效失敗不影響遊戲 */ }
  }

  /* 濾波噪音 */
  _noise(dur, vol, cutoff, delay) {
    if (!this._ready() || !this.noiseBuf) return;
    try {
      const t = this.ctx.currentTime + (delay || 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter); filter.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  playerShoot()  { this._beep(900, 300, 0.07, 'square', 0.5); }
  enemyShoot()   { this._beep(480, 180, 0.08, 'sawtooth', 0.3); }
  hitWall()      { this._noise(0.05, 0.35, 1400); }
  brickBreak()   { this._noise(0.14, 0.5, 900); this._beep(220, 90, 0.1, 'triangle', 0.3); }
  bulletCancel() { this._beep(1200, 500, 0.05, 'square', 0.25); }
  tankExplode()  { this._noise(0.4, 0.7, 500); this._beep(130, 30, 0.4, 'sine', 0.7); }
  baseExplode()  { this._noise(0.9, 0.9, 350); this._beep(90, 22, 0.9, 'sine', 0.9); this._noise(0.6, 0.6, 200, 0.15); }
  playerHit()    { this._beep(300, 60, 0.3, 'sawtooth', 0.5); }
  waveStart()    { this._beep(440, 440, 0.12, 'square', 0.4); this._beep(660, 660, 0.14, 'square', 0.4, 0.16); }
  victory()      { [523, 659, 784, 1047].forEach((f, i) => this._beep(f, f, 0.18, 'square', 0.4, i * 0.18)); }
  gameOver()     { [392, 311, 233, 155].forEach((f, i) => this._beep(f, f * 0.9, 0.3, 'triangle', 0.4, i * 0.25)); }
}

const audioSys = new AudioSys();
