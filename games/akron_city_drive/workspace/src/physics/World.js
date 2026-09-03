// Rapier physics world, static colliders, vehicle body rebuild.
//
// Ported from the inline physics section of main.js. The public surface
// matches the old function names so callers don't change.
//
// A handful of functions need references that only exist later in the
// bootstrap sequence (the surface-height raycaster, the spawn anchor
// resolver, the runtime-instantiated vehicle controllers, and the per-vehicle
// wheel layout). Those are injected via `configurePhysics({...})` which
// main.js calls once during bootstrap.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { buildWheelAnchors } from "../vehicle/VehicleConfig.js";
import { createWheelRig } from "../vehicle/WheelRig.js";
import { physics, assets, state, audioState } from "../core/state.js";
import { FIXED_TIMESTEP, MAIN_MENU_SPAWN } from "../core/config.js";
import { vectorFromData, quaternionFromData } from "../core/utils.js";
import { scene, world } from "../scene/World.js";

// --- Injected dependencies (main.js still owns these) ----------------------

let _rootAssetUrl = (rel) => rel;
let _getMenuSurfaceHeight = () => NaN;
let _getGameplaySpawnAnchor = () => null;
let _currentVehicleLayout = () => null;
let _currentVehicleDynamics = () => null;
let _vehiclePhysicsController = null;
let _vehicleVisualController = null;

export function configurePhysics({
  rootAssetUrl,
  getMenuSurfaceHeight,
  getGameplaySpawnAnchor,
  currentVehicleLayout,
  currentVehicleDynamics,
  vehiclePhysicsController,
  vehicleVisualController
}) {
  if (rootAssetUrl) _rootAssetUrl = rootAssetUrl;
  if (getMenuSurfaceHeight) _getMenuSurfaceHeight = getMenuSurfaceHeight;
  if (getGameplaySpawnAnchor) _getGameplaySpawnAnchor = getGameplaySpawnAnchor;
  if (currentVehicleLayout) _currentVehicleLayout = currentVehicleLayout;
  if (currentVehicleDynamics) _currentVehicleDynamics = currentVehicleDynamics;
  if (vehiclePhysicsController) _vehiclePhysicsController = vehiclePhysicsController;
  if (vehicleVisualController) _vehicleVisualController = vehicleVisualController;
}

// --- World / particle / audio init -----------------------------------------

