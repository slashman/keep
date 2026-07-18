import * as THREE from 'three';

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

/** The walkable area is the union of `regions` (rectangles), minus the `excluders`. */
export interface CollisionWorld {
  regions: Rect[];
  excluders: { x: number; z: number; r: number }[];
}

const EYE_HEIGHT = 1.7;
const SPEED = 4.2;
const SPRINT = 8.4;
const SENS = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.08;

/** Hand-rolled pointer-lock first-person controller (WASD + mouse look + collision). */
export class PlayerControls {
  readonly camera: THREE.PerspectiveCamera;
  private dom: HTMLElement;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private keys = new Set<string>();
  private locked = false;
  enabled = true; // toggled off while a menu/video overlay is open
  world: CollisionWorld = { regions: [{ minX: -5, maxX: 5, minZ: -5, maxZ: 5 }], excluders: [] };
  onLockChange?: (locked: boolean) => void;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChangeEvt);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  get isLocked() { return this.locked; }

  lock() { this.dom.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  /** Place the player and aim along a yaw (radians). */
  setPose(x: number, z: number, yaw: number) {
    this.camera.position.set(x, EYE_HEIGHT, z);
    this.euler.set(0, yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  private onLockChangeEvt = () => {
    this.locked = document.pointerLockElement === this.dom;
    if (!this.locked) this.keys.clear();
    this.onLockChange?.(this.locked);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= e.movementX * SENS;
    this.euler.x -= e.movementY * SENS;
    this.euler.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private onKeyDown = (e: KeyboardEvent) => { this.keys.add(e.code); };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  update(dt: number) {
    if (!this.locked || !this.enabled) return;
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (f === 0 && s === 0) return;

    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? SPRINT : SPEED;
    // horizontal forward/right from current yaw
    this.euler.setFromQuaternion(this.camera.quaternion);
    const yaw = this.euler.y;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // forward = -Z in camera space
    let dx = (-sin * f + cos * s);
    let dz = (-cos * f - sin * s);
    const len = Math.hypot(dx, dz) || 1;
    dx = (dx / len) * speed * dt;
    dz = (dz / len) * speed * dt;

    // Move each axis independently, accepting it only if the destination is
    // walkable. This lets the player slide along walls and pass through the
    // doorways where regions overlap.
    const pos = this.camera.position;
    const nx = pos.x + dx;
    if (this.walkable(nx, pos.z)) pos.x = nx;
    const nz = pos.z + dz;
    if (this.walkable(pos.x, nz)) pos.z = nz;
    pos.y = EYE_HEIGHT;
  }

  private walkable(x: number, z: number): boolean {
    const w = this.world;
    for (const ex of w.excluders) {
      if ((x - ex.x) ** 2 + (z - ex.z) ** 2 < ex.r * ex.r) return false;
    }
    for (const r of w.regions) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
    }
    return false;
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChangeEvt);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
