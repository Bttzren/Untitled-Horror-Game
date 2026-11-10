import { CONFIG, MEMORY_KINDS } from '../rules/config';
import type { GameEvent, ViewState } from '../rules/types';
import { dist, type Vec2 } from '../shared/vec';

/** How loud a sound is at a distance: full at the source, silent at one and a half times its radius. */
export function gainAt(distance: number, radius: number): number {
  const reach = radius * 1.5;
  if (reach <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - distance / reach));
}

/** Stereo position of a source for a listener facing `yaw`: -1 hard left, +1 hard right. */
export function panFor(listener: Vec2, yaw: number, source: Vec2): number {
  const dx = source.x - listener.x, dz = source.z - listener.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  // The listener's right-hand direction is (cos yaw, -sin yaw).
  return (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d;
}

/** A continuous sound attached to something in the world. */
interface Voice { gain: GainNode; pan: StereoPannerNode; stop(): void; radius: number }

const N = CONFIG.noise;

/**
 * All sound, synthesised with the Web Audio API: no audio files. Everything
 * here is cosmetic; where audio is unavailable the game plays on in silence.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { gain: GainNode; osc: OscillatorNode[] } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly voices = new Map<string, Voice>();
  private ear: Vec2 = { x: 0, z: 0 };
  private yaw = 0;
  private usherAt = new Map<number, Vec2>();
  private lastClick = 0;
  private phase2 = false;

  /** Must be called from a click or key press: browsers only allow sound after one. */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate;
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startHum();
    } catch {
      this.ctx = null; // no audio on this device
    }
  }

  /** The fluorescent-light hum of the dream. */
  private startHum(): void {
    const ctx = this.ctx!, gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const osc = [60, 120.4, 179.3].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.12, 0.05][i]!;
      o.connect(g).connect(filter);
      o.start();
      return o;
    });
    filter.connect(gain).connect(this.master!);
    this.hum = { gain, osc };
  }

  setListener(pos: Vec2, yaw: number): void {
    this.ear = pos;
    this.yaw = yaw;
  }

  setPhase2(on: boolean): void {
    if (!this.ctx || !this.hum || on === this.phase2) return;
    this.phase2 = on;
    const t = this.ctx.currentTime;
    // The hum sags and goes out of tune as the dream comes apart.
    this.hum.osc.forEach((o, i) => o.detune.linearRampToValueAtTime(on ? -180 - i * 70 : 0, t + 4));
  }

  /** A short one-off sound somewhere in the world. */
  private blip(at: Vec2 | null, radius: number, build: (ctx: AudioContext, out: AudioNode, t: number) => number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const level = at ? gainAt(dist(at, this.ear), radius) : 1;
    if (level <= 0.01) return;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const pan = ctx.createStereoPanner();
    pan.pan.value = at ? panFor(this.ear, this.yaw, at) * 0.8 : 0;
    gain.connect(pan).connect(this.master);
    const seconds = build(ctx, gain, ctx.currentTime);
    setTimeout(() => { gain.disconnect(); pan.disconnect(); }, seconds * 1000 + 200);
  }

  private thud(at: Vec2, radius: number, pitch: number, length: number, level: number): void {
    this.blip(at, radius, (ctx, out, t) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = pitch;
      const g = ctx.createGain();
      g.gain.setValueAtTime(level, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + length);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random() * 0.5, length + 0.05);
      return length;
    });
  }

  private tone(at: Vec2 | null, radius: number, notes: [freq: number, start: number, length: number][], type: OscillatorType, level: number): void {
    this.blip(at, radius, (ctx, out, t) => {
      let end = 0;
      for (const [freq, start, length] of notes) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + start);
        g.gain.exponentialRampToValueAtTime(level, t + start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + start + length);
        o.connect(g).connect(out);
        o.start(t + start);
        o.stop(t + start + length + 0.05);
        end = Math.max(end, start + length);
      }
      return end;
    });
  }

  onEvent(ev: GameEvent): void {
    if (!this.ctx) return;
    switch (ev.type) {
      case 'noise':
        // The kind of noise is told apart by how far it carries.
        if (ev.radius === N.crouch) this.thud(ev.pos, 3, 300, 0.07, 0.25);
        else if (ev.radius === N.walk) this.thud(ev.pos, 8, 520, 0.09, 0.6);
        else if (ev.radius === N.sprint) this.thud(ev.pos, 14, 800, 0.1, 0.9);
        else if (ev.radius === N.drop) this.thud(ev.pos, 12, 1400, 0.22, 0.9);
        else if (ev.radius === N.dropHeavy) this.thud(ev.pos, 18, 300, 0.5, 1);
        // N.noisyMemory is a ringing memory: update() keeps its continuous voice going.
        break;
      case 'banked': this.tone(null, 1, [[660, 0, 0.25], [990, 0.12, 0.4]], 'sine', 0.25); break;
      case 'doorOpen': this.tone(null, 1, [[330, 0, 1.2], [415, 0.15, 1.2], [495, 0.3, 1.4], [660, 0.45, 1.6]], 'sine', 0.2); break;
      case 'phase2': this.tone(null, 1, [[55, 0, 2.5], [58, 0, 2.5]], 'sawtooth', 0.35); break;
      case 'caught': this.tone(null, 1, [[220, 0, 0.5], [147, 0.1, 0.7], [104, 0.25, 1.2]], 'sawtooth', 0.3); break;
      case 'left': this.tone(null, 1, [[495, 0, 0.3], [330, 0.15, 0.5]], 'sine', 0.2); break;
    }
  }

  private voice(key: string, radius: number, make: (ctx: AudioContext, out: AudioNode) => (() => void)): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    let v = this.voices.get(key);
    if (!v) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(this.master);
      const stopSources = make(ctx, gain);
      v = { gain, pan, radius, stop: () => { stopSources(); gain.disconnect(); pan.disconnect(); } };
      this.voices.set(key, v);
    }
    return v;
  }

  private place(v: Voice, at: Vec2, level: number): void {
    const t = this.ctx!.currentTime;
    v.gain.gain.setTargetAtTime(gainAt(dist(at, this.ear), v.radius) * level, t, 0.08);
    v.pan.pan.setTargetAtTime(panFor(this.ear, this.yaw, at) * 0.8, t, 0.08);
  }

  /** Keeps continuous sounds (ringing memories, the Listener's drone, the hum) matched to the world. Null silences them. */
  update(view: ViewState | null): void {
    const ctx = this.ctx;
    if (!ctx || !this.hum) return;
    const t = ctx.currentTime;
    this.hum.gain.gain.setTargetAtTime(view ? (this.phase2 ? 0.1 : 0.16) : 0.05, t, 0.5);
    const alive = new Set<string>();
    if (view) {
      const cam = view.players.find(p => p.id === view.cameraId);
      if (cam) this.setListener(cam.pos, cam.yaw);
      this.setPhase2(view.round.phase2);

      for (const m of view.memories) {
        if (m.state === 'banked' || !MEMORY_KINDS.find(k => k.id === m.kind)?.noisy) continue;
        const key = `memory-${m.id}`;
        const v = this.voice(key, N.noisyMemory, (c, out) => m.kind === 'phone' ? ring(c, out) : musicBox(c, out, m.id));
        if (v) { alive.add(key); this.place(v, m.pos, 0.5); }
      }
      for (const e of view.entities) {
        if (!e.active) continue;
        if (e.type === 'listener') {
          const key = `listener-${e.id}`;
          const v = this.voice(key, 12, (c, out) => drone(c, out));
          if (v) { alive.add(key); this.place(v, e.pos, e.mode === 'hunt' ? 1 : 0.55); }
        } else {
          // The Usher makes one dry click each time it moves. If you hear it, nobody is watching.
          const was = this.usherAt.get(e.id);
          if (was && dist(was, e.pos) > 0.05 && t - this.lastClick > 0.28) {
            this.lastClick = t;
            this.thud(e.pos, 16, 2600, 0.03, 1);
          }
          this.usherAt.set(e.id, { x: e.pos.x, z: e.pos.z });
        }
      }
    }
    for (const [key, v] of this.voices) {
      if (alive.has(key)) continue;
      v.stop();
      this.voices.delete(key);
    }
  }

  dispose(): void {
    for (const v of this.voices.values()) v.stop();
    this.voices.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** A rotary phone: two tones, ringing in bursts. */
function ring(ctx: AudioContext, out: AudioNode): () => void {
  const gate = ctx.createGain();
  gate.gain.value = 0;
  const oscs = [440, 480].map(f => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gate); o.start(); return o; });
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 0.5; // one second ringing, one second quiet
  const depth = ctx.createGain();
  depth.gain.value = 0.15;
  const offset = ctx.createConstantSource();
  offset.offset.value = 0.15;
  lfo.connect(depth).connect(gate.gain);
  offset.connect(gate.gain);
  lfo.start(); offset.start();
  gate.connect(out);
  return () => { for (const o of [...oscs, lfo]) o.stop(); offset.stop(); gate.disconnect(); };
}

/** A music box playing a short, slightly wrong tune on a loop. */
function musicBox(ctx: AudioContext, out: AudioNode, seed: number): () => void {
  const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
  const tune = [0, 2, 4, 3, 5, 4, 2, 1, 0, 3, 2, 4];
  let step = 0, stopped = false;
  const play = (): void => {
    if (stopped) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = scale[tune[(step + seed) % tune.length]!]!;
    o.detune.value = ((step * 37 + seed * 11) % 50) - 25; // never quite in tune
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.65);
    step++;
  };
  const id = setInterval(play, 340);
  return () => { stopped = true; clearInterval(id); };
}

/** The Listener: a low, uneasy drone. */
function drone(ctx: AudioContext, out: AudioNode): () => void {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 240;
  const oscs = [49, 51.5, 98.6].map(f => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(filter); o.start(); return o; });
  const g = ctx.createGain();
  g.gain.value = 0.3;
  filter.connect(g).connect(out);
  return () => { for (const o of oscs) o.stop(); g.disconnect(); };
}
