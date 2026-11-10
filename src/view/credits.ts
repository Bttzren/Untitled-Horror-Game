// Every third-party file shipped in public/assets must be listed here.
// A test fails if a file is missing from this list, or listed but absent.

export type Licence = 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0';

export interface Credit {
  /** Path under public/assets. */
  file: string;
  title: string;
  author: string;
  /** Where it came from (https). */
  source: string;
  licence: Licence;
  /** What was altered from the original. */
  changes: string;
}

const KHRONOS = 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models';
const SHRUNK = 'Textures resized to 512 px and converted to WebP; mesh lightly simplified.';

export const CREDITS: Credit[] = [
  {
    file: 'models/toyCar.glb',
    title: 'Toy Car',
    author: 'Guido Odendahl (car model), Eric Chadwick (materials and scene)',
    source: `${KHRONOS}/ToyCar`,
    licence: 'CC0-1.0',
    changes: 'Textures resized to 256 px and converted to WebP; mesh lightly simplified.',
  },
  {
    file: 'models/boomBox.glb',
    title: 'Boom Box',
    author: 'Microsoft',
    source: `${KHRONOS}/BoomBox`,
    licence: 'CC0-1.0',
    changes: SHRUNK,
  },
  {
    file: 'models/lantern.glb',
    title: 'Lantern',
    author: 'Microsoft (sbtron), Frank Galligan',
    source: `${KHRONOS}/Lantern`,
    licence: 'CC0-1.0',
    changes: SHRUNK,
  },
  {
    file: 'models/teacup.glb',
    title: 'Teacup',
    author: 'Poly Haven and Eric Chadwick',
    source: `${KHRONOS}/DiffuseTransmissionTeacup`,
    licence: 'CC0-1.0',
    changes: SHRUNK,
  },
];

/** Open-source libraries the game is built with. */
export const BUILT_WITH: { name: string; licence: string; url: string }[] = [
  { name: 'three.js', licence: 'MIT', url: 'https://threejs.org' },
  { name: 'PeerJS', licence: 'MIT', url: 'https://peerjs.com' },
];
