import { generateDream } from '../dream/generator';
import { CONFIG } from '../rules/config';
import { sanitizeInput } from '../rules/player';
import type { InputCmd, PlayerId, World } from '../rules/types';
import { DT, createWorld, removePlayer, stepWorld } from '../rules/world';
import { cleanName, type HostMsg, type LobbyPlayer, type Snapshot } from './protocol';
import type { HostTransport, PeerId } from './transport';

interface Peer {
  transport: HostTransport;
  peerId: PeerId;
  /** Null until the peer has said hello and been let in. */
  playerId: PlayerId | null;
  name: string;
  lastSeq: number;
  input: InputCmd | null;
  /** One-shot actions received since the last step. */
  edges: { interact: boolean; drop: boolean; throwIt: boolean; flashlight: boolean };
}

const noEdges = (): Peer['edges'] => ({ interact: false, drop: false, throwIt: false, flashlight: false });

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
      this.peers.set(key(peerId), { transport: t, peerId, playerId: null, name: '', lastSeq: 0, input: null, edges: noEdges() });
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
    peer.input = cmd;
    peer.edges.interact ||= cmd.interact;
    peer.edges.drop ||= cmd.drop;
    peer.edges.throwIt ||= cmd.throwIt;
    peer.edges.flashlight ||= cmd.flashlight;
  }

  private startNight(): void {
    const members = this.members();
    if (members.length === 0) return;
    const seed = this.pickSeed() >>> 0;
    const map = generateDream(seed, this._night);
    this._world = createWorld(map, members.map(p => ({ id: p.playerId!, name: p.name })), this._night);
    this._state = 'night';
    this.owed = 0;
    this.sentMemories = new Map();
    for (const p of members) { p.lastSeq = 0; p.input = null; p.edges = noEdges(); }
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
      if (!p.input) continue;
      inputs.set(p.playerId!, { ...p.input, ...p.edges });
      p.edges = noEdges();
    }
    stepWorld(world, inputs, DT);
    for (const ev of world.events) this.broadcast({ t: 'event', ev });
    if (world.tick % CONFIG.snapshotEvery === 0 || world.round.result) this.broadcast({ t: 'snapshot', snap: this.snapshot(world) });
    if (world.round.result) this.finishNight();
  }

  private snapshot(world: World): Snapshot {
    const ack: Record<number, number> = {};
    for (const p of this.members()) ack[p.playerId!] = p.lastSeq;
    const memories = world.memories.filter(m => {
      const text = JSON.stringify(m);
      if (this.sentMemories.get(m.id) === text) return false;
      this.sentMemories.set(m.id, text);
      return true;
    });
    return { tick: world.tick, ack, players: world.players, entities: world.entities, memories, round: world.round };
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
