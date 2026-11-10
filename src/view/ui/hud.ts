import type { DreamMap } from '../../dream/types';
import type { HostMsg, LobbyPlayer } from '../../net/protocol';
import { CONFIG, MEMORY_KINDS } from '../../rules/config';
import { lineOfSight } from '../../rules/nav';
import type { GameEvent, PlayerId, ViewState } from '../../rules/types';
import { dist } from '../../shared/vec';
import { el } from './dom';

/** Seconds as m:ss, rounded up so the clock reads 0:00 only when time is really out. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const kindName = (id: string): string => MEMORY_KINDS.find(k => k.id === id)?.name ?? 'memory';

/** What pressing E would do for the local player right now, or null for nothing. Mirrors the interact rules. */
export function promptFor(view: ViewState, map: DreamMap): string | null {
  const me = view.players.find(p => p.id === view.localId);
  if (!me || me.status !== 'active') return null;
  if (me.hiddenIn !== null) return 'E — come out';
  const nearDoor = dist(me.pos, map.door) <= CONFIG.reach.door;
  const held = me.carrying === null ? undefined : view.memories.find(m => m.id === me.carrying);
  if (nearDoor && held) return `E — bank (+${held.value})`;
  if (!held) {
    let best: { name: string; d: number } | null = null;
    for (const m of view.memories) {
      if (m.state !== 'ground') continue;
      const d = dist(me.pos, m.pos);
      if (d <= CONFIG.reach.memory && (!best || d < best.d) && lineOfSight(map, me.pos, m.pos)) best = { name: kindName(m.kind), d };
    }
    if (best) return `E — take ${best.name}`;
    if (nearDoor) {
      return view.round.doorOpen ? 'E — leave the dream' : `Door is closed — ${Math.max(0, view.round.quota - view.round.banked)} more needed`;
    }
  }
  const free = map.hidingSpots.some(s =>
    dist(me.pos, s.pos) <= CONFIG.reach.hide && !view.players.some(p => p.status === 'active' && p.hiddenIn === s.id));
  return free ? 'E — hide' : null;
}

/** The next player still inside the dream after `current`, for a spectator to watch. */
export function nextSpectateTarget(view: ViewState, current: PlayerId): PlayerId | null {
  const active = view.players.filter(p => p.status === 'active' && p.id !== view.localId).map(p => p.id).sort((a, b) => a - b);
  if (active.length === 0) return null;
  return active.find(id => id > current) ?? active[0]!;
}

/** One line for the event feed, or null for events that are not worth a line. */
export function describeEvent(ev: GameEvent, names: LobbyPlayer[]): string | null {
  const name = (id: PlayerId): string => names.find(p => p.id === id)?.name ?? 'Someone';
  switch (ev.type) {
    case 'banked': return `${name(ev.player)} banked a memory (+${ev.value})`;
    case 'caught': return ev.by === 'collapse' ? `${name(ev.player)} was lost in the collapse` : `${name(ev.player)} was taken`;
    case 'left': return `${name(ev.player)} left the dream`;
    case 'doorOpen': return 'Quota met — the Door is open';
    case 'phase2': return 'The dream is coming apart';
    default: return null;
  }
}

/** A short summary of how the last night ended, shown in the waiting room. */
export function resultPanel(end: Extract<HostMsg, { t: 'end' }>): HTMLElement {
  const won = end.result === 'success';
  return el('div', { class: `result ${won ? 'won' : 'lost'}`, testid: 'result' }, [
    el('strong', { text: won ? 'You woke up' : 'The dream kept you' }),
    el('span', { text: `${end.banked} / ${end.quota} banked. ${won ? `Night ${end.nextNight} is next.` : 'Back to night 1.'}` }),
  ]);
}

/** The in-night overlay: quota, timer, stamina, what you carry, what E does, and a feed of events. */
export class Hud {
  private readonly quota = el('span', { testid: 'hud-quota' });
  private readonly timer = el('span', { testid: 'hud-timer', class: 'timer' });
  private readonly carrying = el('div', { class: 'carrying' });
  private readonly prompt = el('div', { class: 'prompt', testid: 'hud-prompt' });
  private readonly staminaFill = el('div', { class: 'fill' });
  private readonly spectating = el('div', { class: 'spectating', testid: 'hud-spectating' });
  private readonly feed = el('div', { class: 'feed', testid: 'hud-feed' });
  readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', { attrs: { id: 'hud' } }, [
      el('div', { class: 'top' }, [el('span', { class: 'label', text: 'Banked ' }), this.quota, this.timer]),
      this.feed,
      el('div', { class: 'crosshair' }),
      this.spectating,
      this.prompt,
      el('div', { class: 'bottom' }, [el('div', { class: 'stamina' }, [this.staminaFill]), this.carrying]),
    ]);
    parent.append(this.root);
  }

  update(view: ViewState, map: DreamMap): void {
    const me = view.players.find(p => p.id === view.localId);
    this.quota.textContent = `${view.round.banked} / ${view.round.quota}`;
    this.timer.textContent = formatTime(view.round.timeLeft);
    this.timer.classList.toggle('late', view.round.phase2);
    this.staminaFill.style.width = `${Math.round(((me?.stamina ?? 0) / CONFIG.staminaSeconds) * 100)}%`;
    this.staminaFill.classList.toggle('winded', me?.winded ?? false);
    const held = me?.carrying == null ? undefined : view.memories.find(m => m.id === me.carrying);
    this.carrying.textContent = held ? `Carrying: ${kindName(held.kind)} (${held.value}) — Q drop, click throw` : '';
    this.prompt.textContent = promptFor(view, map) ?? '';
    const playing = me?.status === 'active';
    this.root.classList.toggle('out', !playing);
    if (playing) {
      this.spectating.textContent = '';
    } else {
      const watched = view.cameraId !== view.localId ? view.players.find(p => p.id === view.cameraId) : undefined;
      const why = me?.status === 'left' ? 'You left the dream.' : 'You were taken.';
      this.spectating.textContent = watched ? `${why} Spectating ${watched.name} — click to switch` : `${why} Nobody is left inside.`;
    }
  }

  /** Adds a line to the event feed; it fades out by itself. */
  say(text: string): void {
    const line = el('div', { class: 'line', text });
    this.feed.append(line);
    while (this.feed.children.length > 5) this.feed.firstElementChild?.remove();
    setTimeout(() => line.remove(), 6000);
  }

  clear(): void {
    this.feed.replaceChildren();
  }
}
