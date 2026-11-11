import { el } from './dom';

export interface PauseState { sensitivity: number; volume: number; first: boolean }
export interface PauseActions { resume(): void; leave(): void; sensitivity(v: number): void; volume(v: number): void }

export const CONTROLS: [key: string, does: string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint (loud)'],
  ['C', 'Crouch (silent)'],
  ['E', 'Take, bank, hide, leave'],
  ['Q', 'Drop what you carry'],
  ['Left click', 'Throw what you carry'],
  ['F', 'Flashlight'],
  ['Esc', 'This menu'],
];

function slider(label: string, testid: string, value: number, min: number, max: number, onInput: (v: number) => void): HTMLElement {
  const range = el('input', { testid, attrs: { type: 'range', min: String(min), max: String(max), step: '0.05', value: String(value) } });
  range.addEventListener('input', () => onInput(Number(range.value)));
  return el('label', { text: label }, [range]);
}

/**
 * Shown during a night whenever the mouse is not captured. The night carries
 * on behind it: this is a multiplayer game and cannot stop for one player.
 */
export function renderPause(root: HTMLElement, state: PauseState, actions: PauseActions): void {
  root.replaceChildren(el('div', { class: 'panel pause', testid: 'pause' }, [
    el('h2', { text: state.first ? 'The dream begins' : 'Paused' }),
    el('p', { class: 'tagline', text: state.first ? 'Find memories. Carry them to the Door. Do not get found.' : 'The night carries on without you.' }),
    el('button', { testid: 'resume', class: 'primary', text: state.first ? 'Enter' : 'Resume', on: { click: actions.resume } }),
    el('table', { class: 'keys' }, CONTROLS.map(([key, does]) => el('tr', {}, [el('td', { class: 'key', text: key }), el('td', { text: does })]))),
    slider('Mouse speed', 'sensitivity', state.sensitivity, 0.2, 3, actions.sensitivity),
    slider('Volume', 'volume', state.volume, 0, 1, actions.volume),
    el('button', { testid: 'leave-night', class: 'quiet', text: 'Leave the room', on: { click: actions.leave } }),
  ]));
}
