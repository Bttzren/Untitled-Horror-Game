import type { LobbyPlayer } from '../../net/protocol';
import { el } from './dom';

export interface LobbyState {
  /** Null when playing solo. */
  code: string | null;
  players: LobbyPlayer[];
  localId: number;
  night: number;
}

export interface LobbyActions { start(): void; leave(): void }

/** The waiting room between nights. Only the host (player 0) can start the night. */
export function renderLobby(root: HTMLElement, state: LobbyState, actions: LobbyActions, extra: Node | null = null): void {
  const isHost = state.localId === 0;
  root.replaceChildren(el('div', { class: 'panel lobby' }, [
    el('h2', { text: 'The waiting room' }),
    extra,
    state.code
      ? el('p', { class: 'code-line' }, [el('span', { text: 'Room code ' }), el('strong', { testid: 'room-code', text: state.code })])
      : el('p', { class: 'code-line', text: 'Solo dream' }),
    el('ul', { testid: 'lobby-players' }, state.players.map(p =>
      el('li', { text: p.name + (p.id === 0 ? ' (host)' : '') + (p.id === state.localId ? ' — you' : '') }))),
    el('p', { class: 'night', testid: 'lobby-night', text: `Night ${state.night}` }),
    isHost
      ? el('button', { testid: 'start', class: 'primary', text: 'Start night', on: { click: () => actions.start() } })
      : el('p', { class: 'busy', text: 'Waiting for the host to start…' }),
    el('button', { testid: 'leave', class: 'quiet', text: 'Leave', on: { click: () => actions.leave() } }),
  ]));
}
