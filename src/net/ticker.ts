/**
 * Calls `cb` about `hz` times a second with the real time that passed.
 * Uses a Web Worker timer where possible: browsers slow down timers in
 * background tabs, which would slow the night for everyone if the host
 * switched tabs. Returns a function that stops it.
 */
export function startTicker(hz: number, cb: (elapsedSeconds: number) => void): () => void {
  let last = performance.now();
  const fire = (): void => {
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    last = now;
    cb(elapsed);
  };
  const ms = 1000 / hz;
  try {
    const source = `setInterval(() => postMessage(0), ${ms});`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = fire;
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(fire, ms);
    return () => clearInterval(id);
  }
}