export async function initPhysics() {
  if (physics.ready) return;
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("using deprecated parameters for the initialization function")
    ) {
      return;
    }
    originalWarn(...args);
  };
  try {
    await RAPIER.init();
  } finally {
    console.warn = originalWarn;
  }
  physics.world = new RAPIER.World({ x: 0, y: -26, z: 0 });
  physics.world.integrationParameters.dt = FIXED_TIMESTEP;
  physics.eventQueue = new RAPIER.EventQueue(true);
  physics.staticBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const spriteLoader = new THREE.TextureLoader();
  const sparksGeometry = new THREE.BufferGeometry();
  sparksGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const sparksMaterial = new THREE.PointsMaterial({
    map: spriteLoader.load(
      _rootAssetUrl("Realistic Car Controller Pro/Textures/Particles/Spark1.png")
    ),
    color: 0xffc862,
    size: 12,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false  // fixed screen-space size — prevents giant billboard at close range
  });
  physics.sparks = new THREE.Points(sparksGeometry, sparksMaterial);
  scene.add(physics.sparks);

  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const smokeMaterial = new THREE.PointsMaterial({
    map: spriteLoader.load(
      _rootAssetUrl("Realistic Car Controller Pro/Textures/Particles/SmokeSprite.png")
    ),
    color: 0x858585,
    size: 36,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: false  // fixed screen-space size — prevents giant billboard at close range
  });
  physics.smoke = new THREE.Points(smokeGeometry, smokeMaterial);
  scene.add(physics.smoke);

  const skidPositions = new Float32Array(1200 * 6);
  const skidGeometry = new THREE.BufferGeometry();
  skidGeometry.setAttribute("position", new THREE.BufferAttribute(skidPositions, 3));
  skidGeometry.setDrawRange(0, 0);
  const skidMaterial = new THREE.LineBasicMaterial({
    color: 0x181818,
    transparent: true,
    opacity: 0.34
  });
  physics.skidMarks = new THREE.LineSegments(skidGeometry, skidMaterial);
  scene.add(physics.skidMarks);

  [
    "https://static.seeles.ai/data/upload/51193501-9608-4d40-96a1-24234338da85_Impact2.wav",
    "https://static.seeles.ai/data/upload/49e20e79-ff5b-4ed3-9533-866891afcea2_Impact3.wav",
    "https://static.seeles.ai/data/upload/f0295d85-5009-4b65-b54d-9c7df3ca9710_Impact4.wav",
    "https://static.seeles.ai/data/upload/142bd51b-c4cb-475e-b869-40b6568bc6b5_Impact5.wav"
  ].forEach((relativePath) => {
    const audio = new Audio(_rootAssetUrl(relativePath));
    audio.preload = "auto";
    audioState.impact.push(audio);
  });

  const looped = (relativePath, volume = 0) => {
    const audio = new Audio(_rootAssetUrl(relativePath));
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = volume;
    return audio;
  };
  audioState.engineIdle = looped(
    "https://static.seeles.ai/data/upload/2f2ef76b-66ce-4a2b-ac85-8e5249546dc9_Engine_Generic_Idle.wav",
    0.18
  );
  audioState.engineLow = looped(
    "https://static.seeles.ai/data/upload/6a8f2eb7-56f1-419a-b9bd-3ae4e47c7069_Engine_Generic_Low.wav",
    0
  );
  audioState.engineMed = looped(
    "https://static.seeles.ai/data/upload/67a8c868-e8ab-4f66-a932-36e644c5aa4e_Engine_Generic_Med.wav",
    0
  );
  audioState.skid = looped("https://static.seeles.ai/data/upload/4e2d4254-5e1d-4ab0-9bd2-a26cd8d7724f_Skid_Asphalt.wav", 0);

  // Phase 1d: additional audio assets
  audioState.engineHigh = looped(
    "https://static.seeles.ai/data/upload/df94cf1a-1c1a-4915-b404-2302a593147c_Engine_Generic_High.wav",
    0
  );

  // Gearbox shift sounds (round-robin)
  [
    "https://static.seeles.ai/data/upload/543b8572-0758-46cb-94e2-290a170691fe_Gearbox_Shifting1.WAV",
    "https://static.seeles.ai/data/upload/20027371-c9d8-4e52-bae1-3139254f03e1_Gearbox_Shifting2.WAV",
    "https://static.seeles.ai/data/upload/b3f27519-bd4e-48c0-9bf7-ca592f60c7c6_Gearbox_Shifting3.WAV",
    "https://static.seeles.ai/data/upload/263ae228-f157-4fa0-b41e-4b808fda9133_Gearbox_Shifting4.WAV",
    "https://static.seeles.ai/data/upload/18685bc4-0561-40b5-b0d4-8c2e15450c36_Gearbox_Shifting5.WAV"
  ].forEach((relativePath) => {
    const audio = new Audio(_rootAssetUrl(relativePath));
    audio.preload = "auto";
    audioState.gearShift.push(audio);
  });
  audioState.gearReverse = new Audio(_rootAssetUrl("https://static.seeles.ai/data/upload/07306788-ea55-4ce1-9ac1-34819a1e74d6_Gearbox_Reverse.wav"));
  audioState.gearReverse.preload = "auto";

  // Turbo blow-off (one-shot) + spool (loop)
  audioState.turboBlow = [
    new Audio(_rootAssetUrl("https://static.seeles.ai/data/upload/b3f1e888-7055-484d-b697-aefffc5088d9_Turbo_Blow1.wav")),
    new Audio(_rootAssetUrl("https://static.seeles.ai/data/upload/58ba9ae2-8d87-492e-869c-ad4c8bdf511b_Turbo_Blow2.wav"))
  ];
  audioState.turboBlow.forEach((a) => { a.preload = "auto"; });
  audioState.turboSpool = looped("https://static.seeles.ai/data/upload/3eba318c-23b8-4ddf-8a1d-861e149dc999_Turbo_Fs.WAV", 0);

  // NOS loop
  audioState.nos = looped("https://static.seeles.ai/data/upload/ae607440-637b-45ce-b5c8-d1b4aae900f9_Vehicle_NOS.wav", 0);

  // Brakes
  audioState.brakes = looped("https://static.seeles.ai/data/upload/1be59824-9a11-459f-b6b5-d717d3b5acc6_Vehicle_Brakes.wav", 0);

  // Wind (speed-dependent loop)
  audioState.wind = looped("https://static.seeles.ai/data/upload/b401b01d-2388-4185-9bf2-fad6c1c3a654_Vehicle_Wind.wav", 0);

  // Exhaust fire pops (one-shot, on downshift)
  [
    "https://static.seeles.ai/data/upload/0900ae90-520c-4a53-b985-bc5d647bc2f0_Exhaust_Fire1.wav",
    "https://static.seeles.ai/data/upload/17f3cdfe-a806-440b-845c-16466f9f6f63_Exhaust_Fire2.wav",
    "https://static.seeles.ai/data/upload/1a661c87-d35f-4413-ae52-27b03bba1efd_Exhaust_Fire3.wav",
    "https://static.seeles.ai/data/upload/65de811a-5e1e-4b58-bab7-386a7d262831_Exhaust_Fire4.wav"
  ].forEach((relativePath) => {
    const audio = new Audio(_rootAssetUrl(relativePath));
    audio.preload = "auto";
    audioState.exhaustFire.push(audio);
  });

  // CCDS-specific audio
  audioState.policeSiren = looped("https://static.seeles.ai/data/upload/b6db0437-57ab-4bbb-95ca-ae64002e51a6_CCDS_Audio_PoliceSiren.wav", 0);
  audioState.cash = new Audio(_rootAssetUrl("https://static.seeles.ai/data/upload/bbafb1db-829a-45ae-a7a1-f784c2146bcd_CCDS_Audio_Cash.wav"));
  audioState.cash.preload = "auto";
  audioState.uiClick = new Audio(_rootAssetUrl("https://static.seeles.ai/data/upload/11050273-6455-4836-928d-f1cf5aaa7ce4_CCDS_Audio_UIButtonClick.wav"));
  audioState.uiClick.preload = "auto";

  // Background music
  audioState.music[0] = looped("https://static.seeles.ai/data/upload/dd544187-1792-4177-a81c-d503c3fd0f74_CCDS_Music_01.wav", 0);
  audioState.music[1] = looped("https://static.seeles.ai/data/upload/daec304f-544b-4c5d-b4ec-6b360139d01a_CCDS_Music_02.wav", 0);

  physics.ready = true;
}

// --- Static collider management --------------------------------------------

