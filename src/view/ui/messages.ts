/** Everything the game says when a connection goes wrong. */
export const MESSAGES = {
  hostLeft: 'The host left — the dream ended',
  noRoom: 'No room with that code',
  full: 'That room is full',
  inProgress: 'A night is in progress — try again when they are back in the lobby',
  blocked: "Couldn't connect — this network may block direct connections",
  signalling: "Couldn't reach the matchmaking server",
} as const;

export type MessageKey = keyof typeof MESSAGES;
