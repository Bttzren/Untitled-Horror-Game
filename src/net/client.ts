import { generateDream } from '../dream/generator';
import type { DreamMap } from '../dream/types';
import { CONFIG, MEMORY_KINDS, type WeightClass } from '../rules/config';
import { movePlayer } from '../rules/player';
import type { EntityState, GameEvent, InputCmd, MemoryState, PlayerId, PlayerState, ViewState } from '../rules/types';
import { DT, createWorld } from '../rules/world';
import type { HostMsg, LobbyPlayer, Snapshot } from './protocol';
import type { ClientTransport } from './transport';

export type ClientStatus = 'connecting' | 'lobby' | 'night' | 'refused' | 'closed';

interface Timed { at: number; snap: Snapshot }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Blends two angles the short way round. */
function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/**
 * One player's connection to the host. Sends inputs, receives snapshots, and
 * produces what to draw: the local player predicted ahead so movement feels
 * instant, everyone else blended smoothly a moment in the past.
 */
export class GameClient {
  private _status: ClientStatus = 'connecting';
  private _refused: 'full' | 'in-progress' | null = null;
  private _playerId: PlayerId | null = null;
  private _lobby: LobbyPlayer[] = [];
  private _night = 1;
  private _map: DreamMap | null = null;
  private _lastEnd: Extract<HostMsg, { t: 'end' }> | null = null;
  private seq = 0;
  /** Inputs the host has not acknowledged yet. */
  private pending: InputCmd[] = [];
  private snaps: Timed[] = [];
  private memories = new Map<number, MemoryState>();
  private predicted: PlayerState | null = null;
  /** Who a caught or departed player is watching. */
  spectateId: PlayerId | null = null;
  onEvent: (ev: GameEvent) => void = () => {};
  /** Status, lobby list, night start or night end changed. */
  onChange: () => void = () => {};

  constructor(private readonly transport: ClientTransport, name: string, private readonly now: () => number = () => performance.now()) {
    transport.onMessage(m => this.receive(m));
    transport.onClose(() => {
      if (this._status === 'refused') return;
      this._status = 'closed';
      this.onChange();
    });
    transport.send({ t: 'hello', name });
  }

  get status(): ClientStatus { return this._status; }
  get refusedReason(): 'full' | 'in-progress' | null { return this._refused; }
  get playerId(): PlayerId | null { return this._playerId; }
  get lobby(): LobbyPlayer[] { return this._lobby; }
  get night(): number { return this._night; }
  get map(): DreamMap | null { return this._map; }
  get lastEnd(): Extract<HostMsg, { t: 'end' }> | null { return this._lastEnd; }

  private receive(m: HostMsg): void {
    switch (m.t) {
      case 'welcome':
        this._playerId = m.id; this._lobby = m.players; this._night = m.night; this._status = 'lobby';
        this.onChange();
        break;
      case 'refused':
        this._refused = m.reason; this._status = 'refused';
        this.onChange();
        break;
      case 'lobby':
        this._lobby = m.players; this._night = m.night;
        this.onChange();
        break;
      case 'start': {
        this._night = m.night;
        this._map = generateDream(m.seed, m.night);
        this._lastEnd = null;
        this.seq = 0; this.pending = []; this.spectateId = null;
        // Until the first snapshot arrives, start from the same opening state the host builds.
        const opening = createWorld(this._map, this._lobby, m.night);
        this.memories = new Map(opening.memories.map(mem => [mem.id, mem]));
        this.snaps = [{ at: this.now(), snap: { tick: 0, ack: {}, players: opening.players, entities: [], memories: [], round: opening.round } }];
        this._status = 'night';
        this.repredict();
        this.onChange();
        break;
      }
      case 'snapshot':
        if (this._status !== 'night') break;
        for (const mem of m.snap.memories) this.memories.set(mem.id, mem);
        this.snaps.push({ at: this.now(), snap: m.snap });
        while (this.snaps.length > 2 && this.snaps[1]!.at < this.now() - 1000) this.snaps.shift();
        this.repredict();
        break;
      case 'event':
        this.onEvent(m.ev);
        break;
      case 'end':
        this._lastEnd = m; this._night = m.nextNight; this._status = 'lobby';
        this._map = null; this.snaps = []; this.pending = []; this.predicted = null;
        this.onChange();
        break;
    }
  }

