import * as THREE from 'three';
import type { Interactable } from './floor';

const RANGE = 4.2;

/** Raycasts from screen-center each frame to find the interactable the player is aiming at. */
export class InteractionManager {
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);
  private camera: THREE.PerspectiveCamera;
  private items: Interactable[] = [];
  private meshToItem = new Map<THREE.Object3D, Interactable>();
  focused: Interactable | null = null;
  onFocusChange?: (item: Interactable | null) => void;
  /**
   * How far the camera currently sits behind the eye. The ray is cast from the
   * camera so the crosshair means what it looks like it means; without this, a
   * chase camera would eat the player's reach from in front of them.
   */
  standOff = 0;
  private highlighted?: THREE.Mesh;
  private prevEmissive = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setItems(items: Interactable[]) {
    this.clearHighlight();
    this.items = items;
    this.meshToItem.clear();
    for (const it of items) this.meshToItem.set(it.mesh, it);
    this.focused = null;
    this.onFocusChange?.(null);
  }

  update() {
    this.raycaster.setFromCamera(this.center, this.camera);
    this.raycaster.far = RANGE + this.standOff;
    const meshes = this.items.map((i) => i.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    const item = hits.length ? this.meshToItem.get(hits[0].object) ?? null : null;
    if (item !== this.focused) {
      this.focused = item;
      this.updateHighlight(item);
      this.onFocusChange?.(item);
    }
  }

  activate(): boolean {
    if (!this.focused) return false;
    this.focused.action();
    return true;
  }

  private updateHighlight(item: Interactable | null) {
    this.clearHighlight();
    if (!item) return;
    const body = item.mesh.userData.pulse as THREE.Mesh | undefined;
    if (body) {
      const mat = body.material as THREE.MeshStandardMaterial;
      this.prevEmissive = mat.emissiveIntensity;
      mat.emissiveIntensity = 0.9;
      this.highlighted = body;
    }
  }

  private clearHighlight() {
    if (this.highlighted) {
      const mat = this.highlighted.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = this.prevEmissive;
      this.highlighted = undefined;
    }
  }
}