// Collision / solver group bits. The chassis collider lives in its own bit
// so the ground-grid trimesh can exclude CONTACT SOLVING specifically with
// the chassis, while still being found by wheel raycasts and still
// reporting contact events for diagnostics.
//
// Motivation (Phase 1c debugging): `addGameplayGroundGrid` is capped at
// 96×96 cells, giving ~20–40 m per cell on a full-city scene. Whenever two
// neighbouring cells sample different heights (e.g. the `maxDropFromTop:8`
// window lets one vertex land on a rooftop while its neighbour lands on
// the road below), the triangulation between them becomes a near-vertical
// wall. Wheels correctly ride the flat pad below, but at ~18 m/s the
// chassis cuboid slams into that wall — symptom: sudden velocity drop
// from 18→5 m/s, `chassisContacts=[trimesh]`, car wedged at a specific
// X/Z and unable to move. Buildings are represented by separate
// `obstacle` cuboids, so skipping chassis↔trimesh contact solving does
// not allow the car to drive through structures.
const GROUP_CHASSIS = 0x0004;
export const GROUP_NPC = 0x0008;
const GROUPS_ALL = 0xffff;
// Chassis: membership = its own bit, filter = everything (solves with
// obstacles, pad, deepfloor — all of which use default groups 0xffff).
const GROUPS_CHASSIS = ((GROUP_CHASSIS & GROUPS_ALL) << 16) | GROUPS_ALL;
// Trimesh: membership = everything (so wheel raycasts / queries still
// find it), filter excludes the chassis bit so the solver never produces
// a contact manifold between trimesh triangles and the chassis cuboid.
const GROUPS_TRIMESH_NO_CHASSIS =
  ((GROUPS_ALL & GROUPS_ALL) << 16) | (GROUPS_ALL & ~GROUP_CHASSIS);
// NPC traffic vehicles: membership = GROUP_NPC, filter = GROUP_CHASSIS only.
// Solves contacts with the player chassis but not with other NPCs or static scene.
export const GROUPS_NPC = ((GROUP_NPC & GROUPS_ALL) << 16) | GROUP_CHASSIS;

export function clearScenePhysics() {
  if (!physics.ready) return;
  physics.staticColliders.forEach((collider) => physics.world.removeCollider(collider, false));
  physics.staticColliders = [];
  physics.staticColliderLabels.clear();
  physics.sceneReady = false;
}

export function addStaticCuboid(center, halfExtents, label = "cuboid") {
  if (!physics.ready) return;
  const collider = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z)
      .setContactSkin(0.02)
      .setFriction(1.1)
      .setRestitution(0.05),
    physics.staticBody
  );
  physics.staticColliders.push(collider);
  physics.staticColliderLabels.set(collider.handle, label);
}

export function addStaticTrimesh(
  vertices,
  indices,
  label = "trimesh",
  { excludeChassis = false } = {}
) {
  if (!physics.ready || !vertices?.length || !indices?.length) return;
  let desc = RAPIER.ColliderDesc.trimesh(
    vertices,
    indices,
    RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES
  )
    .setContactSkin(0.02)
    .setFriction(1.1)
    .setRestitution(0.05);
  if (excludeChassis) {
    // Ground-grid only: see GROUPS_TRIMESH_NO_CHASSIS comment. Wheel
    // raycasts still find this trimesh (queries use collisionGroups,
    // which we leave at default), but the solver never creates
    // chassis↔trimesh contact manifolds, preventing the car from
    // hitting invisible walls between neighbouring trimesh cells.
    // Obstacle-wall trimeshes leave this off so the chassis collides
    // normally with buildings.
    desc = desc.setSolverGroups(GROUPS_TRIMESH_NO_CHASSIS);
  }
  const collider = physics.world.createCollider(desc, physics.staticBody);
  physics.staticColliders.push(collider);
  physics.staticColliderLabels.set(collider.handle, label);
}

