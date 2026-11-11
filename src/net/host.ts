import { generateDream } from '../dream/generator';
import { CONFIG } from '../rules/config';
import { carriedWeight } from '../rules/items';
import { movePlayer, sanitizeInput } from '../rules/player';
import type { InputCmd, MemoryState, PlayerId, World } from '../rules/types';
import { DT, createWorld, removePlayer, stepWorld } from '../rules/world';
import { cleanName, type HostMsg, type LobbyPlayer, type Snapshot } from './protocol';
import type { HostTransport, PeerId } from './transport';

interface Peer {
  transport: HostTransport;
  peerId: PeerId;
  /** Null until the peer has said hello and been let in. */
  playerId: PlayerId | null;
  name: string;
  /** Sequence number of the newest input received. */
  lastSeq: number;
  /** Sequence number of the newest input applied to the world; what snapshots acknowledge. */
  appliedSeq: number;
  /** Inputs waiting to be applied, one per step, oldest first. */
  queue: InputCmd[];
  /** The input applied most recently; held (without its one-shot actions) when the queue runs dry. */
  held: InputCmd | null;
  /** Allowance of extra inputs that may be applied to work off a backlog. */
  catchUp: number;
  /** Steps in a row with no new input to apply. */
  starved: number;
}

/** What a player could see of a memory; a change here is worth sending. */
const memoryKey = (m: MemoryState): string => `${m.state}|${m.carrier}|${m.pos.x}|${m.pos.z}`;

/** More waiting inputs than this means the player's connection stalled and then burst. */
const MAX_QUEUE = 8;
/** After a burst, skip ahead so this many inputs remain. */
const QUEUE_AFTER_BURST = 3;
/** Waiting inputs beyond this are worked off, one extra per step. */
const MAX_BACKLOG = 2;
/** Extra inputs a player may have applied to catch up: this many in a burst, refilling at 3 a second. */
const CATCH_UP_MAX = 8;
const CATCH_UP_REFILL = 0.1;
/** After this many steps without a new input (half a second), a player stops moving. */
const STARVED_STEPS = 15;
const ONE_SHOTS = ['interact', 'drop', 'throwIt', 'flashlight'] as const;

/**
 * The referee. Runs the rules for everyone, takes inputs from each player and
 * sends back what happened. Runs in the hosting player's browser.
 */
export class GameHost {
  private readonly transports: HostTransport[] = [];
  private readonly peers = new Map<string, Peer>();
  private readonly pickSeed: () => number;
  private owed = 0;
  private sentMemories = new Map<number, string>();
  private _state: 'lobby' | 'night' = 'lobby';
  private _night = 1;
  private _world: World | null = null;

  constructor(opts: { pickSeed?: () => number } = {}) {
    this.pickSeed = opts.pickSeed ?? (() => Math.floor(Math.random() * 0x100000000));
  }

  get state(): 'lobby' | 'night' { return this._state; }
  get night(): number { return this._night; }
  get world(): World | null { return this._world; }

  /** Starts listening on a transport. Several can be attached (the host's own player, and remote friends). */
  attach(t: HostTransport): void {
    const index = this.transports.push(t) - 1;
    const key = (peer: PeerId): string => `${index}:${peer}`;
    t.onConnect(peerId => {
      this.peers.set(key(peerId), { transport: t, peerId, playerId: null, name: '', lastSeq: 0, appliedSeq: 0, queue: [], held: null, catchUp: CATCH_UP_MAX, starved: 0 });
    });
    t.onMessage((peerId, msg) => {
      const peer = this.peers.get(key(peerId));
      if (peer) this.receive(peer, msg);
    });
    t.onDisconnect(peerId => {
      const peer = this.peers.get(key(peerId));
      this.peers.delete(key(peerId));
      if (peer && peer.playerId !== null) this.playerLeft(peer.playerId);
    });
  }

  private members(): Peer[] {
    return [...this.peers.values()].filter(p => p.playerId !== null).sort((a, b) => a.playerId! - b.playerId!);
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.members().map(p => ({ id: p.playerId!, name: p.name }));
  }

  private broadcast(msg: HostMsg): void {
    for (const p of this.members()) p.transport.send(p.peerId, msg);
  }

  private receive(peer: Peer, msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return;
    const m = msg as Record<string, unknown>;
    if (m.t === 'hello') this.hello(peer, m.name);
    else if (peer.playerId === null) return;
    else if (m.t === 'startRequest') { if (peer.playerId === 0 && this._state === 'lobby') this.startNight(); }
    else if (m.t === 'input') this.input(peer, m.cmd);
  }

