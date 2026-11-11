import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isOpen, roomIdAt } from '../dream/grid';
import type { Cell, DreamMap, RoomTemplateId } from '../dream/types';
import { CONFIG, MEMORY_KINDS } from '../rules/config';
import type { EntityState, MemoryState, PlayerState, ViewState } from '../rules/types';
import { loadModel } from './assets';
import { carpet, tiles, wallpaper } from './textures';

export type { ViewState } from '../rules/types';

const CELL = CONFIG.cell;
const WALL_H = 3;
const DOOR_H = 2.3;
const MAX_ROOM_LIGHTS = 6;
const PLAYER_COLOURS = [0xe8c468, 0x6fb7c9, 0xc97f9a, 0x8fbf7a];

interface Look { floor: THREE.Material; wall: THREE.Material; ceiling: THREE.Material }

/** Draws the dream and everything in it with Three.js. Holds no game rules. */
export class Renderer {
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 80);
  private readonly dream = new THREE.Group();
  private readonly actors = new THREE.Group();
  private readonly roomLights: THREE.PointLight[] = [];
  /** Faint light from everywhere, so unlit corners are dim rather than black. */
  private readonly sky = new THREE.HemisphereLight(0xfff4d0, 0x302a18, 0.12);
  private haloTexture: THREE.Texture | null = null;
  private bob = 0;
  private lastCam: { x: number; z: number } | null = null;
  private readonly flashlight = new THREE.SpotLight(0xfff2d6, 0, 22, 0.5, 0.45, 1.2);
  private readonly players = new Map<number, THREE.Object3D>();
  private readonly memories = new Map<number, THREE.Object3D>();
  private readonly entities = new Map<number, THREE.Object3D>();
  private lightSpots: { pos: THREE.Vector3; panel: THREE.Mesh; on: boolean }[] = [];
  private map: DreamMap | null = null;
  private eye = CONFIG.eyeHeight;
  private looks: Record<RoomTemplateId, Look> | null = null;
  private readonly onResize = (): void => this.resize();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(0x0b0b08);
    this.scene.fog = new THREE.FogExp2(0x0b0b08, 0.06);
    this.scene.add(this.sky);
    this.scene.add(this.dream, this.actors, this.camera);
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.flashlight, this.flashlight.target);
    this.flashlight.position.set(0.25, -0.2, 0);
    this.flashlight.target.position.set(0, 0, -5);
    for (let i = 0; i < MAX_ROOM_LIGHTS; i++) {
      const light = new THREE.PointLight(0xfff0c4, 0, 13, 1.6);
      this.roomLights.push(light);
      this.scene.add(light);
    }
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildLooks(): Record<RoomTemplateId, Look> {
    const mat = (map: THREE.Texture, repeat: number, roughness = 0.95): THREE.MeshStandardMaterial => {
      map.repeat.set(repeat, repeat);
      return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0 });
    };
    const ceiling = mat(tiles('#d9d4bf', '#b9b39c', 2, 11), 1);
    const yellowWall = mat(wallpaper('#cdb96a', '#bfa955', 21), 1);
    const yellowCarpet = mat(carpet('#a08f4c', 31), 2);
    const office: Look = { floor: mat(carpet('#6d7480', 32), 2), wall: mat(wallpaper('#c9c6b8', '#b5b2a4', 22), 1), ceiling };
    const pool: Look = { floor: mat(tiles('#bfe3e6', '#7fb2b8', 8, 12), 1, 0.35), wall: mat(tiles('#e7f2f1', '#9cc4c7', 8, 13), 1, 0.4), ceiling };
    const stairs: Look = { floor: mat(tiles('#8a8a86', '#6c6c68', 4, 14), 1), wall: mat(wallpaper('#9a9a94', '#8a8a84', 23), 1), ceiling };
    const waiting: Look = { floor: mat(carpet('#7a4f4a', 33), 2), wall: mat(wallpaper('#d8cdb4', '#c2b69b', 24), 1), ceiling };
    const hall: Look = { floor: yellowCarpet, wall: yellowWall, ceiling };
    return { door: hall, hallway: hall, corner: hall, pool, office, stairwell: stairs, waiting };
  }

  /** Builds the static geometry for a night's map. */
  setDream(map: DreamMap): void {
    this.map = map;
    this.clear(this.dream);
    this.clear(this.actors);
    this.players.clear(); this.memories.clear(); this.entities.clear();
    this.looks ??= this.buildLooks();

    const floors = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const push = (m: THREE.Material, g: THREE.BufferGeometry): void => {
      if (!floors.has(m)) floors.set(m, []);
      floors.get(m)!.push(g);
    };
    const trim = new THREE.MeshStandardMaterial({ color: 0x4a4334, roughness: 0.8 });

    for (const room of map.rooms) {
      const look = this.looks[room.template];
      for (const c of room.cells) {
        const x = (c.cx + 0.5) * CELL, z = (c.cz + 0.5) * CELL;
        push(look.floor, new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2).translate(x, 0, z));
        push(look.ceiling, new THREE.PlaneGeometry(CELL, CELL).rotateX(Math.PI / 2).translate(x, WALL_H, z));
        const sides: [Cell, number, number, number][] = [
          [{ cx: c.cx + 1, cz: c.cz }, x + CELL / 2, z, -Math.PI / 2],
          [{ cx: c.cx - 1, cz: c.cz }, x - CELL / 2, z, Math.PI / 2],
          [{ cx: c.cx, cz: c.cz + 1 }, x, z + CELL / 2, Math.PI],
          [{ cx: c.cx, cz: c.cz - 1 }, x, z - CELL / 2, 0],
        ];
        for (const [n, wx, wz, rot] of sides) {
          if (!isOpen(map, c, n)) {
            push(look.wall, new THREE.PlaneGeometry(CELL, WALL_H).rotateY(rot).translate(wx, WALL_H / 2, wz));
            push(trim, new THREE.BoxGeometry(CELL, 0.14, 0.06).rotateY(rot).translate(wx, 0.07, wz)); // skirting board
          } else if (roomIdAt(map, n) !== room.id) {
            // A doorway: wall above the opening, and a frame on this side.
            push(look.wall, new THREE.PlaneGeometry(CELL, WALL_H - DOOR_H).rotateY(rot).translate(wx, (WALL_H + DOOR_H) / 2, wz));
            push(trim, new THREE.BoxGeometry(CELL, 0.12, 0.3).rotateY(rot).translate(wx, DOOR_H, wz));
            for (const side of [-1, 1]) {
              const ox = Math.cos(rot) * side * (CELL / 2 - 0.08), oz = -Math.sin(rot) * side * (CELL / 2 - 0.08);
              push(trim, new THREE.BoxGeometry(0.16, DOOR_H, 0.3).rotateY(rot).translate(wx + ox, DOOR_H / 2, wz + oz));
            }
          }
        }
      }
    }
    for (const [material, geos] of floors) {
      this.dream.add(new THREE.Mesh(mergeGeometries(geos), material));
      for (const g of geos) g.dispose();
    }

    // Ceiling light panels. Only the few nearest the camera cast real light each frame.
    const panelGeo = new THREE.PlaneGeometry(1.2, 0.6).rotateX(Math.PI / 2);
    this.lightSpots = map.lights.map(l => {
      const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
      panel.position.set(l.x, WALL_H - 0.02, l.z);
      this.dream.add(panel);
      return { pos: new THREE.Vector3(l.x, WALL_H - 0.4, l.z), panel, on: true };
    });

    this.dream.add(this.makeDoor(map));
    for (const h of map.hidingSpots) {
      const mesh = h.kind === 'locker'
        ? new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 0.6), new THREE.MeshStandardMaterial({ color: 0x5d6b73, roughness: 0.6, metalness: 0.3 }))
        : new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.25), new THREE.MeshStandardMaterial({ color: 0x6a2d2d, roughness: 1 }));
      mesh.position.set(h.pos.x, h.kind === 'locker' ? 1 : 1.2, h.pos.z);
      // Face the middle of its cell.
      const cx = (Math.floor(h.pos.x / CELL) + 0.5) * CELL, cz = (Math.floor(h.pos.z / CELL) + 0.5) * CELL;
      mesh.rotation.y = Math.atan2(cx - h.pos.x, cz - h.pos.z);
      this.dream.add(mesh);
    }
  }

  private makeDoor(map: DreamMap): THREE.Object3D {
    const door = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xbfd8ff, emissiveIntensity: 0.9, roughness: 0.4 });
    const post = new THREE.BoxGeometry(0.14, 2.3, 0.14);
    for (const side of [-0.6, 0.6]) {
      const m = new THREE.Mesh(post, frame);
      m.position.set(side, 1.15, 0);
      door.add(m);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.14, 0.14), frame);
    top.position.set(0, 2.3, 0);
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 2.22),
      new THREE.MeshBasicMaterial({ color: 0xdfeaff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    leaf.position.set(0, 1.12, 0);
    leaf.name = 'leaf';
    const glow = new THREE.PointLight(0xbfd8ff, 6, 9, 1.8);
    glow.position.set(0, 1.4, 0);
    door.add(top, leaf, glow);
    door.position.set(map.door.x, 0, map.door.z);
    door.name = 'door';
    return door;
  }

  private clear(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  }

  private playerMesh(p: PlayerState): THREE.Object3D {
    const g = new THREE.Group();
    const colour = PLAYER_COLOURS[p.id % PLAYER_COLOURS.length]!;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8 }));
    body.position.y = 0.8;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.12), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    visor.position.set(0, 1.35, -0.26);
    const lamp = new THREE.SpotLight(0xfff2d6, 0, 16, 0.5, 0.5, 1.4);
    lamp.position.set(0, 1.3, -0.3);
    lamp.target.position.set(0, 1.0, -5);
    lamp.name = 'lamp';
    g.add(body, visor, lamp, lamp.target);
    return g;
  }

  private memoryMesh(m: MemoryState): THREE.Object3D {
    const kind = MEMORY_KINDS.find(k => k.id === m.kind);
    const size = kind?.weight === 'heavy' ? 0.7 : kind?.weight === 'medium' ? 0.45 : 0.28;
    const colour = kind?.weight === 'heavy' ? 0x8c6f4a : kind?.weight === 'medium' ? 0x9a4f6b : 0xe9e2c8;
    const height = kind?.weight === 'light' ? 0.04 : size;
    // The generated shape shows at once; an imported model replaces it if one exists and loads.
    const group = new THREE.Group();
    const shape = new THREE.Mesh(
      new THREE.BoxGeometry(size, height, size * 0.8),
      new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.25, roughness: 0.6 }),
    );
    shape.position.y = height / 2;
    group.add(shape);
    // A faint glow, so memories can be spotted across a dim room.
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.halo(), color: 0xfff1c2, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(size * 2.6);
    halo.position.y = Math.max(height / 2, 0.12);
    halo.name = 'halo';
    group.add(halo);
    void loadModel(`memory:${m.kind}`).then(model => {
      if (!model) return;
      model.scale.setScalar(size * 1.25);
      group.remove(shape);
      shape.geometry.dispose();
      group.add(model);
    });
    return group;
  }

  private halo(): THREE.Texture {
    if (this.haloTexture) return this.haloTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.haloTexture = new THREE.CanvasTexture(c);
    return this.haloTexture;
  }

  private entityMesh(e: EntityState): THREE.Object3D {
    const g = new THREE.Group();
    if (e.type === 'usher') {
      const pale = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 1 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 2.3, 10), pale);
      body.position.y = 1.15;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), pale);
      head.position.y = 2.45;
      head.scale.y = 1.35;
      // Two shallow hollows where eyes would be.
      const hollow = new THREE.MeshBasicMaterial({ color: 0x1a1612 });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), hollow);
        eye.position.set(side * 0.075, 2.5, -0.17);
        eye.scale.set(1, 1.6, 0.5);
        g.add(eye);
      }
      const arm = new THREE.CylinderGeometry(0.035, 0.03, 1.5, 6);
      for (const side of [-1, 1]) {
        const a = new THREE.Mesh(arm, pale);
        a.position.set(side * 0.27, 1.45, 0);
        g.add(a);
      }
      g.add(body, head);
    } else {
      const dark = new THREE.MeshStandardMaterial({ color: 0x1b1a1d, roughness: 0.5, emissive: 0x3a0f14, emissiveIntensity: 0.4 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), dark);
      body.scale.set(1.2, 0.55, 1.5);
      body.position.y = 0.55;
      body.name = 'body';
      const ear = new THREE.ConeGeometry(0.28, 0.9, 10, 1, true);
      for (const side of [-1, 1]) {
        const c = new THREE.Mesh(ear, dark);
        c.position.set(side * 0.55, 1.0, -0.4);
        c.rotation.z = side * -0.7;
        g.add(c);
      }
      g.add(body);
    }
    return g;
  }

  private sync<T extends { id: number }>(items: T[], pool: Map<number, THREE.Object3D>, make: (item: T) => THREE.Object3D): void {
    const seen = new Set<number>();
    for (const item of items) {
      seen.add(item.id);
      if (!pool.has(item.id)) {
        const mesh = make(item);
        pool.set(item.id, mesh);
        this.actors.add(mesh);
      }
    }
    for (const [id, mesh] of pool) {
      if (seen.has(id)) continue;
      this.actors.remove(mesh);
      pool.delete(id);
    }
  }

  render(view: ViewState): void {
    if (!this.map) return;
    const cam = view.players.find(p => p.id === view.cameraId);
    const time = performance.now() / 1000;

    this.sync(view.players, this.players, p => this.playerMesh(p));
    for (const p of view.players) {
      const mesh = this.players.get(p.id)!;
      // Hidden bodies are moved out of sight rather than switched off: switching a light off and on makes the
      // graphics card rebuild its shaders, which stutters at exactly the moments someone hides or is caught.
      const shown = p.status === 'active' && p.hiddenIn === null && p.id !== view.cameraId;
      mesh.position.set(p.pos.x, shown ? 0 : -500, p.pos.z);
      mesh.rotation.y = p.yaw;
      mesh.scale.y = p.crouching ? 0.65 : 1;
      (mesh.getObjectByName('lamp') as THREE.SpotLight).intensity = shown && p.flashlight ? 12 : 0;
    }

    this.sync(view.memories, this.memories, m => this.memoryMesh(m));
    for (const m of view.memories) {
      const mesh = this.memories.get(m.id)!;
      mesh.visible = m.state !== 'banked';
      const carrier = m.state === 'carried' ? view.players.find(p => p.id === m.carrier) : undefined;
      if (carrier) {
        // Held out in front of whoever carries it, low enough not to block the view.
        const own = carrier.id === view.cameraId;
        const reach = own ? 0.75 : 0.5;
        mesh.position.set(carrier.pos.x - Math.sin(carrier.yaw) * reach, own ? 0.8 : 0.85, carrier.pos.z - Math.cos(carrier.yaw) * reach);
        mesh.rotation.y = carrier.yaw;
      } else {
        const lift = m.state === 'thrown' ? 0.9 : 0;
        mesh.position.set(m.pos.x, lift, m.pos.z);
      }
      const halo = mesh.getObjectByName('halo') as THREE.Sprite | undefined;
      if (halo) halo.material.opacity = m.state === 'ground' ? 0.32 + Math.sin(time * 2 + m.id) * 0.12 : 0;
    }

    this.sync(view.entities, this.entities, e => this.entityMesh(e));
    for (const e of view.entities) {
      const mesh = this.entities.get(e.id)!;
      mesh.visible = e.active;
      mesh.position.set(e.pos.x, 0, e.pos.z);
      mesh.rotation.y = e.yaw;
      // The Usher always faces whoever is looking.
      if (e.type === 'usher' && cam) mesh.rotation.y = Math.atan2(-(cam.pos.x - e.pos.x), -(cam.pos.z - e.pos.z));
      if (e.type === 'listener') {
        const body = mesh.getObjectByName('body') as THREE.Mesh;
        body.position.y = 0.55 + Math.sin(time * 1.3 + e.id) * 0.06;
        (body.material as THREE.MeshStandardMaterial).emissiveIntensity = e.mode === 'hunt' ? 1.2 + Math.sin(time * 9) * 0.6 : 0.4;
      }
    }

    const leaf = this.dream.getObjectByName('leaf') as THREE.Mesh | undefined;
    if (leaf) (leaf.material as THREE.MeshBasicMaterial).opacity = view.round.doorOpen ? 0.9 : 0.3 + Math.sin(time * 2) * 0.05;

    if (cam) {
      const targetEye = cam.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight;
      this.eye += (targetEye - this.eye) * 0.25;
      // A slight bob with each step.
      if (this.lastCam) this.bob += Math.min(0.5, Math.hypot(cam.pos.x - this.lastCam.x, cam.pos.z - this.lastCam.z));
      this.lastCam = { x: cam.pos.x, z: cam.pos.z };
      const sway = cam.status === 'active' && cam.hiddenIn === null ? Math.sin(this.bob * 4.4) * 0.03 : 0;
      this.camera.position.set(cam.pos.x, this.eye + sway, cam.pos.z);
      this.camera.rotation.set(cam.pitch, cam.yaw, 0);
      this.flashlight.intensity = cam.flashlight && cam.status === 'active' ? 16 : 0;
    }
    this.updateRoomLights(view, time);
    this.gl.render(this.scene, this.camera);
  }

  /** Assigns the pool of real lights to the nearest lit ceiling panels. */
  private updateRoomLights(view: ViewState, time: number): void {
    const phase2 = view.round.phase2;
    this.lightSpots.forEach((spot, i) => {
      // Some lights are dead from the start, leaving pools of dark. In phase 2 most die and the rest flicker.
      const dead = phase2 ? i % 3 !== 0 : i % 3 === 2;
      const flicker = phase2 && Math.sin(time * (7 + (i % 5)) + i * 2.1) > 0.82;
      spot.on = !dead && !flicker;
      (spot.panel.material as THREE.MeshBasicMaterial).color.setHex(spot.on ? 0xfff6dc : 0x2a2820);
    });
    // The dream turns darker and redder as it comes apart.
    this.sky.intensity += ((phase2 ? 0.05 : 0.12) - this.sky.intensity) * 0.02;
    this.sky.color.setHex(phase2 ? 0xff9a7a : 0xfff4d0);
    const here = this.camera.position;
    const nearest = this.lightSpots.filter(s => s.on).sort((a, b) => a.pos.distanceToSquared(here) - b.pos.distanceToSquared(here));
    this.roomLights.forEach((light, i) => {
      const spot = nearest[i];
      light.intensity = spot ? (phase2 ? 8 : 9) : 0;
      if (spot) light.position.copy(spot.pos);
    });
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.clear(this.dream);
    this.clear(this.actors);
    this.gl.dispose();
  }
}
