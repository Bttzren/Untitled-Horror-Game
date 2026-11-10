import { generateDream } from './dream/generator';
import { Input } from './input/input';
import type { ViewState } from './rules/types';
import { DT, createWorld, stepWorld } from './rules/world';
import { Renderer } from './view/renderer';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;

function startSolo(): void {
  const seed = Number(params.get('seed')) || Math.floor(Math.random() * 0xffffffff);
  const map = generateDream(seed, 1);
  const world = createWorld(map, [{ id: 0, name: 'Dreamer' }], 1);
  const renderer = new Renderer(canvas);
  const input = new Input(canvas);
  renderer.setDream(map);

  const view = (): ViewState => ({
    localId: 0, cameraId: 0,
    players: world.players, entities: world.entities, memories: world.memories, round: world.round,
  });
  if (params.has('debug')) (window as unknown as { __dbg: unknown }).__dbg = { view, input };

  let seq = 0, last = performance.now(), owed = 0;
  const frame = (now: number): void => {
    owed = Math.min(owed + (now - last) / 1000, 0.25);
    last = now;
    while (owed >= DT) {
      owed -= DT;
      stepWorld(world, new Map([[0, { ...input.sample(), seq: ++seq }]]), DT);
    }
    renderer.render(view());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (params.has('solo')) startSolo();
