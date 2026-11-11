import type { InputCmd } from '../rules/types';

const BASE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

/** Keyboard and mouse, turned into one input command per simulation step. */
export class Input {
  private keys = new Set<string>();
  /** Mouse-look speed multiplier, 0.2 to 3. */
  sensitivity = 1;
  private yaw = 0;
  private pitch = 0;
  private edges = { interact: false, drop: false, throwIt: false, flashlight: false };
  private readonly off: (() => void)[] = [];
  /** Called on a left click that should not throw (for example, to switch spectate target). */
  onClick: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.listen(canvas, 'click', () => { if (!this.locked) void this.lock(); });
    this.listen(document, 'pointerlockchange', () => { if (!this.locked) this.keys.clear(); });
    this.listen(document, 'mousemove', e => {
      if (!this.locked) return;
      const m = e as MouseEvent;
      this.yaw -= m.movementX * BASE_SENSITIVITY * this.sensitivity;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - m.movementY * BASE_SENSITIVITY * this.sensitivity));
    });
    this.listen(document, 'mousedown', e => {
      if (!this.locked || (e as MouseEvent).button !== 0) return;
      this.edges.throwIt = true;
      this.onClick?.();
    });
    this.listen(document, 'keydown', e => {
      const k = e as KeyboardEvent;
      if (!this.locked) return;
      if (!k.repeat) {
        if (k.code === 'KeyE') this.edges.interact = true;
        if (k.code === 'KeyQ') this.edges.drop = true;
        if (k.code === 'KeyF') this.edges.flashlight = true;
      }
      this.keys.add(k.code);
      if (k.code !== 'Escape') k.preventDefault();
    });
    this.listen(document, 'keyup', e => this.keys.delete((e as KeyboardEvent).code));
    this.listen(window, 'blur', () => this.keys.clear());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Captures the mouse for looking around. Must be called from a click. */
  async lock(): Promise<void> {
    try { await this.canvas.requestPointerLock(); } catch { /* the browser refused; the next click retries */ }
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.off.push(() => target.removeEventListener(type, fn));
  }

  /** Sets the look direction, for example to face into the room at the start of a night. */
  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** The input for this step. One-shot actions are reported once, then cleared. */
  sample(): Omit<InputCmd, 'seq'> {
    const down = (code: string): boolean => this.locked && this.keys.has(code);
    const cmd = {
      moveX: (down('KeyD') ? 1 : 0) - (down('KeyA') ? 1 : 0),
      moveZ: (down('KeyW') ? 1 : 0) - (down('KeyS') ? 1 : 0),
      yaw: this.yaw,
      pitch: this.pitch,
      sprint: down('ShiftLeft') || down('ShiftRight'),
      crouch: down('KeyC') || down('ControlLeft'),
      ...this.edges,
    };
    this.edges = { interact: false, drop: false, throwIt: false, flashlight: false };
    return cmd;
  }

  dispose(): void {
    for (const f of this.off) f();
    if (this.locked) document.exitPointerLock();
  }
}
