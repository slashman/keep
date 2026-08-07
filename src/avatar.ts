import * as THREE from 'three';
import { buildPlayerAvatar } from './npc';

// Your body. Hidden for most of play — the camera is in your head — and shown
// for the third-person shots of a portal dive (you watch yourself leap into the
// painting, then watch yourself come out the other side) and for the whole of an
// activity, where the camera sits behind you and you need to see your own feet.

const HIP = 1.2;        // height of the pitch pivot, so a dive tips from the waist
const DIVE_PITCH = 1.2; // radians of forward lean at full stretch
const MID = 1.6;        // roughly mid-body: the point a camera should frame
const STRIDE = 2.15;    // metres per half-cycle — the same cadence the footsteps use

export class PlayerAvatar {
  /** Position (at the feet) and heading. */
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private arms?: { left: THREE.Object3D; right: THREE.Object3D };
  private legs?: { left: THREE.Object3D; right: THREE.Object3D };
  private phase = 0;  // walk cycle, advanced by distance travelled
  private gait = 0;   // 0 standing … 1 striding, eased so the limbs don't snap

  constructor(parent: THREE.Object3D) {
    const body = buildPlayerAvatar();
    body.position.y = -HIP;      // hang the body off the pivot so it tips at the waist
    this.pivot.position.y = HIP;
    this.pivot.add(body);
    this.root.add(this.pivot);
    this.root.visible = false;
    parent.add(this.root);

    const ud = body.userData as {
      arms?: { left: THREE.Object3D; right: THREE.Object3D };
      legs?: { left: THREE.Object3D; right: THREE.Object3D };
    };
    this.arms = ud.arms;
    this.legs = ud.legs;
  }

  /** Put the feet at (x,y,z), facing along `yaw` (0 = looking down +Z). */
  place(x: number, y: number, z: number, yaw: number) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
  }

  /** 0 = standing upright, 1 = full head-first dive, arms stretched ahead. */
  setDive(k: number) {
    this.pivot.rotation.x = k * DIVE_PITCH;
    if (this.arms) {
      // arms swing forward past the head (negative pitches the arm toward +Z)
      this.arms.left.rotation.x = -k * 2.45;
      this.arms.right.rotation.x = -k * 2.45;
    }
    if (this.legs) {
      // legs together, trailing a little behind
      this.legs.left.rotation.x = k * 0.28;
      this.legs.right.rotation.x = k * 0.28;
    }
  }

  /**
   * Walk cycle for third-person play, advanced by distance travelled rather than
   * by time — so it keeps step with the feet at any speed, and stops dead when you
   * do, which a time-driven cycle does not. `airborne` swaps it for a leap pose.
   */
  stride(distance: number, airborne: boolean) {
    if (airborne) {
      this.phase = 0;
      this.pivot.rotation.x = 0.12;             // lean into the jump
      if (this.legs) { this.legs.left.rotation.x = -0.5; this.legs.right.rotation.x = 0.34; }
      if (this.arms) { this.arms.left.rotation.x = 0.7; this.arms.right.rotation.x = 0.7; }
      return;
    }
    this.phase += distance * (Math.PI / STRIDE);
    // Ease the swing in and out rather than snapping the limbs straight the frame
    // you let go of the key — `distance` is per-frame, so it drops to zero at once.
    const want = Math.min(1, distance * 60);
    this.gait += (want - this.gait) * 0.18;
    const s = Math.sin(this.phase) * this.gait * 0.55;
    this.pivot.rotation.x = this.gait * 0.12;   // a slight forward lean while moving
    if (this.legs) { this.legs.left.rotation.x = s; this.legs.right.rotation.x = -s; }
    if (this.arms) { this.arms.left.rotation.x = -s * 0.7; this.arms.right.rotation.x = s * 0.7; }
  }

  /** A point near the middle of the body, for a camera to aim at. */
  midpoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.root.position.x, this.root.position.y + MID, this.root.position.z);
  }

  show() { this.root.visible = true; }
  hide() { this.root.visible = false; }
}
