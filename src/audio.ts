// Sound for the Keep, all through the Web Audio API and all same-origin. Every
// effect is still synthesized — footsteps, the orb's teleport, the portal dive —
// so there is nothing to download for them. The one exception is the music:
//   • the museum score (mx_museum.ogg), looped under everything once the game runs,
//     with the old synthesized drone kept as a fallback (see startAmbient). Each
//     track carries its credit (see `Track`) and announces itself through
//     `onTrackStart` when it really starts playing;
//   • stone footsteps, triggered by distance travelled while walking.

import museumUrl from './assets/audio/mx_museum.ogg?url';

/** A music file plus the credit shown when it starts playing. */
export interface Track {
  url: string;
  title: string;
  artist: string;
}

/**
 * The score. Keep the credit next to the file: anything that plays music goes
 * through a `Track`, so a new track can never reach the speakers uncredited.
 */
const MUSEUM_TRACK: Track = {
  url: museumUrl,
  title: 'Museum of The Roguelike',
  artist: 'QuietGecko',
};

const STRIDE = 2.15; // world units between footfalls (cadence scales with speed)
/**
 * Playback gain for the score. The file is mastered hot — it peaks a hair over
 * 0 dBFS and sits at 0.176 RMS — so this lands it near 0.03 RMS: a bed, not a
 * feature. It has to leave room for the footsteps, whose useful energy lands in the
 * same 400–2000 Hz window the music fills; at 0.28 the two were at parity through
 * a laptop speaker during musical swells, and the steps disappeared.
 * This and the step `peak` below are the two knobs for that balance.
 */
