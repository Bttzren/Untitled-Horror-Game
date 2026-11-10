import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_FILES, type ModelSlot } from './modelFiles';

export { MODEL_FILES, type ModelSlot } from './modelFiles';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D | null>>();

/** Scales and moves a model so it is 1 unit across its largest side, centred, and standing on the ground. */
function normalise(model: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z) || 1;
  model.position.set(-centre.x, -box.min.y, -centre.z);
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(1 / largest);
  const out = new THREE.Group();
  out.add(holder);
  model.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      // See-through glass needs an extra render pass per frame; not worth it for a prop.
      if (m instanceof THREE.MeshPhysicalMaterial && m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = 0.55; }
    }
  });
  return out;
}

/**
 * Loads the model for a slot: 1 unit across, centred, base on the ground. Each
 * call gets its own copy. Resolves to null when the slot has no model or the
 * file cannot be loaded, in which case the generated shape stays.
 */
export function loadModel(slot: ModelSlot): Promise<THREE.Object3D | null> {
  const file = MODEL_FILES[slot];
  if (!file) return Promise.resolve(null);
  let pending = cache.get(file);
  if (!pending) {
    pending = loader.loadAsync(`./assets/${file}`).then(gltf => normalise(gltf.scene), () => null);
    cache.set(file, pending);
  }
  return pending.then(model => model?.clone(true) ?? null);
}
