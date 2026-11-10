/** Room code characters: no 0/O or 1/I, so codes survive being read aloud or typed. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

/** Every room's PeerJS id is this prefix plus its code. */
export const PEER_PREFIX = 'uhg-dream-';

export function makeRoomCode(rand: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return code;
}

/** Tidies what a player typed: ignores case, spaces and dashes. Null unless it is a possible code. */
export function normalizeCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}