// Build a Rapier trimesh collider from an actual Three.js mesh's
// triangles, baked into world space. Unlike `addStaticCuboid` (which
// wraps a mesh in its axis-aligned bounding box), this preserves the
// exact wall shape — long, rotated, or curved walls all collide at
// their real triangles instead of at a fat bounding volume that either
// engulfs neighbouring roads or under-covers the wall itself.
//
// Used for building / wall obstacles and for drivable ground surfaces.
// Not used for the (legacy) coarse ground height-grid — that caller
// synthesizes its own vertex array via addGameplayGroundGrid.
//
// Set `excludeChassis: true` to route the resulting trimesh through
// the GROUPS_TRIMESH_NO_CHASSIS solver group so the chassis cuboid
// never produces contact manifolds with it (wheels still raycast-hit
// it normally because collisionGroups are left at default). Used for
// ground trimeshes so the chassis hovers on wheels and never snags
// on real road bumps — preserves the Phase 1c pad-era behavior.
function addStaticMeshTrimesh(mesh, label = "obstacle", { excludeChassis = false } = {}) {
  if (!physics.ready || !mesh?.geometry) return false;
  const position = mesh.geometry.attributes?.position;
  if (!position || position.count < 3) return false;

  // World-space vertex bake. We attach to `physics.staticBody` (the
  // fixed body at the origin), so every vertex has to be expressed in
  // world coordinates. `mesh.updateWorldMatrix(true, false)` is
  // called upstream in addObstacleTrimeshes before we get here.
  const matrix = mesh.matrixWorld;
  const vertexCount = position.count;
  const vertices = new Float32Array(vertexCount * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    tmp.fromBufferAttribute(position, i).applyMatrix4(matrix);
    vertices[i * 3] = tmp.x;
    vertices[i * 3 + 1] = tmp.y;
    vertices[i * 3 + 2] = tmp.z;
  }

  // Rapier's WASM trimesh constructor crashes on NaN/Infinity vertices
  // (degenerate geometry from broken FBX, zero-scale transforms, or
  // singular matrices). Sanitize to 0 so the mesh still produces a
  // valid collider rather than throwing and aborting the traversal.
  let sanitizedCount = 0;
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(vertices[i])) {
      vertices[i] = 0;
      sanitizedCount++;
    }
  }
  if (sanitizedCount > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[addStaticMeshTrimesh] sanitized ${sanitizedCount} NaN/Infinity vertex components in "${label}" (mesh: ${mesh.name || "unnamed"})`
    );
  }

  // Indexed vs non-indexed: Rapier wants a flat Uint32Array of
  // triangle indices. If the mesh has no index, triangles are implicit
  // (every 3 consecutive vertices is a triangle) — synthesize a
  // matching identity index.
  let indices;
  const indexAttr = mesh.geometry.index;
  if (indexAttr) {
    indices = new Uint32Array(indexAttr.count);
    for (let i = 0; i < indexAttr.count; i++) indices[i] = indexAttr.getX(i);
  } else {
    const triVertexCount = vertexCount - (vertexCount % 3);
    indices = new Uint32Array(triVertexCount);
    for (let i = 0; i < triVertexCount; i++) indices[i] = i;
  }
  if (indices.length < 3) return false;

  // CRITICAL: the city FBX scene uses a negative X scale
  // (CITY_WORLD_SCALE_VECTOR = (-0.02, 0.02, 0.02)) for Unity→Three.js
  // coordinate conversion. A negative scale gives the matrixWorld a
  // negative determinant, which flips ALL triangle winding orders.
  // Rapier derives contact normals from winding — with flipped winding,
  // normals point inward instead of outward. The collision solver then
  // pushes the car INTO walls/ground instead of away. This is the root
  // cause of wall penetration, terrain fall-through, and getting stuck
  // inside walls. Fix: swap two vertices per triangle to restore the
  // original winding when the transform has negative determinant.
  if (matrix.determinant() < 0) {
    for (let i = 0; i < indices.length - 2; i += 3) {
      const tmp = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = tmp;
    }
  }

  addStaticTrimesh(vertices, indices, label, { excludeChassis });
  return true;
}

// Denser grid = smaller per-cell height quantization. Each cell's top is
// fixed at its center raycast, so neighbors with different heights create
// invisible steps — shrinking the cell reduces how high those steps are.
// Cap at 640 cells so a large city still fits under the solver budget.
//
// Cell halfExtent is slightly less than half the step so neighbours tile
// *without overlap*. Overlapping cells on uneven ground cause the taller
// one to "win" everywhere it overlaps, creating phantom cliffs the car
// falls off; butted cells keep each cell strictly over its own footprint.
const GROUND_GRID_HALF_HEIGHT = 3.2;  // thick enough to fully bury the base

export function addGameplayGroundGrid(bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  const resolutionX = THREE.MathUtils.clamp(Math.ceil(size.x / 3), 28, 96);
  const resolutionZ = THREE.MathUtils.clamp(Math.ceil(size.z / 3), 28, 96);
  const vertexCountX = resolutionX + 1;
  const vertexCountZ = resolutionZ + 1;
  const vertices = new Float32Array(vertexCountX * vertexCountZ * 3);
  const heights = new Array(vertexCountX * vertexCountZ).fill(Number.NaN);
  const indices = new Uint32Array(resolutionX * resolutionZ * 6);
  const topY = bounds.max.y + 250;
  const indexOf = (ix, iz) => iz * vertexCountX + ix;

  for (let iz = 0; iz < vertexCountZ; iz++) {
    const z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, iz / resolutionZ);
    for (let ix = 0; ix < vertexCountX; ix++) {
      const x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, ix / resolutionX);
      const index = indexOf(ix, iz);
      const y = _getMenuSurfaceHeight(new THREE.Vector3(x, topY, z), {
        lowestHit: true,
        // 8 m = the largest plausible vertical gap between a rooftop and
        // the road underneath it. Anything deeper than that is basement /
        // hidden terrain-plane geometry, which must NOT be sampled or the
        // whole trimesh sits tens of metres beneath the drivable surface
        // and the wheel raycasts (only 0.6 m of travel) never reach it.
        maxDropFromTop: 8
      });
      heights[index] = y;  // NaN stays NaN — fixed in two fill passes below
      const base = index * 3;
      vertices[base] = x;
      vertices[base + 1] = Number.isFinite(y) ? y : 0;  // placeholder
      vertices[base + 2] = z;
    }
  }

  // Compute a safe fallback Y to use when neither Pass 1 nor Pass 2 can
  // find a sampled neighbour. Using `bounds.min.y` (as the original code
  // did) drops unreachable cells tens of metres below the drivable
  // surface, producing giant cliffs at cell boundaries — once the car
  // drives off one of those edges its wheel raycast (~0.5 m reach) can
  // never find ground again. The median of valid samples is a much better
  // default: for a roughly flat city it lands near road level, so even a
  // "filled" cell stays within wheel-travel range of its neighbours.
  const validHeights = heights.filter((h) => Number.isFinite(h));
  let fallbackY = bounds.min.y;
  if (validHeights.length > 0) {
    const sorted = validHeights.slice().sort((a, b) => a - b);
    fallbackY = sorted[Math.floor(sorted.length / 2)];
  }

  // Pass 1 (left-to-right, top-to-bottom): fill NaN vertices with nearest
  // left / upper neighbour so the surface extends across unsampled areas.
  for (let iz = 0; iz < vertexCountZ; iz++) {
    for (let ix = 0; ix < vertexCountX; ix++) {
      const idx = indexOf(ix, iz);
      if (Number.isFinite(heights[idx])) continue;
      const left = ix > 0 ? heights[indexOf(ix - 1, iz)] : Number.NaN;
      const up   = iz > 0 ? heights[indexOf(ix, iz - 1)] : Number.NaN;
      const fill = Number.isFinite(left) ? left : (Number.isFinite(up) ? up : Number.NaN);
      if (Number.isFinite(fill)) {
        heights[idx] = fill;
        vertices[idx * 3 + 1] = fill;
      }
    }
  }
  // Pass 2 (right-to-left, bottom-to-top): catch any still-NaN spots that
  // had no left/up neighbour with a value (e.g., entire top-left corner).
  for (let iz = vertexCountZ - 1; iz >= 0; iz--) {
    for (let ix = vertexCountX - 1; ix >= 0; ix--) {
      const idx = indexOf(ix, iz);
      if (Number.isFinite(heights[idx])) continue;
      const right = ix < vertexCountX - 1 ? heights[indexOf(ix + 1, iz)] : Number.NaN;
      const down  = iz < vertexCountZ - 1 ? heights[indexOf(ix, iz + 1)] : Number.NaN;
      const fill = Number.isFinite(right) ? right : (Number.isFinite(down) ? down : fallbackY);
      heights[idx] = fill;
      vertices[idx * 3 + 1] = fill;
    }
  }

  let cursor = 0;
  for (let iz = 0; iz < resolutionZ; iz++) {
    for (let ix = 0; ix < resolutionX; ix++) {
      const a = indexOf(ix, iz);
      const b = indexOf(ix + 1, iz);
      const c = indexOf(ix, iz + 1);
      const d = indexOf(ix + 1, iz + 1);
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  addStaticTrimesh(vertices, indices, "trimesh", { excludeChassis: true });
}

// Build Rapier trimesh colliders for EVERY mesh in the loaded city
// scene. No classification, no `excludeChassis` gating — every mesh
// becomes a normal chassis-solving trimesh collider, matching Unity's
// authentic behavior where every CCDS FBX piece gets a MeshCollider
// and the rigidbody chassis collides with all of them.
//
// Why no classification: prior iterations tried to split meshes into
// "ground" (chassis-excluded) vs "obstacle" (chassis-solving) using
// (a) AABB y_extent size, (b) a material-name allowlist, or both.
// Both heuristics were brittle:
//
//   - Walls with generic material names ("material", "plane") were
//     treated as ground → chassis phased straight through (symptom:
//     "clip through walls")
//   - Road/sidewalk meshes with a tall retaining curb or ramp
//     meshes with non-trivial y_extent got treated as obstacles →
//     chassis hit the road itself as an invisible wall (symptom:
//     "suddenly stuck" after driving a while)
//
// The chassis cuboid is raised above wheel hardpoints in
// rebuildVehiclePhysics (bottomLocalY > hardPointLocalY + 0.05), so
// on flat ground it naturally floats ~0.6 m above the road surface
// and only contacts geometry tall enough to reach it — no artificial
// "ground-means-skip-contact" rule needed. Curb-apex contact IS what
// Unity does.
//
// `excludeChassis: true` is still used by the legacy synthetic
// `addGameplayGroundGrid` (menu mode), which has artificial
// cell-boundary walls that a real chassis would falsely collide
// with. Real FBX meshes don't have that problem and don't need it.
//
// Flat catch-plane for gameplay mode: a single horizontal trimesh placed
// just below the median drivable surface. Unlike the ground height-grid,
// this has no cell-boundary walls — just one flat surface. Wheel raycasts
// can fall back to it through small gaps in FBX mesh coverage.
// Uses excludeChassis solver groups so the chassis never interacts with it.
function addGameplayCatchPlane(bounds) {
  if (!physics.ready) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  // Sample a 5x5 grid of points to find the median road surface height.
  const sampleHeights = [];
  const topY = bounds.max.y + 250;
  for (let iz = 0; iz < 5; iz++) {
    const z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, (iz + 0.5) / 5);
    for (let ix = 0; ix < 5; ix++) {
      const x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, (ix + 0.5) / 5);
      const y = _getMenuSurfaceHeight(new THREE.Vector3(x, topY, z), {
        lowestHit: true,
        maxDropFromTop: 8
      });
      if (Number.isFinite(y)) sampleHeights.push(y);
    }
  }

  let planeY;
  if (sampleHeights.length > 0) {
    const sorted = sampleHeights.slice().sort((a, b) => a - b);
    planeY = sorted[Math.floor(sorted.length / 2)] - 0.3;
  } else {
    planeY = bounds.min.y + 1;
  }

  // Two-triangle flat quad routed through addStaticTrimesh so it gets
  // the excludeChassis solver group (wheel raycasts find it, chassis
  // solver ignores it).
  const hw = size.x * 0.55;
  const hd = size.z * 0.55;
  const vertices = new Float32Array([
    center.x - hw, planeY, center.z - hd,
    center.x + hw, planeY, center.z - hd,
    center.x + hw, planeY, center.z + hd,
    center.x - hw, planeY, center.z + hd
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

  addStaticTrimesh(vertices, indices, "catchplane", { excludeChassis: true });
}

// Labels kept as "obstacle" (singular label) so the existing
// RCCPCarController `chassisContacts=[obstacle]` diagnostic at
// src/vehicle/RCCPCarController.js:362 still prints meaningful data.
function addSceneTrimeshes() {
  let accepted = 0;
  let rejectedByGeometry = 0;
  let rejectedByWasm = 0;
  const samples = [];
  const box = new THREE.Box3();
  const meshSize = new THREE.Vector3();
  assets.menuScene.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    child.updateWorldMatrix(true, false);
    box.setFromObject(child);
    if (!Number.isFinite(box.min.x)) return;
    box.getSize(meshSize);

    try {
      if (addStaticMeshTrimesh(child, "obstacle", { excludeChassis: false })) {
        accepted += 1;
        if (samples.length < 20) {
          samples.push(
            `${child.name || "?"}(y=${meshSize.y.toFixed(2)},xz=${Math.max(meshSize.x, meshSize.z).toFixed(1)})`
          );
        }
      } else {
        rejectedByGeometry += 1;
      }
    } catch (err) {
      rejectedByWasm += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[ScenePhysics] trimesh creation failed for "${child.name || "unnamed"}" — skipping.`,
        err?.message || err
      );
    }
  });
}

