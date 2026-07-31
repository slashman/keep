import * as THREE from 'three';
import type { Project } from './types';
import mikuUrl from './assets/Miku_v5.glb?url';

// Optional 3D centrepiece for a project's room: the thing that stands on the dais
// where the abstract shard otherwise floats.
//
// This is the first content in the app that is *ours* rather than slashie.net's —
// everything else is fetched live (see data.ts) or drawn on a canvas (textures.ts).
// It lives here because the projects.json entries carry no field for it, and it is
// keyed by title because they carry no id either; when they grow one, `modelFor`
// is the only thing that has to change.
//
// The `?url` import above is just a string at runtime — Vite fingerprints the file
// into dist/assets and rewrites the path for the /keep/ base, so nothing is
// downloaded until `loadRoomModel` asks for it. That matters: the model is 5 MB,
// an order of magnitude more than the whole JS bundle.

export interface RoomModelSpec {
  url: string;
  /**
   * Feet-to-crown size to scale the model to, whatever units it was authored in.
   * Note the Keep is built for a giant — EYE_HEIGHT is 2.5 and an NPC stands ~2.9
   * tall — so a human-scale 1.75 reads as a doll here.
   */
  height: number;
  /** Yaw, radians. The room's entrance is at −z, so π faces whoever walks in. */
  yaw?: number;
  /** Turntable spin, radians/second. 0 (the default) keeps it facing the door. */
  spin?: number;
  /** Clip to loop. Falls back to something idle-looking, then to the first clip. */
  clip?: string;
  /** Clips played on top of the main one — a blink/face track, typically. */
  extraClips?: string[];
}

/** Keyed by project title until projects.json entries have ids. */
const BY_TITLE: Record<string, RoomModelSpec> = {
  // Dance_Idle (18.8s) and FaceAnim (19.0s) are the two real loops in this file and
  // were clearly authored together; the clips named like idles are frozen poses.
  'Lake Hamana Cheki Chance! (浜名湖チェキチャンス！)': {
    url: mikuUrl,
    height: 2.7,
    yaw: Math.PI,
    clip: 'Dance_Idle',
    extraClips: ['FaceAnim'],
  },
};

/** The centrepiece for a project's room, if it has one. */
export function modelFor(p: Project): RoomModelSpec | null {
  return BY_TITLE[p.title.trim()] ?? null;
}

export interface LoadedModel {
  /** Holder to park on the dais: already scaled, centred, and stood on its feet. */
  root: THREE.Group;
  /** Advance the animation. `t` is the room's absolute elapsed time. */
  update: (t: number) => void;
  dispose: () => void;
}

/**
 * Fetch and prepare a room's centrepiece. Both the loader and the model itself are
 * pulled in on demand — the GLTFLoader import is dynamic so it lands in its own
 * chunk instead of the startup bundle.
 *
 * Resolves to null on any failure: a room missing its statue is still a room, and
 * this is decoration. There is deliberately no cache of loaded models — reusing a
 * skinned scene means cloning its skeleton, and the room's own `dispose` frees the
 * geometry and textures it holds, which would gut a shared copy. Re-entering a room
 * re-requests the file and the browser serves it from its HTTP cache.
 */
export async function loadRoomModel(spec: RoomModelSpec): Promise<LoadedModel | null> {
  let gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] };
  try {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    gltf = await new GLTFLoader().loadAsync(spec.url);
  } catch (err) {
    console.warn('[roomModel] could not load', spec.url, err);
    return null;
  }

  const model = gltf.scene;
  const root = new THREE.Group();
  root.add(model);

  // ---- fit: scale to `height`, centre on x/z, stand on y = 0 ----
  // Measured in the bind pose, which is close enough for a rough fit; the box has
  // to come after the world matrices are up to date or it comes out empty.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (size.y > 1e-4) model.scale.multiplyScalar(spec.height / size.y);
  root.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const centre = fitted.getCenter(new THREE.Vector3());
  model.position.x -= centre.x;
  model.position.z -= centre.z;
  model.position.y -= fitted.min.y;
  root.rotation.y = spec.yaw ?? 0;

  // Skinned meshes are frustum-culled against their bind-pose bounds, which an
  // animation can leave — a raised arm makes the whole figure blink out at the
  // wrong camera angle. Cheaper to just always draw it.
  model.traverse((o) => { o.frustumCulled = false; });

  // ---- animation ----
  // Not every "animation" in a glTF is one: this model ships four single-frame
  // poses (duration 0) among its clips, and running one of those just freezes the
  // figure in that pose — which looks exactly like a mixer that isn't ticking.
  // So only clips with a duration are ever playable.
  const clips = gltf.animations.filter((c) => c.duration > 0);
  const mixer = clips.length ? new THREE.AnimationMixer(model) : null;
  if (mixer) {
    const byName = (n: string) => clips.find((c) => c.name === n);
    if (spec.clip && !byName(spec.clip)) {
      console.warn(`[roomModel] no playable clip "${spec.clip}" — have:`,
        clips.map((c) => `${c.name} (${c.duration.toFixed(1)}s)`).join(', '));
    }
    const main = (spec.clip ? byName(spec.clip) : undefined)
      ?? clips.find((c) => /idle|iddle/i.test(c.name))
      ?? clips[0];
    // Extra clips ride on top of the main one — a face track drives morph weights,
    // so it blends with a skeletal loop instead of fighting it.
    for (const clip of [main, ...(spec.extraClips ?? []).map(byName)]) {
      if (clip) mixer.clipAction(clip).play();
    }
  }

  const spin = spec.spin ?? 0;
  const baseYaw = root.rotation.y;
  let last: number | null = null;
  return {
    root,
    update: (t: number) => {
      const dt = last === null ? 0 : Math.min(0.05, Math.max(0, t - last));
      last = t;
      mixer?.update(dt);
      if (spin) root.rotation.y = baseYaw + t * spin;
    },
    dispose: () => {
      mixer?.stopAllAction();
      disposeModel(root);
    },
  };
}

/**
 * Free a loaded model. Same job as floor.ts's `disposeObject`, but it also frees
 * the maps a glTF material carries that a canvas-drawn one never has.
 */
function disposeModel(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh & { skeleton?: THREE.Skeleton };
    mesh.geometry?.dispose();
    mesh.skeleton?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      for (const value of Object.values(m as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      m.dispose();
    }
  });
}
