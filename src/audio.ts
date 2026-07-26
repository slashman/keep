// Procedural sound for the Keep — no asset files, all synthesized with the
// Web Audio API so it stays same-origin and zero-download. Two voices:
//   • a low, breathing dungeon drone (ambient), started once the game runs;
//   • stone footsteps, triggered by distance travelled while walking.

const STRIDE = 2.15; // world units between footfalls (cadence scales with speed)

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientStarted = false;
  private muted = false;
  private stepDist = 0; // accumulated distance since the last footfall

  /** Create/resume the context. Safe to call from any user-gesture handler. */
  resume() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoise(2.5);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  get isMuted() { return this.muted; }

  /** Kick off the looping ambient bed (idempotent). */
  startAmbient() {
    if (this.ambientStarted || !this.ctx || !this.master) return;
    this.ambientStarted = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0, now);
    this.ambientGain.gain.linearRampToValueAtTime(0.08, now + 3); // fade in
    this.ambientGain.connect(this.master);

    // A softly detuned low drone through a dark low-pass — the stone hum.
    const drone = ctx.createGain();
    drone.gain.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.7;
    lp.connect(this.ambientGain);
    drone.connect(lp);
    for (const [freq, detune] of [[55, -4], [82.4, 5], [110, 9]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(drone);
      osc.start(now);
    }
    // Slow filter sweep so the drone breathes instead of sitting flat.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start(now);

    // Airy noise "draft" — filtered pink-ish noise, gently undulating.
    if (this.noiseBuffer) {
      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuffer;
      wind.loop = true;
      const windLp = ctx.createBiquadFilter();
      windLp.type = 'lowpass';
      windLp.frequency.value = 300;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.06;
      wind.connect(windLp);
      windLp.connect(windGain);
      windGain.connect(this.ambientGain);
      wind.start(now);

      const windLfo = ctx.createOscillator();
      windLfo.frequency.value = 0.08;
      const windLfoGain = ctx.createGain();
      windLfoGain.gain.value = 0.04;
      windLfo.connect(windLfoGain);
      windLfoGain.connect(windGain.gain);
      windLfo.start(now);
    }
  }

  /**
   * Feed the frame's travelled distance; emits a footstep each stride.
   * `sprinting` brightens/hardens the step a touch.
   */
  footsteps(distance: number, sprinting: boolean) {
    if (!this.ctx || distance <= 0) return;
    this.stepDist += distance;
    const stride = sprinting ? STRIDE * 0.85 : STRIDE;
    if (this.stepDist >= stride) {
      this.stepDist = 0;
      this.playStep(sprinting);
    }
  }

  /** Reset cadence — call after teleporting between floors. */
  resetSteps() { this.stepDist = 0; }

  /** Magical orb teleport — a rising shimmer that blooms into a soft whoosh. */
  teleport() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.master);

    // Rising sparkle: two detuned saws swept upward through a resonant filter.
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'bandpass';
    sweep.Q.value = 6;
    sweep.frequency.setValueAtTime(300, now);
    sweep.frequency.exponentialRampToValueAtTime(3200, now + 0.55);
    const sweepGain = ctx.createGain();
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.32, now + 0.08);
    sweepGain.gain.exponentialRampToValueAtTime(0.0006, now + 0.9);
    sweep.connect(sweepGain);
    sweepGain.connect(bus);
    for (const detune of [-6, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.55);
      osc.detune.value = detune;
      osc.connect(sweep);
      osc.start(now);
      osc.stop(now + 0.95);
    }

    // Airy whoosh underneath: swept noise for body.
    if (this.noiseBuffer) {
      const whoosh = ctx.createBufferSource();
      whoosh.buffer = this.noiseBuffer;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass';
      wf.Q.value = 1.2;
      wf.frequency.setValueAtTime(500, now);
      wf.frequency.exponentialRampToValueAtTime(4000, now + 0.4);
      wf.frequency.exponentialRampToValueAtTime(600, now + 0.85);
      const wg = ctx.createGain();
      wg.gain.setValueAtTime(0.0001, now);
      wg.gain.exponentialRampToValueAtTime(0.22, now + 0.12);
      wg.gain.exponentialRampToValueAtTime(0.0005, now + 0.85);
      whoosh.connect(wf);
      wf.connect(wg);
      wg.connect(bus);
      whoosh.start(now);
      whoosh.stop(now + 0.9);
    }

    // Bright chime "ping" at the arrival, a fifth apart.
    for (const [freq, delay] of [[784, 0.0], [1175, 0.06]] as const) {
      const ping = ctx.createOscillator();
      ping.type = 'sine';
      ping.frequency.value = freq;
      const pg = ctx.createGain();
      const t = now + 0.42 + delay;
      pg.gain.setValueAtTime(0.0001, t);
      pg.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      pg.gain.exponentialRampToValueAtTime(0.0004, t + 0.6);
      ping.connect(pg);
      pg.connect(bus);
      ping.start(t);
      ping.stop(t + 0.65);
    }
  }

  /** Diving through a painting: a wet plunge that swallows you, then a shimmer. */
  portal() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.master);

    // The surface breaking: a noise burst swept downward, like going under water.
    if (this.noiseBuffer) {
      const splash = ctx.createBufferSource();
      splash.buffer = this.noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(5200, now);
      lp.frequency.exponentialRampToValueAtTime(320, now + 0.65);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.42, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 0.8);
      splash.connect(lp);
      lp.connect(g);
      g.connect(bus);
      splash.start(now);
      splash.stop(now + 0.85);
    }

    // A pitch-dropping "gulp" underneath — the moment of being pulled in.
    const gulp = ctx.createOscillator();
    gulp.type = 'sine';
    gulp.frequency.setValueAtTime(420, now);
    gulp.frequency.exponentialRampToValueAtTime(58, now + 0.5);
    const gg = ctx.createGain();
    gg.gain.setValueAtTime(0.0001, now);
    gg.gain.exponentialRampToValueAtTime(0.34, now + 0.04);
    gg.gain.exponentialRampToValueAtTime(0.0005, now + 0.6);
    gulp.connect(gg);
    gg.connect(bus);
    gulp.start(now);
    gulp.stop(now + 0.65);

    // Bell-like droplets ringing out on the far side.
    for (const [freq, delay] of [[988, 0.34], [1319, 0.42], [1568, 0.52]] as const) {
      const d = ctx.createOscillator();
      d.type = 'sine';
      d.frequency.value = freq;
      const dg = ctx.createGain();
      const t = now + delay;
      dg.gain.setValueAtTime(0.0001, t);
      dg.gain.exponentialRampToValueAtTime(0.2, t + 0.012);
      dg.gain.exponentialRampToValueAtTime(0.0004, t + 0.7);
      d.connect(dg);
      dg.connect(bus);
      d.start(t);
      d.stop(t + 0.75);
    }
  }

  private playStep(sprinting: boolean) {
    const ctx = this.ctx!;
    if (!this.noiseBuffer || !this.master) return;
    const now = ctx.currentTime;

    // Slight per-step variation so it doesn't sound like a metronome.
    const vary = 0.85 + (Math.sin(now * 977.3) * 0.5 + 0.5) * 0.3;

    // Body of the step: a short filtered noise burst (foot scuffing stone).
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (sprinting ? 1500 : 1150) * vary;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const peak = (sprinting ? 0.5 : 0.38) * vary;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.13);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + 0.16);

    // Low thud so the footfall has weight.
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(150 * vary, now);
    thud.frequency.exponentialRampToValueAtTime(70, now + 0.09);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.28 * vary, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    thud.connect(tg);
    tg.connect(this.master);
    thud.start(now);
    thud.stop(now + 0.12);
  }

  /** A couple of seconds of stereo white noise, reused for wind and steps. */
  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // cheap low-pass → softer than white
      data[i] = last * 3.5;
    }
    return buf;
  }
}
