import { baseEntity, seesHiding, type EntityDef } from './helpers';

export const usherDef: EntityDef = {
  type: 'usher',
  spawn: (id, pos) => baseEntity(id, 'usher', pos),
  update: () => {},
  noticesHiding: seesHiding,
};