  private latest(): Snapshot | null {
    return this.snaps.length > 0 ? this.snaps[this.snaps.length - 1]!.snap : null;
  }

  private carriedWeight(p: PlayerState): WeightClass | null {
    if (p.carrying === null) return null;
    const kind = this.memories.get(p.carrying)?.kind;
    return MEMORY_KINDS.find(k => k.id === kind)?.weight ?? null;
  }

  /** Rebuilds the local player from the host's latest word plus every input it has not applied yet. */
  private repredict(): void {
    const snap = this.latest();
    const mine = snap?.players.find(p => p.id === this._playerId);
    if (!snap || !mine || !this._map) { this.predicted = null; return; }
    const acked = snap.ack[mine.id] ?? 0;
    this.pending = this.pending.filter(c => c.seq > acked);
    const p: PlayerState = { ...mine, pos: { ...mine.pos }, exposedTo: [...mine.exposedTo] };
    const weight = this.carriedWeight(p);
    for (const cmd of this.pending) movePlayer(p, cmd, this._map, weight, DT);
    this.predicted = p;
  }

  requestStart(): void {
    this.transport.send({ t: 'startRequest' });
  }

  /** Call once per simulation step during a night. */
  sendInput(cmd: Omit<InputCmd, 'seq'>): void {
    if (this._status !== 'night' || !this._map) return;
    const full: InputCmd = { ...cmd, seq: ++this.seq };
    this.transport.send({ t: 'input', cmd: full });
    this.pending.push(full);
    // Never let a dead connection grow this without bound.
    if (this.pending.length > 300) this.pending.shift();
    if (this.predicted) movePlayer(this.predicted, full, this._map, this.carriedWeight(this.predicted), DT);
  }

  /** What to draw at time `nowMs` (same clock as the constructor's `now`). Null outside a night. */
  view(nowMs: number): ViewState | null {
    const newest = this.latest();
    if (this._status !== 'night' || !newest || this._playerId === null) return null;
    const at = nowMs - CONFIG.interpDelayMs;
    let a = this.snaps[0]!, b = a;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i]!.at <= at) { a = this.snaps[i]!; b = this.snaps[i + 1] ?? a; break; }
    }
    const t = b.at > a.at ? Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at))) : 0;

    const players = newest.players.map((p): PlayerState => {
      if (p.id === this._playerId && this.predicted && p.status === 'active') return this.predicted;
      const from = a.snap.players.find(q => q.id === p.id), to = b.snap.players.find(q => q.id === p.id);
      if (!from || !to) return p;
      return { ...p, pos: { x: lerp(from.pos.x, to.pos.x, t), z: lerp(from.pos.z, to.pos.z, t) }, yaw: lerpAngle(from.yaw, to.yaw, t), pitch: lerp(from.pitch, to.pitch, t) };
    });
    const entities = newest.entities.map((e): EntityState => {
      const from = a.snap.entities.find(q => q.id === e.id), to = b.snap.entities.find(q => q.id === e.id);
      if (!from || !to) return e;
      return { ...e, pos: { x: lerp(from.pos.x, to.pos.x, t), z: lerp(from.pos.z, to.pos.z, t) }, yaw: lerpAngle(from.yaw, to.yaw, t) };
    });

    const me = newest.players.find(p => p.id === this._playerId);
    const watching = me && me.status !== 'active' && this.spectateId !== null && players.some(p => p.id === this.spectateId);
    return {
      localId: this._playerId,
      cameraId: watching ? this.spectateId! : this._playerId,
      players,
      entities,
      memories: [...this.memories.values()].sort((x, y) => x.id - y.id),
      round: newest.round,
    };
  }

  close(): void {
    this.transport.close();
  }
}
