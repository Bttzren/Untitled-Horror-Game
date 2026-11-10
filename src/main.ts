import { generateDream } from './dream/generator';
import { Input } from './input/input';
import { GameClient } from './net/client';
import { GameHost } from './net/host';
import { createLoopback } from './net/loopbackTransport';
import { JoinError, hostPeer, joinPeer, type SignalOptions } from './net/peerTransport';
import { cleanName } from './net/protocol';
import { makeRoomCode, normalizeCode } from './net/roomCode';
import { startTicker } from './net/ticker';
import type { ViewState } from './rules/types';
import { DT, createWorld } from './rules/world';
import { Renderer } from './view/renderer';
import { el } from './view/ui/dom';
import { Hud, describeEvent, nextSpectateTarget, resultPanel } from './view/ui/hud';
import { renderLobby } from './view/ui/lobby';
import { renderMenu, type MenuNotice } from './view/ui/menu';
import { MESSAGES } from './view/ui/messages';
import './view/ui/ui.css';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const screen = el('div');
ui.append(screen, el('div', { attrs: { id: 'hint' }, text: 'Click to play' }));

const hud = new Hud(ui);
const renderer = new Renderer(canvas);
const input = new Input(canvas);

/** `?signal=host:port` points the game at a different matchmaking server. */
function signalOptions(): SignalOptions | undefined {
  const raw = params.get('signal');
  if (!raw) return undefined;
  const [host, port] = raw.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false };
}

interface Session {
  client: GameClient;
  /** Present only for the player hosting the room. */
  host: GameHost | null;
  stopTicker: (() => void) | null;
  code: string | null;
  /** The map currently built in the renderer. */
  shownMap: unknown;
  leaving: boolean;
}

let session: Session | null = null;
let menu: { name: string; notice: MenuNotice | null; busy: string | null } = { name: '', notice: null, busy: null };

// Behind the menu: a slow turn in an empty dream.
const backdropMap = generateDream(Math.floor(Math.random() * 0xffffffff), 1);
const backdrop = createWorld(backdropMap, [{ id: 0, name: '' }], 1);
// Stand in the middle of the first room beyond the Door's, so the Door itself is not filling the view.
const backdropCell = backdropMap.rooms[1]?.cells[0];
if (backdropCell) backdrop.players[0]!.pos = { x: (backdropCell.cx + 0.5) * 4, z: (backdropCell.cz + 0.5) * 4 };
let backdropShown = false;

function showMenu(notice: MenuNotice | null = null): void {
  menu = { ...menu, notice, busy: null };
  drawMenu();
}

function drawMenu(): void {
  ui.classList.remove('playing');
  renderMenu(screen, {
    host: name => void startHosting(name, true),
    join: (name, code) => void joinRoom(name, code),
    solo: name => void startHosting(name, false),
    credits: () => {},
  }, menu);
}

function endSession(notice: MenuNotice | null): void {
  const s = session;
  session = null;
  if (s) {
    s.leaving = true;
    s.stopTicker?.();
    s.client.close();
    s.host?.close();
  }
  if (document.pointerLockElement) document.exitPointerLock();
  showMenu(notice);
}

function adopt(client: GameClient, host: GameHost | null, stopTicker: (() => void) | null, code: string | null): void {
  const s: Session = { client, host, stopTicker, code, shownMap: null, leaving: false };
  session = s;
  client.onChange = () => {
    if (session !== s || s.leaving) return;
    if (client.status === 'closed') endSession({ text: MESSAGES.hostLeft });
    else if (client.status === 'refused') endSession({ text: client.refusedReason === 'full' ? MESSAGES.full : MESSAGES.inProgress });
    else drawSession(s);
  };
  client.onEvent = ev => {
    if (session !== s) return;
    const line = describeEvent(ev, client.lobby);
    if (line) hud.say(line);
  };
  drawSession(s);
}

function drawSession(s: Session): void {
  const { client } = s;
  if (client.status === 'night' && client.map) {
    if (s.shownMap !== client.map) {
      s.shownMap = client.map;
      renderer.setDream(client.map);
      backdropShown = false;
      input.setLook(0, 0);
      hud.clear();
    }
    ui.classList.add('playing');
    screen.replaceChildren();
    return;
  }
  ui.classList.remove('playing');
  if (document.pointerLockElement) document.exitPointerLock();
  if (client.status === 'lobby' && client.playerId !== null) {
    renderLobby(screen, { code: s.code, players: client.lobby, localId: client.playerId, night: client.night }, {
      start: () => client.requestStart(),
      leave: () => endSession(null),
    }, client.lastEnd ? resultPanel(client.lastEnd) : null);
  }
}

