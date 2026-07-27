import * as THREE from 'three';

// A portal gate: a stone arch set into a wall whose mouth is filled with a
// living, rippling membrane showing where it leads. Walk up to it and jump —
// Super Mario 64 style — and the surface bursts into rings as you are pulled
// through into the room beyond.

const RIPPLE_DUR = 0.85;   // seconds for the entry ripple to cross the surface
const MEMBRANE_Z = 0.10;   // how far the membrane sits proud of the wall face
const RAIL = 0.26;         // thickness of the stone frame rails
const REACH = 0.75;        // how far in front of the membrane the mouth still catches you

export interface PortalGate {
  /** Stable id (project title / 'back') so a gate can be found again after a rebuild. */
  key: string;
  /** The membrane mesh — also the raycast target for the "E to enter" prompt. */
  surface: THREE.Mesh;
  center: THREE.Vector3;
  /** Unit vector pointing out of the gate, into the room. */
  normal: THREE.Vector3;
  /** What happens once the dive completes. */
  enter: () => void;
  /**
   * Disturb the surface. Forward (the default) is an entry: rings race outward
   * and the surface floods with light. `reverse` is an emergence: it starts
   * flooded, and the rings converge back to stillness.
   */
  ripple: (reverse?: boolean) => void;
  update: (t: number) => void;
  /** Is the player's eye inside the gate's mouth? */
  contains: (p: THREE.Vector3) => boolean;
}

export interface GateSpec {
  key: string;
  /** Centre of the opening, on the wall's inner face. */
  x: number; y: number; z: number;
  /** Rotation about Y; the gate faces along +Z in its own space. */
  yaw: number;
  width: number;
  height: number;
  /** What the gate shows. Swapped later (once the real art loads) via `setMap`. */
  map: THREE.Texture;
  tint: THREE.Color;
  /** Draw the glowing leap-from rune on the floor in front. */
  rune?: boolean;
  /**
   * Spill real light into the room. Off by default: a corridor can hold a dozen
   * gates, and every extra point light is another slot in every lit shader on the
   * floor. The membrane is unlit and bright on its own.
   */
  light?: boolean;
  enter: () => void;
}

