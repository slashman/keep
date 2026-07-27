import * as THREE from 'three';
import { buildPlayerAvatar } from './npc';

// Your body. Hidden for all of normal play — the camera is in your head — and
// shown only for the third-person shots of a portal dive: you watch yourself
// leap into the painting, then watch yourself come out the other side.

const HIP = 1.2;        // height of the pitch pivot, so a dive tips from the waist
const DIVE_PITCH = 1.2; // radians of forward lean at full stretch
const MID = 1.6;        // roughly mid-body: the point a camera should frame

export class PlayerAvatar {
  /** Position (at the feet) and heading. */
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private arms?: { left: THREE.Object3D; right: THREE.Object3D };
  private legs?: { left: THREE.Object3D; right: THREE.Object3D };

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

  /** A point near the middle of the body, for a camera to aim at. */
  midpoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.root.position.x, this.root.position.y + MID, this.root.position.z);
  }

  show() { this.root.visible = true; }
  hide() { this.root.visible = false; }
}
