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
import { GameAudio } from './view/audio';
import { Renderer } from './view/renderer';
import { CREDITS } from './view/credits';
import { renderCredits } from './view/ui/credits';
import { el } from './view/ui/dom';
import { Hud, describeEvent, dreadLevel, nextSpectateTarget, resultPanel } from './view/ui/hud';
import { renderLobby } from './view/ui/lobby';
import { renderMenu, type MenuNotice } from './view/ui/menu';
import { MESSAGES } from './view/ui/messages';
import { renderPause } from './view/ui/pause';
import './view/ui/ui.css';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const screen = el('div');
const grain = el('div', { attrs: { id: 'grain' } });
ui.append(el('div', { attrs: { id: 'vignette' } }), grain, screen);
// Film grain: one small tile of noise, painted once and drifted by CSS.
{
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const g = tile.getContext('2d');
  if (g) {
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grain.style.backgroundImage = `url(${tile.toDataURL()})`;
  }
}

const hud = new Hud(ui);
const audio = new GameAudio();
// Browsers only allow sound after the player has clicked or pressed a key.
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => audio.start(), { once: true });
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
  /** What the pause menu last showed: 'none', or the lock state it was drawn for. */
  pauseShown: 'none' | 'first' | 'paused';
  /** The mouse has been captured at least once this night. */
  entered: boolean;
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
    credits: () => renderCredits(screen, drawMenu),
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
  // Only one session at a time: a slow connection attempt finishing late must not strand an earlier one.
  if (session) endSession(null);
  const s: Session = { client, host, stopTicker, code, shownMap: null, leaving: false, pauseShown: 'none', entered: false };
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
    audio.onEvent(ev);
    if (ev.type === 'caught' && ev.player === client.playerId) hud.flashCaught();
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
      s.entered = false;
      s.pauseShown = 'none';
      screen.replaceChildren();
    }
    ui.classList.add('playing');
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

/** Bumped by every attempt to host or join; a slow attempt that is no longer the latest gives up. */
let attempt = 0;

async function startHosting(rawName: string, online: boolean): Promise<void> {
  const mine = ++attempt;
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
      const transport = await hostPeer(code, signalOptions());
      if (mine !== attempt) { transport.close(); host.close(); return; }
      host.attach(transport);
    } catch {
      host.close();
      if (mine !== attempt) return;
      showMenu({ text: MESSAGES.signalling, retry: () => void startHosting(name, true) });
      return;
    }
  }
  const client = new GameClient(local.connect(), name);
  adopt(client, host, startTicker(60, elapsed => host.tick(elapsed)), code);
}

async function joinRoom(rawName: string, rawCode: string): Promise<void> {
  const mine = ++attempt;
  const name = cleanName(rawName);
  const code = normalizeCode(rawCode);
  menu = { name, notice: null, busy: null };
  if (!code) { showMenu({ text: MESSAGES.noRoom }); return; }
  menu.busy = 'Looking for the room…';
  drawMenu();
  try {
    const transport = await joinPeer(code, signalOptions());
    if (mine !== attempt) { transport.close(); return; }
    adopt(new GameClient(transport, name), null, null, code);
  } catch (err) {
    if (mine !== attempt) return;
    const reason = err instanceof JoinError ? err.reason : 'blocked';
    if (reason === 'no-room') showMenu({ text: MESSAGES.noRoom });
    else if (reason === 'signalling') showMenu({ text: MESSAGES.signalling, retry: () => void joinRoom(name, code) });
    else showMenu({ text: MESSAGES.blocked });
  }
}

let volume = 0.55;

/** Shows the pause menu whenever the mouse is free during a night, and hides it when it is captured. */
function syncPause(s: Session): void {
  if (input.locked) {
    s.entered = true;
    if (s.pauseShown !== 'none') { s.pauseShown = 'none'; screen.replaceChildren(); }
    return;
  }
  const want = s.entered ? 'paused' : 'first';
  if (s.pauseShown === want) return;
  s.pauseShown = want;
  renderPause(screen, { sensitivity: input.sensitivity, volume, first: !s.entered }, {
    resume: () => void input.lock(),
    leave: () => endSession(null),
    sensitivity: v => { input.sensitivity = v; },
    volume: v => { volume = v; audio.setVolume(v); },
  });
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
// Closing or reloading the tab mid-night would drop the player (and, for the host, end the night for everyone): ask first.
window.addEventListener('beforeunload', e => {
  if (session?.client.status === 'night') e.preventDefault();
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
    syncPause(session!);
    if (view && client.map) {
      // Out of the night but friends are still inside: watch one of them.
      const me = view.players.find(p => p.id === view!.localId);
      const watched = view.players.find(p => p.id === client.spectateId);
      if (me && me.status !== 'active' && watched?.status !== 'active') {
        client.spectateId = nextSpectateTarget(view, client.spectateId ?? -1);
        view = client.view(now) ?? view;
      }
      hud.update(view, client.map);
      const dread = dreadLevel(view);
      hud.setDread(dread);
      audio.setDread(dread);
    }
  } else {
    owed = 0;
  }
  audio.update(view);
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
    credits: CREDITS,
    renderer,
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
