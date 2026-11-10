/** Things in the game that can be drawn with an imported model instead of a generated shape. */
export type ModelSlot = 'usher' | 'listener' | 'locker' | `memory:${string}`;

/**
 * Which model file (under public/assets) each slot uses. A slot with no entry
 * keeps its generated shape. Every file named here needs an entry in credits.ts.
 */
export const MODEL_FILES: Partial<Record<ModelSlot, string>> = {
  'memory:toyCar': 'models/toyCar.glb',
  'memory:boomBox': 'models/boomBox.glb',
  'memory:lantern': 'models/lantern.glb',
  'memory:teacup': 'models/teacup.glb',
};