export function buildScenePhysics(mode = state.route === "game" ? "ground" : "full") {
  if (!physics.ready || !assets.menuScene) return;
  if (physics.sceneReady && physics.sceneColliderMode === mode) return;
  clearScenePhysics();
  assets.menuScene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(assets.menuScene);
  if (!Number.isFinite(bounds.min.x)) return;
  physics.sceneBounds = { min: bounds.min.clone(), max: bounds.max.clone() };

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  // Deep floor catch-all: prevents objects from falling to infinity if
  // they slip past the surface trimesh (e.g., at scene boundaries). Keep
  // it THIN and well below the bounds floor — a fat deep-floor can engulf
  // wheel raycast hardpoints if the spawn ends up near bounds.min.y, and
  // Rapier will then return distance-0 contacts for every wheel.
  addStaticCuboid(
    new THREE.Vector3(center.x, bounds.min.y - 12, center.z),
    new THREE.Vector3(size.x * 0.55, 0.5, size.z * 0.55),
    "deepfloor"
  );

  // Synthesized ground height-grid trimesh — MENU MODE ONLY.
  // In gameplay mode, the grid creates near-vertical wall faces between
  // cells at different heights (road vs rooftop). Wheel raycasts hit
  // those near-vertical surfaces and receive near-horizontal contact
  // normals. Suspension force pushes sideways instead of upward, causing
  // the car to nose-dive. The original code intentionally disabled the
  // grid in gameplay mode for this exact reason.
  if (mode !== "ground") {
    addGameplayGroundGrid(bounds);
  }

  // In gameplay mode, use a flat catch-plane for gap coverage instead
  // of the height grid. No vertical faces → no nose-dive.
  if (mode === "ground") {
    addGameplayCatchPlane(bounds);
  }

  // Per-mesh trimeshes for the entire city scene — one Rapier trimesh
  // collider per FBX child mesh, classified as ground (wheel-only) or
  // obstacle (chassis solves). Replaces the old AABB-cuboid obstacle
  // pipeline AND the scene-wide flat `pad` slab. See
  // `addSceneTrimeshes` for the classification rules and rationale.
  //
  // Spawn exclusion is intentionally gone. With trimesh (surface)
  // colliders rather than volumetric AABBs, there is nothing for the
  // wheel hardpoint to be "inside of", so the `t=0` raycast workaround
  // the old exclusion box was guarding against no longer applies.
  addSceneTrimeshes();

  // Spawn anchor for the diagnostic log at the end.
  const spawnAnchor =
    state.route === "game"
      ? state.game.spawnPosition?.clone?.() || _getGameplaySpawnAnchor()
      : MAIN_MENU_SPAWN.clone();
  const spawnSurfaceY = _getMenuSurfaceHeight(spawnAnchor);

  physics.sceneReady = true;
  physics.sceneColliderMode = mode;
}