const VERT = /* glsl */`
  uniform float uTime;
  uniform float uRipple;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec2 c = uv - 0.5;
    float r = length(c) * 2.0;
    // the surface always breathes a little, so it never reads as a flat painting
    float idle = sin(uTime * 1.5 - r * 7.0) * 0.045 * (1.0 - r);
    // …and on entry a wavefront races out from the centre, bulging the membrane.
    // (pow() is undefined for a negative base in GLSL — square by multiplying.)
    float d = r - uRipple * 1.25;
    float env = exp(-(d * 3.0) * (d * 3.0));
    float wave = sin(d * 22.0) * env * uRipple * 0.35;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, 0.0, idle + wave), 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uRipple;
  uniform vec3 uTint;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    // slow liquid shimmer
    vec2 uv = vUv + vec2(sin(vUv.y * 11.0 + uTime * 0.9), cos(vUv.x * 9.0 - uTime * 0.7)) * 0.005;
    // entry rings drag the image outward with them
    float d = r - uRipple * 1.25;
    float env = exp(-(d * 3.0) * (d * 3.0));
    float ring = sin(d * 22.0);
    uv += (c / max(r, 0.001)) * ring * env * uRipple * 0.05;
    vec3 col = texture2D(uMap, clamp(uv, 0.002, 0.998)).rgb;
    col += uTint * abs(ring) * env * uRipple * 0.9;          // crests catch the light
    // a living rim of light licking the inside of the arch
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    col += uTint * (1.0 - smoothstep(0.0, 0.055, edge)) * (0.45 + 0.25 * sin(uTime * 2.2));
    col += uTint * 0.10 * smoothstep(0.86, 1.0, sin((vUv.x + vUv.y) * 3.0 - uTime * 0.8));
    col = mix(col, vec3(1.4), smoothstep(0.55, 1.0, uRipple)); // flood as you pass through
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Build a gate into `parent` and return its handle. */
export function buildPortalGate(parent: THREE.Object3D, spec: GateSpec): PortalGate {
  const { width: W, height: H } = spec;
  const gate = new THREE.Group();
  gate.position.set(spec.x, spec.y, spec.z);
  gate.rotation.y = spec.yaw;
  parent.add(gate);

  // ---- stone arch around the mouth ----
  const stone = new THREE.MeshStandardMaterial({ color: '#2a2110', metalness: 0.5, roughness: 0.35 });
  const rail = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), stone);
    m.position.set(x, y, 0.04);
    gate.add(m);
  };
  rail(W + RAIL * 2, RAIL, 0, H / 2 + RAIL / 2);
  rail(W + RAIL * 2, RAIL, 0, -H / 2 - RAIL / 2);
  rail(RAIL, H, -W / 2 - RAIL / 2, 0);
  rail(RAIL, H, W / 2 + RAIL / 2, 0);
  const keystone = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.44, 0.24), stone);
  keystone.position.set(0, H / 2 + RAIL / 2, 0.05);
  gate.add(keystone);

  // ---- the membrane ----
  const uniforms = {
    uMap: { value: spec.map },
    uTime: { value: 0 },
    uRipple: { value: 0 },
    uTint: { value: spec.tint.clone() },
  };
  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H, 32, 32),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
  );
  surface.position.z = MEMBRANE_Z;
  gate.add(surface);

  // ---- splash rings, fired by the entry ripple ----
  const rings = [0, 0.18].map((delay) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1.0, 48),
      new THREE.MeshBasicMaterial({
        color: spec.tint, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    mesh.position.z = MEMBRANE_Z + 0.06;
    mesh.visible = false;
    gate.add(mesh);
    return { mesh, delay, mat: mesh.material as THREE.MeshBasicMaterial };
  });

  // ---- glow spilling out of the mouth ----
  let light: THREE.PointLight | null = null;
  if (spec.light) {
    light = new THREE.PointLight(spec.tint, 7, 7, 2);
    light.position.set(0, 0, 1.0);
    gate.add(light);
  }

  if (spec.rune) {
    const rune = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.32, 40),
      new THREE.MeshBasicMaterial({
        color: spec.tint, transparent: true, opacity: 0.24, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    rune.rotation.x = -Math.PI / 2;
    rune.position.set(0, 0.03 - spec.y, 0.85); // the group sits at eye-ish height; drop to the floor
    gate.add(rune);
  }

  // ---- the trigger volume, in world space ----
  const normal = new THREE.Vector3(Math.sin(spec.yaw), 0, Math.cos(spec.yaw));
  const center = new THREE.Vector3(spec.x, spec.y, spec.z).addScaledVector(normal, MEMBRANE_Z);
  const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
  const halfW = W / 2 - 0.05;
  const d = new THREE.Vector3();

  let rippleAt: number | null = null;
  let pending: boolean | null = null; // the reverse flag, once a ripple is queued
  let reversed = false;

  return {
    key: spec.key,
    surface,
    center,
    normal,
    enter: spec.enter,
    ripple: (reverse = false) => { pending = reverse; },
    contains: (p) => {
      d.subVectors(p, center);
      const along = d.dot(normal);
      if (along > REACH || along < -0.7) return false;
      if (Math.abs(d.dot(tangent)) > halfW) return false;
      return p.y > spec.y - H / 2 && p.y < spec.y + H / 2;
    },
    update: (t) => {
      uniforms.uTime.value = t;
      if (pending !== null) { reversed = pending; pending = null; rippleAt = t; }
      // k is how far through the disturbance we are; prog is where the wavefront
      // sits, which runs backwards for an emergence.
      const k = rippleAt === null ? 0 : Math.min(1, (t - rippleAt) / RIPPLE_DUR);
      const prog = reversed ? 1 - k : k;
      uniforms.uRipple.value = rippleAt === null ? 0 : prog;
      if (rippleAt !== null && k >= 1) rippleAt = null;

      if (light) light.intensity = 6 + Math.sin(t * 2.2) * 1.6 + (rippleAt === null ? 0 : prog * 26);

      for (const r of rings) {
        const rk = rippleAt === null ? 1 : Math.min(1, Math.max(0, (k - r.delay) / (1 - r.delay)));
        const live = rippleAt !== null && rk > 0 && rk < 1;
        r.mesh.visible = live;
        if (!live) continue;
        // scale follows the wavefront (so it converges when reversed); the fade
        // always follows elapsed time, so a ring never brightens as it dies
        const s = 0.25 + (reversed ? 1 - rk : rk) * (Math.max(W, H) * 0.9);
        r.mesh.scale.set(s, s, 1);
        r.mat.opacity = (1 - rk) * 0.85;
      }
    },
  };
}

/** Swap the art a gate shows once the real image finishes loading. */
export function setGateMap(gate: PortalGate, map: THREE.Texture) {
  const mat = gate.surface.material as THREE.ShaderMaterial;
  const old = mat.uniforms.uMap.value as THREE.Texture | null;
  mat.uniforms.uMap.value = map;
  if (old && old !== map) old.dispose();
}
