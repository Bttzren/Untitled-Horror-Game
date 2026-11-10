import { el } from './dom';

export interface MenuActions {
  host(name: string): void;
  join(name: string, code: string): void;
  solo(name: string): void;
  credits(): void;
}

export interface MenuNotice { text: string; retry?: () => void }

/** The main menu. `busy` disables the buttons while a connection is being made. */
export function renderMenu(root: HTMLElement, actions: MenuActions, state: { name: string; notice: MenuNotice | null; busy: string | null }): void {
  const name = el('input', { testid: 'name', attrs: { type: 'text', maxlength: '16', placeholder: 'Your name', autocomplete: 'off', value: state.name } });
  const code = el('input', { testid: 'code', class: 'code', attrs: { type: 'text', maxlength: '12', placeholder: 'CODE', autocomplete: 'off', spellcheck: 'false' } });
  const off: Record<string, string> = state.busy ? { disabled: '' } : {};
  const join = (): void => actions.join(name.value, code.value);
  code.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') join(); });

  root.replaceChildren(el('div', { class: 'panel menu' }, [
    el('h1', { text: 'Untitled Horror Game' }),
    el('p', { class: 'tagline', text: 'Go in. Take their memories. Do not get found.' }),
    el('label', { text: 'Name' }, [name]),
    el('button', { testid: 'host', class: 'primary', text: 'Host a room', attrs: off, on: { click: () => actions.host(name.value) } }),
    el('div', { class: 'row' }, [
      code,
      el('button', { testid: 'join', text: 'Join', attrs: off, on: { click: join } }),
    ]),
    el('button', { testid: 'solo', text: 'Play solo', attrs: off, on: { click: () => actions.solo(name.value) } }),
    el('button', { testid: 'credits', class: 'quiet', text: 'Credits', on: { click: () => actions.credits() } }),
    state.busy ? el('p', { class: 'busy', testid: 'menu-busy', text: state.busy }) : null,
    state.notice ? el('p', { class: 'notice', testid: 'menu-error', text: state.notice.text }) : null,
    state.notice?.retry ? el('button', { testid: 'retry', text: 'Retry', on: { click: state.notice.retry } }) : null,
  ]));
}