// --- Vehicle body rebuild / sync -------------------------------------------

export function rebuildWheelAnchors() {
  physics.wheelAnchors = buildWheelAnchors(_currentVehicleLayout(), {
    vectorFromData,
    quaternionFromData,
    identityQuaternion: () => new THREE.Quaternion()
  });
}

export function rebuildVehiclePhysics() {
  if (!physics.ready || !assets.car) return;
  // eslint-disable-next-line no-console
  console.warn(`[rebuildVehiclePhysics] called`, new Error("rebuild call site").stack);
  if (physics.wheelRig) {
    physics.wheelRig.dispose?.();
    physics.wheelRig = null;
  }
  if (physics.carCollider) physics.world.removeCollider(physics.carCollider, true);
  if (physics.carBody) physics.world.removeRigidBody(physics.carBody);

  assets.car.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(assets.car);
  if (!Number.isFinite(box.min.x)) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  physics.carHalfExtents.set(
    Math.max(0.7, size.x * 0.34),
    Math.max(0.35, size.y * 0.28),
    Math.max(1.1, size.z * 0.36)
  );
  physics.carOffset.copy(center).sub(world.carPivot.position);

  // Phase 1b: the body was previously locked to yaw-only rotation so the
  // kinematic 1D speed scalar in VehiclePhysicsController stayed upright.
  // Rapier's wheel rig needs full 3-DOF rotation so suspension reaction
  // torques can produce pitch/roll as the car lands / corners / climbs.
  const dynamics = _currentVehicleDynamics() || null;
  const mass = dynamics?.rigidbody?.mass ?? 950;
  const linearDamping = dynamics?.rigidbody?.drag ?? 0.12;
  const angularDamping = dynamics?.rigidbody?.angularDrag ?? 0.9;

  // CRITICAL: the chassis cuboid collider must NOT contain the wheel
  // hard-points, because Rapier's DynamicRayCastVehicleController (derived
  // from Bullet's btRaycastVehicle) starts its internal suspension raycast
  // AT the hard-point. If that origin is inside the chassis collider, the
  // filter that excludes "own colliders" kicks in for the entire start —
  // Bullet silently returns the "no contact" sentinel (suspensionLength =
  // -radius, contactPoint = hardPoint) and the wheel never feels the
  // ground. Observed symptom: `cpY == hpY`, `len = -radius`, F stuck at a
  // constant value, car pitches wildly because only the chassis cuboid
  // touches ground and it supports nothing.
  //
  // Wheel hard-point local Y = `wheel.position.y + suspensionDistance`
  // (see WheelRig.js:createWheelRig), e.g. Coupe: -0.239 + 0.2 = -0.039.
  // We require `chassisBottomLocalY > hardPointLocalY + 0.25` and raise
  // `carOffset.y` to satisfy it. This shifts the collider up in the body
  // frame without touching its extents, so the visual footprint stays the
  // same but the raycast origin is always above it. The 0.25m margin
  // (raised from 0.05m) ensures the chassis clears ground-level mesh
  // seams and curb edges that would otherwise snag the collider and
  // flip the car vertically.
  if (Array.isArray(dynamics?.wheels) && dynamics.wheels.length > 0) {
    const hardpointMaxLocalY = dynamics.wheels.reduce((m, w) => {
      const hp = (w.position?.y ?? 0) + (w.suspensionDistance ?? 0.2);
      return Math.max(m, hp);
    }, -Infinity);
    const minBottomLocalY = hardpointMaxLocalY + 0.25;
    const currentBottomLocalY = physics.carOffset.y - physics.carHalfExtents.y;
    if (currentBottomLocalY < minBottomLocalY) {
      physics.carOffset.y += (minBottomLocalY - currentBottomLocalY);
    }
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[ChassisCollider] halfY=${physics.carHalfExtents.y.toFixed(3)}`,
    `offsetY=${physics.carOffset.y.toFixed(3)}`,
    `bottomLocalY=${(physics.carOffset.y - physics.carHalfExtents.y).toFixed(3)}`,
    `spawnPivotY=${world.carPivot.position.y.toFixed(3)}`,
    `mass=${mass}`
  );

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(
      world.carPivot.position.x,
      world.carPivot.position.y,
      world.carPivot.position.z
    )
    .setRotation(world.carPivot.quaternion)
    .setLinearDamping(linearDamping)
    .setAngularDamping(angularDamping)
    .setAdditionalSolverIterations(6)
    .setCanSleep(false)
    .setSoftCcdPrediction(1.0)
    .setCcdEnabled(true)
    .enabledRotations(true, true, true);

  physics.carBody = physics.world.createRigidBody(bodyDesc);

  physics.carCollider = physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      physics.carHalfExtents.x,
      physics.carHalfExtents.y,
      physics.carHalfExtents.z
    )
      .setTranslation(physics.carOffset.x, physics.carOffset.y, physics.carOffset.z)
      .setDensity(0)  // mass set via setAdditionalMassProperties below
      .setContactSkin(0.03)
      .setFriction(0.9)
      .setRestitution(0.08)
      // Chassis lives in its own collision-group bit so the ground-grid
      // trimesh can exclude contact solving with it (see
      // GROUPS_TRIMESH_NO_CHASSIS). Filter=0xffff so it still solves
      // contacts with obstacles / pad / deepfloor (all default groups).
      .setCollisionGroups(GROUPS_CHASSIS)
      .setSolverGroups(GROUPS_CHASSIS)
      .setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS
      )
      .setContactForceEventThreshold(15),
    physics.carBody
  );

  // Apply center-of-mass offset from RCCP prefab data. Lowering the CoM
  // reduces pitch (nose-dive) during braking and improves overall stability.
  // The collider has density=0 so all mass comes from this call.
  const com = dynamics?.rigidbody?.centerOfMass;
  const comLocalX = physics.carOffset.x + (com?.x ?? 0);
  const comLocalY = physics.carOffset.y + (com?.y ?? 0);
  const comLocalZ = physics.carOffset.z + (com?.z ?? 0);
  const w = physics.carHalfExtents.x * 2;
  const h = physics.carHalfExtents.y * 2;
  const d = physics.carHalfExtents.z * 2;
  physics.carBody.setAdditionalMassProperties(
    mass,
    { x: comLocalX, y: comLocalY, z: comLocalZ },
    { x: (1 / 12) * mass * (h * h + d * d),
      y: (1 / 12) * mass * (w * w + d * d),
      z: (1 / 12) * mass * (w * w + h * h) },
    { x: 0, y: 0, z: 0, w: 1 }
  );

  physics.wheelRig = createWheelRig(physics.world, physics.carBody, dynamics);
  rebuildWheelAnchors();
}

export function syncVehiclePhysicsToMenu() {
  if (!physics.carBody) return;
  physics.carBody.setTranslation(
    { x: world.carPivot.position.x, y: world.carPivot.position.y, z: world.carPivot.position.z },
    true
  );
  physics.carBody.setRotation(world.carPivot.quaternion, true);
  physics.carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  physics.carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

export function resetPhysicsVehicle(position, heading) {
  if (!physics.ready) return;
  buildScenePhysics(state.route === "game" ? "ground" : "full");
  if (!physics.carBody) rebuildVehiclePhysics();
  if (!physics.carBody) return;
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  physics.carBody.setTranslation(
    { x: position.x, y: position.y, z: position.z },
    true
  );
  physics.carBody.setRotation(rotation, true);
  physics.carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  physics.carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  physics.fixedTimeAccumulator = 0;
  physics.impactCooldown = 0;
  physics.cameraShake = 0;
  physics.groundRescueCount = 0;
  physics.groundRescueTime = 0;
  physics.groundRescuePosition = null;
  if (_vehiclePhysicsController) _vehiclePhysicsController.reset(state.game);
  physics.skidPrevious = [null, null, null, null];
  if (physics.smoke) {
    physics.smoke.material.opacity = 0;
  }
  physics.wheelAnchors.forEach((wheel) => {
    wheel.compression = 0;
    wheel.grounded = false;
    wheel.spin = 0;
    wheel.steerAngle = 0;
  });
}

function getNearbyStableSurface(point) {
  const offsets = [
    [0, 0],
    [2, 0], [-2, 0], [0, 2], [0, -2],
    [4, 0], [-4, 0], [0, 4], [0, -4],
    [3, 3], [3, -3], [-3, 3], [-3, -3],
    [6, 0], [-6, 0], [0, 6], [0, -6]
  ];

  let bestPoint = null;
  let bestSurfaceY = Number.POSITIVE_INFINITY;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  offsets.forEach(([dx, dz]) => {
    const candidate = new THREE.Vector3(point.x + dx, point.y, point.z + dz);
    // Match addGameplayGroundGrid's sampling rules: walk up from the
    // lowest valid hit but stay within 8m of the topmost one. This is
    // critical under bridges / overpasses / rooftops — the default
    // (topmost hit) returns the overhead structure instead of the road
    // the car is actually driving on, which makes this whole function
    // think the car has fallen far below grade and triggers a spurious
    // rescue that eventually teleports the car back to spawn.
    const surfaceY = _getMenuSurfaceHeight(candidate, {
      lowestHit: true,
      maxDropFromTop: 8
    });
    if (!Number.isFinite(surfaceY)) return;
    const distanceSq = dx * dx + dz * dz;
    if (
      surfaceY < bestSurfaceY - 0.05 ||
      (Math.abs(surfaceY - bestSurfaceY) <= 0.05 && distanceSq < bestDistanceSq)
    ) {
      bestSurfaceY = surfaceY;
      bestDistanceSq = distanceSq;
      bestPoint = candidate.clone();
      bestPoint.y = surfaceY;
    }
  });

  return bestPoint;
}

// --- Ground-stabilize -------------------------------------------------------
// DISABLED: getNearbyStableSurface runs 17 raycasts (each doing
// Box3.setFromObject + intersectObject on the full scene) per call, causing
// severe periodic stutter (~100+ allocations + 17 full scene traversals).
// The gameLoop FallOutReset (y < spawnY - 8) and detectAndResolveStuck
// already cover the stuck/underground cases this was designed for.

export function stabilizeVehicleAboveGround() {
  return false;
}

// --- Velocity-based stuck detector ------------------------------------------
// If the car has near-zero horizontal speed but the player is actively
// driving (throttle input != 0) for more than STUCK_TIMEOUT seconds, the
// chassis is likely wedged against a trimesh edge or wall corner. Give it
// an upward impulse and slight backward nudge to free it.
let _stuckTimer = 0;
let _stuckCount = 0;
const STUCK_SPEED_THRESHOLD = 0.5;  // m/s horizontal (lowered from 1.0 to reduce false positives)
const STUCK_TIMEOUT = 3.0;          // seconds before first rescue (raised from 1.5)

export function detectAndResolveStuck(dt, throttleInput) {
  if (!physics.carBody) return false;

  const linvel = physics.carBody.linvel();
  const horizSpeed = Math.hypot(linvel.x, linvel.z);

  // Only trigger stuck detection when the player is trying to MOVE (positive
  // throttle forward, or positive throttle in reverse).  Braking to a stop
  // (throttleInput < 0 in a forward gear) is NOT stuck — don't count it.
  if (throttleInput > 0.1 && horizSpeed < STUCK_SPEED_THRESHOLD) {
    _stuckTimer += dt;
  } else {
    _stuckTimer = 0;
    _stuckCount = 0;
    return false;
  }

  if (_stuckTimer < STUCK_TIMEOUT) return false;
  _stuckTimer = 0;
  _stuckCount++;

  const rotation = physics.carBody.rotation();
  const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

  if (_stuckCount >= 3) {
    // Repeated stuck in same spot — teleport to spawn
    _stuckCount = 0;
    const spawn = state.game.spawnPosition?.clone?.() || new THREE.Vector3(0, 2, 0);
    const heading = Number.isFinite(state.game.heading) ? state.game.heading : 0;
    resetPhysicsVehicle(spawn, heading);
    world.carPivot.position.copy(spawn);
    world.carPivot.updateMatrixWorld(true);
    // eslint-disable-next-line no-console
    console.warn(`[StuckDetector] teleport to spawn after ${_stuckCount} stuck attempts`);
    return true;
  }

  // Nudge: lift the car up and push it backward to clear the edge.
  // Mass is ~950 kg, so impulse of ~1200 gives a ~1.3 m/s kick.
  physics.carBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  physics.carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  physics.carBody.applyImpulse(
    { x: backward.x * 800, y: 1200, z: backward.z * 800 },
    true
  );

  // eslint-disable-next-line no-console
  console.warn(
    `[StuckDetector] nudge #${_stuckCount} — horizSpeed=${horizSpeed.toFixed(2)} throttle=${throttleInput.toFixed(2)}`
  );
  return true;
}

export function rapierVectorToThree(vector) {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

export function syncWheelVisuals() {
  if (!_vehicleVisualController) return;
  if (!assets.activeWheels?.length) {
    _vehicleVisualController.syncWheelVisuals(assets.stockWheels, physics.wheelAnchors);
  }
  _vehicleVisualController.syncWheelVisuals(assets.activeWheels, physics.wheelAnchors);
}
