import { baseEntity, type EntityDef } from './helpers';

export const listenerDef: EntityDef = {
  type: 'listener',
  spawn: (id, pos) => baseEntity(id, 'listener', pos),
  update: () => {},
  // Blind: it never sees anyone hide.
  noticesHiding: () => false,
};