const MUSIC_GAIN = 0.18;
const MUSIC_FADE = 1.5; // seconds to ease in, so it doesn't slam in on the click

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambientStarted = false;
  private muted = false;
  private stepDist = 0; // accumulated distance since the last footfall

  /**
   * Fired when a track actually begins playing — not when it is requested, since
   * the file may still fail to fetch or decode. Wired by main to the HUD toast.
   */
  onTrackStart?: (track: Track) => void;

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

  /**
   * Kick off the looping ambient bed (idempotent): the museum score, or the
   * synthesized drone if that can't be played.
   */
  startAmbient() {
    if (this.ambientStarted || !this.ctx || !this.master) return;
    this.ambientStarted = true; // claimed before the await, so a second call can't race in
    const ctx = this.ctx;

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.setValueAtTime(0, ctx.currentTime);
    this.ambientGain.connect(this.master);
    void this.startMusic();
  }

  /**
   * Fetch, decode and loop the score. Nothing is downloaded until this runs — it is
   * called from a user gesture (the context can't start before one anyway), so the
   * 874 KB never touches the boot path.
   *
   * On any failure it falls back to the drone this used to be. That is not
   * hypothetical: Ogg Vorbis is not decodable in every browser (Safari only gained
   * it recently), and a silent Keep is worse than a humming one.
   */
  private async startMusic(track: Track = MUSEUM_TRACK) {
    const ctx = this.ctx!;
    const gain = this.ambientGain!;
    let buffer: AudioBuffer;
    try {
      const res = await fetch(track.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) {
      console.warn('[audio] could not play the score; using the synth drone instead:', err);
      this.startSynthBed();
      return;
    }
    const music = ctx.createBufferSource();
    music.buffer = buffer;
    music.loop = true; // the file runs edge to edge with no silence to trim
    music.connect(gain);
    music.start();

    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(MUSIC_GAIN, now + MUSIC_FADE);

    this.onTrackStart?.(track);
  }

  /** The original all-synth bed: a breathing stone drone plus an airy draft. */
  private startSynthBed() {
    if (!this.ctx || !this.ambientGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(0, now);
    this.ambientGain.gain.linearRampToValueAtTime(0.08, now + 3); // fade in

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
   * `sprinting` lifts the step slightly, though both are deliberately muffled.
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

  /** Winning an artifact — a bell fifth blooming out of a bright shimmer. */
  artifact() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.master);

    // An arpeggio climbing a major triad, then the octave — the whole point is
    // that it resolves upward, unlike `stumble()` below.
    for (const [freq, delay] of [[523, 0], [659, 0.09], [784, 0.18], [1047, 0.3]] as const) {
      for (const [mul, gain] of [[1, 0.26], [2, 0.09]] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * mul;   // a touch of second harmonic reads as a bell
        const g = ctx.createGain();
        const t = now + delay;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0004, t + 1.4);
        osc.connect(g);
        g.connect(bus);
        osc.start(t);
        osc.stop(t + 1.5);
      }
    }

    // Bright dust rising under the arpeggio.
    if (this.noiseBuffer) {
      const shimmer = ctx.createBufferSource();
      shimmer.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 4;
      bp.frequency.setValueAtTime(1800, now);
      bp.frequency.exponentialRampToValueAtTime(7000, now + 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.14, now + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0004, now + 0.9);
      shimmer.connect(bp);
      bp.connect(g);
      g.connect(bus);
      shimmer.start(now);
      shimmer.stop(now + 0.95);
    }
  }

  /** Falling out of a trial — a dull impact and a short sinking rewind. */
  stumble() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.master);

    // The landing: a low thud with all the top rolled off it.
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(160, now);
    thud.frequency.exponentialRampToValueAtTime(48, now + 0.22);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now);
    tg.gain.exponentialRampToValueAtTime(0.4, now + 0.012);
    tg.gain.exponentialRampToValueAtTime(0.0005, now + 0.4);
    thud.connect(tg);
    tg.connect(bus);
    thud.start(now);
    thud.stop(now + 0.45);

    if (this.noiseBuffer) {
      const dust = ctx.createBufferSource();
      dust.buffer = this.noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1400, now);
      lp.frequency.exponentialRampToValueAtTime(240, now + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, now + 0.35);
      dust.connect(lp);
      lp.connect(g);
      g.connect(bus);
      dust.start(now);
      dust.stop(now + 0.4);
    }

    // …and the rewind: a falling fifth, the arpeggio in `artifact()` run backwards.
    for (const [freq, delay] of [[494, 0.12], [392, 0.2]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t = now + delay;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.45);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + 0.5);
    }
  }

  private playStep(sprinting: boolean) {
    const ctx = this.ctx!;
    if (!this.noiseBuffer || !this.master) return;
    const now = ctx.currentTime;

    // Slight per-step variation so it doesn't sound like a metronome.
    const vary = 0.85 + (Math.sin(now * 977.3) * 0.5 + 0.5) * 0.3;

    // Body of the step: a soft filtered puff — a foot settling onto stone rather
    // than a heel cracking against it. What makes it soft is the *envelope* and the
    // missing top: the attack is slow enough (~18 ms) that there is no
    // instantaneous edge — the old 4 ms ramp was itself audible as a click,
    // whatever the filtering — and the lowpass keeps the 2–5 kHz region the ear
    // hears as "crack" out of it. A bandpass alone won't: its skirts are gentle
    // enough to pass plenty, which is what made this brittle to begin with.
    //
    // What softness must NOT mean is moving everything below ~200 Hz. An earlier
    // pass put the band at 460 Hz under a 1100 Hz cap and left this step 37 dB
    // down at 900 Hz–2 kHz, so the sub-bass thud was the whole sound — inaudible on
    // laptop speakers, which roll off under ~150 Hz. The band lives up here now, in
    // the range a small driver can actually reproduce, and stays under the cap.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (sprinting ? 950 : 800) * vary;
    bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = sprinting ? 2100 : 1800;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    const peak = (sprinting ? 0.54 : 0.46) * vary;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + (sprinting ? 0.012 : 0.018));
    g.gain.exponentialRampToValueAtTime(0.0008, now + 0.22); // longer, softer tail
    src.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(now);
    src.stop(now + 0.26);

    // Low thud, for weight only — it is deliberately the quieter half, since it is
    // also the half most speakers cannot deliver. It fades in over a few
    // milliseconds: a sine that starts at full gain clicks as plainly as a bright
    // filter does.
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(132 * vary, now);
    thud.frequency.exponentialRampToValueAtTime(62, now + 0.1);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, now);
    tg.gain.linearRampToValueAtTime(0.22 * vary, now + 0.008);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    thud.connect(tg);
    tg.connect(this.master);
    thud.start(now);
    thud.stop(now + 0.15);
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