async function startHosting(rawName: string, online: boolean): Promise<void> {
  const name = cleanName(rawName);
  menu = { name, notice: null, busy: online ? 'Opening a room…' : null };
  drawMenu();
  const seedParam = Number(params.get('seed'));
  const host = new GameHost(seedParam ? { pickSeed: () => seedParam } : {});
  const local = createLoopback({ auto: true });
  host.attach(local.host);
  let code: string | null = null;
  if (online) {
    code = makeRoomCode();
    try {
      host.attach(await hostPeer(code, signalOptions()));
    } catch {
      host.close();
      showMenu({ text: MESSAGES.signalling, retry: () => void startHosting(name, true) });
      return;
    }
  }
  const client = new GameClient(local.connect(), name);
  adopt(client, host, startTicker(60, elapsed => host.tick(elapsed)), code);
}

async function joinRoom(rawName: string, rawCode: string): Promise<void> {
  const name = cleanName(rawName);
  const code = normalizeCode(rawCode);
  menu = { name, notice: null, busy: null };
  if (!code) { showMenu({ text: MESSAGES.noRoom }); return; }
  menu.busy = 'Looking for the room…';
  drawMenu();
  try {
    adopt(new GameClient(await joinPeer(code, signalOptions()), name), null, null, code);
  } catch (err) {
    const reason = err instanceof JoinError ? err.reason : 'blocked';
    if (reason === 'no-room') showMenu({ text: MESSAGES.noRoom });
    else if (reason === 'signalling') showMenu({ text: MESSAGES.signalling, retry: () => void joinRoom(name, code) });
    else showMenu({ text: MESSAGES.blocked });
  }
}

// A caught or departed player clicks to switch who they are watching.
input.onClick = () => {
  const client = session?.client;
  const view = client?.view(performance.now());
  if (!client || !view) return;
  if (view.players.find(p => p.id === view.localId)?.status === 'active') return;
  client.spectateId = nextSpectateTarget(view, client.spectateId ?? -1);
};

const idle = { moveX: 0, moveZ: 0, sprint: false, crouch: false, interact: false, drop: false, throwIt: false, flashlight: false };

// A hidden tab stops drawing frames, and so stops sending inputs: tell the host to stand still first.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.client.status === 'night') {
    const look = input.sample();
    session.client.sendInput({ ...idle, yaw: look.yaw, pitch: look.pitch });
  }
});
window.addEventListener('pagehide', () => { session?.client.close(); session?.host?.close(); });

let last = performance.now(), owed = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const client = session?.client;
  let view: ViewState | null = null;
  if (client?.status === 'night') {
    owed += dt;
    while (owed >= DT) { owed -= DT; client.sendInput(input.sample()); }
    view = client.view(now);
    ui.classList.toggle('unlocked', !input.locked);
    if (view && client.map) {
      // Out of the night but friends are still inside: watch one of them.
      const me = view.players.find(p => p.id === view!.localId);
      const watched = view.players.find(p => p.id === client.spectateId);
      if (me && me.status !== 'active' && watched?.status !== 'active') {
        client.spectateId = nextSpectateTarget(view, client.spectateId ?? -1);
        view = client.view(now) ?? view;
      }
      hud.update(view, client.map);
    }
  } else {
    owed = 0;
  }
  if (view) {
    renderer.render(view);
  } else {
    if (!backdropShown) { renderer.setDream(backdropMap); backdropShown = true; if (session) session.shownMap = null; }
    const p = backdrop.players[0]!;
    p.yaw = now / 9000;
    p.flashlight = false;
    renderer.render({ localId: 0, cameraId: 0, players: backdrop.players, entities: [], memories: backdrop.memories, round: backdrop.round });
  }
  requestAnimationFrame(frame);
}

if (params.has('debug')) {
  (window as unknown as { __dbg: unknown }).__dbg = {
    view: () => session?.client.view(performance.now()) ?? null,
    input,
    get client() { return session?.client; },
    get host() { return session?.host; },
  };
}

showMenu();
requestAnimationFrame(frame);

// `?solo` skips the menu and starts a night straight away.
if (params.has('solo')) {
  void startHosting('Dreamer', false).then(() => session?.client.requestStart());
}
