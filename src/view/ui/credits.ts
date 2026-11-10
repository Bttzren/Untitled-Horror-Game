import { BUILT_WITH, CREDITS } from '../credits';
import { el } from './dom';

const LICENCE_NAMES: Record<string, string> = {
  'CC0-1.0': 'CC0 1.0 (public domain)',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-3.0': 'CC BY 3.0',
};

const link = (text: string, href: string): HTMLElement => el('a', { text, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } });

/** The Credits screen: every third-party asset, who made it, and under what licence. */
export function renderCredits(root: HTMLElement, back: () => void): void {
  root.replaceChildren(el('div', { class: 'panel credits', testid: 'credits-screen' }, [
    el('h2', { text: 'Credits' }),
    el('p', { class: 'tagline', text: 'Rooms, entities and all sound are made by the game’s own code. These models were made by other people and shared freely:' }),
    el('ul', {}, CREDITS.map(c => el('li', { testid: 'credit' }, [
      el('strong', { text: c.title }),
      el('span', { text: ` by ${c.author}` }),
      el('div', { class: 'small' }, [el('span', { text: `${LICENCE_NAMES[c.licence] ?? c.licence} · ` }), link('source', c.source)]),
      el('div', { class: 'small', text: `Changes: ${c.changes}` }),
    ]))),
    el('h3', { text: 'Built with' }),
    el('ul', { testid: 'built-with' }, BUILT_WITH.map(b => el('li', {}, [link(b.name, b.url), el('span', { text: ` (${b.licence})` })]))),
    el('button', { testid: 'credits-back', text: 'Back', on: { click: back } }),
  ]));
}