  private hello(peer: Peer, name: unknown): void {
    if (peer.playerId !== null) return;
    if (this._state === 'night') { peer.transport.send(peer.peerId, { t: 'refused', reason: 'in-progress' }); return; }
    const taken = new Set(this.members().map(p => p.playerId));
    if (taken.size >= CONFIG.maxPlayers) { peer.transport.send(peer.peerId, { t: 'refused', reason: 'full' }); return; }
    let id = 0;
    while (taken.has(id)) id++;
    peer.playerId = id;
    peer.name = cleanName(name);
    peer.transport.send(peer.peerId, { t: 'welcome', id, players: this.lobbyPlayers(), night: this._night });
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), night: this._night });
  }

  private input(peer: Peer, raw: unknown): void {
    if (this._state !== 'night') return;
    const cmd = sanitizeInput(raw, peer.lastSeq);
    if (!cmd) return;
    peer.lastSeq = cmd.seq;
    peer.queue.push(cmd);
    if (peer.queue.length > MAX_QUEUE) {
      // Skip the oldest inputs, but keep any one-shot action they carried.
      const skipped = peer.queue.splice(0, peer.queue.length - QUEUE_AFTER_BURST);
      const next = peer.queue[0]!;
      for (const old of skipped) for (const k of ONE_SHOTS) next[k] ||= old[k];
    }
  }

  private startNight(): void {
    const members = this.members();
    if (members.length === 0) return;
    const seed = this.pickSeed() >>> 0;
    const map = generateDream(seed, this._night);
    this._world = createWorld(map, members.map(p => ({ id: p.playerId!, name: p.name })), this._night);
    this._state = 'night';
    this.owed = 0;
    // Clients build the opening memories from the seed themselves, so only later changes need sending.
    this.sentMemories = new Map(this._world.memories.map(m => [m.id, memoryKey(m)]));
    for (const p of members) { p.lastSeq = 0; p.appliedSeq = 0; p.queue = []; p.held = null; p.catchUp = CATCH_UP_MAX; p.starved = 0; }
    this.broadcast({ t: 'start', seed, night: this._night, quota: this._world.round.quota });
  }

  private playerLeft(id: PlayerId): void {
    if (this._world) removePlayer(this._world, id);
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), night: this._night });
    if (this._state !== 'night' || !this._world) return;
    if (this._world.players.length === 0) {
      // Nobody is left to play: abandon the run.
      this._state = 'lobby';
      this._night = 1;
      this._world = null;
    } else if (this._world.round.result) {
      this.finishNight();
    }
  }

  /**
   * Advances the night by the real time that has passed. Runs whole steps only,
   * and never more than CONFIG.maxStepsPerTick at once: after a long stall the
   * backlog is dropped rather than replayed.
   */
  tick(elapsedSeconds: number): void {
    if (this._state !== 'night' || !this._world) { this.owed = 0; return; }
    this.owed += elapsedSeconds;
    let steps = Math.floor(this.owed / DT + 1e-9);
    this.owed -= steps * DT;
    if (steps > CONFIG.maxStepsPerTick) { steps = CONFIG.maxStepsPerTick; this.owed = 0; }
    for (let i = 0; i < steps && this._state === 'night'; i++) this.step();
  }

  private step(): void {
    const world = this._world!;
    const inputs = new Map<PlayerId, InputCmd>();
    for (const p of this.members()) {
      // A backlog means the player's inputs are being applied late. Work it off by applying one extra
      // input's movement per step, so a single hitch does not cost them the whole night. The allowance
      // refills slowly, so sending inputs too fast cannot be used to move faster for long.
      p.catchUp = Math.min(CATCH_UP_MAX, p.catchUp + CATCH_UP_REFILL);
      const body = world.players.find(x => x.id === p.playerId);
      if (p.queue.length > MAX_BACKLOG && p.catchUp >= 1 && body) {
        p.catchUp -= 1;
        const extra = p.queue.shift()!;
        movePlayer(body, extra, world.map, carriedWeight(world, body), DT);
        for (const k of ONE_SHOTS) p.queue[0]![k] ||= extra[k];
      }
      const next = p.queue.shift();
      if (next) {
        p.held = next;
        p.appliedSeq = next.seq;
        inputs.set(p.playerId!, next);
        p.starved = 0;
      } else if (p.held && ++p.starved > STARVED_STEPS) {
        // Nothing has arrived for a while: the connection has probably died. Stand still.
        inputs.set(p.playerId!, { ...p.held, moveX: 0, moveZ: 0, sprint: false, interact: false, drop: false, throwIt: false, flashlight: false });
      } else if (p.held) {
        // Nothing new arrived: keep moving as before, without repeating one-shot actions.
        inputs.set(p.playerId!, { ...p.held, interact: false, drop: false, throwIt: false, flashlight: false });
      }
    }
    stepWorld(world, inputs, DT);
    for (const ev of world.events) this.broadcast({ t: 'event', ev });
    if (world.tick % CONFIG.snapshotEvery === 0 || world.round.result) this.broadcast({ t: 'snapshot', snap: this.snapshot(world) });
    if (world.round.result) this.finishNight();
  }

  private snapshot(world: World): Snapshot {
    const ack: Record<number, number> = {};
    for (const p of this.members()) ack[p.playerId!] = p.appliedSeq;
    const memories = world.memories.filter(m => {
      // Internal timers tick constantly and are not worth sending; only what a player could see counts as a change.
      const text = memoryKey(m);
      if (this.sentMemories.get(m.id) === text) return false;
      this.sentMemories.set(m.id, text);
      return true;
    });
    // Entities go out without their plans (route, what they are ignoring): clients only draw them.
    const entities = world.entities.map(e => ({ ...e, path: [], ignore: [] }));
    return { tick: world.tick, ack, players: world.players, entities, memories, round: world.round };
  }

  private finishNight(): void {
    const round = this._world!.round;
    const result = round.result ?? 'fail';
    const nextNight = result === 'success' ? this._night + 1 : 1;
    this.broadcast({ t: 'end', result, banked: round.banked, quota: round.quota, nextNight });
    this._night = nextNight;
    this._state = 'lobby';
    this._world = null;
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), night: this._night });
  }

  close(): void {
    for (const t of this.transports) t.close();
    this.peers.clear();
    this._state = 'lobby';
    this._world = null;
  }
}
