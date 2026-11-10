import * as THREE from 'three';

/** A small repeating texture painted in code. `seed` keeps the speckle stable between runs. */
function paint(size: number, draw: (g: CanvasRenderingContext2D, rand: () => number) => void, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  let a = seed >>> 0;
  const rand = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  draw(g, rand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, rand: () => number, size: number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export function carpet(base: string, seed: number): THREE.CanvasTexture {
  return paint(128, (g, rand) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    speckle(g, rand, 128, 2600, 0.07);
  }, seed);
}

export function tiles(base: string, grout: string, perSide: number, seed: number): THREE.CanvasTexture {
  return paint(128, (g, rand) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    speckle(g, rand, 128, 500, 0.04);
    g.strokeStyle = grout; g.lineWidth = 2;
    const step = 128 / perSide;
    for (let i = 0; i <= perSide; i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, 128); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(128, i * step); g.stroke();
    }
  }, seed);
}

export function wallpaper(base: string, stripe: string, seed: number): THREE.CanvasTexture {
  return paint(128, (g, rand) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    g.fillStyle = stripe;
    for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 2, 128);
    speckle(g, rand, 128, 900, 0.05);
    // A grubby band near the floor.
    const grad = g.createLinearGradient(0, 96, 0, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = grad; g.fillRect(0, 96, 128, 32);
  }, seed);
}
