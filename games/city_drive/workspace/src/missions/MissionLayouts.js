// Scene-space + arena-space mission layout builders + spawn helpers.
//
// Ported from the inline mission-layout section of main.js. Pure
// transforms over state + save + ccdsData scene layouts + currentScene
// selectors. No DI — all dependencies are real imports.

import * as THREE from "three";
import { vectorFromData } from "../core/utils.js";
import { MAIN_MENU_SPAWN, MISSION_MARKERS } from "../core/config.js";
import { state } from "../core/state.js";
import {
  currentMission,
  currentSceneMissionLayout,
  currentSceneMissionLayouts,
  currentVehicleDynamics
} from "../core/selectors.js";
import { getMenuSurfaceHeight } from "../scene/CityLoader.js";
import { getSnappedMenuCarPosition } from "../scene/MenuPresentation.js";

export function cloneVectors(points = []) {
  return points.map((point) => (point.isVector3 ? point.clone() : new THREE.Vector3(point.x, point.y, point.z)));
}

export function normalizeScenePoint(point, origin, scale) {
  return new THREE.Vector3((point.x - origin.x) * scale, 0, (point.z - origin.z) * scale);
}

export function buildArenaMissionLayout(missionId = state.missionId) {
  const sceneLayout = currentSceneMissionLayouts()[missionId];
  if (!sceneLayout) {
    return {
      startPosition: new THREE.Vector3(0, 0, 0),
      markers: [MISSION_MARKERS[missionId] || new THREE.Vector3()],
      targets: [],
      path: [],
      finisher: null
    };
  }

  const sourcePoints = [
    ...(sceneLayout.markers || []),
    ...(sceneLayout.targets || []),
    ...(sceneLayout.path || []),
    ...(sceneLayout.finisher ? [sceneLayout.finisher] : []),
    ...(sceneLayout.startPosition ? [sceneLayout.startPosition] : [])
  ];
  const origin = sceneLayout.startPosition || sourcePoints[0] || { x: 0, y: 0, z: 0 };
  const maxDistance = sourcePoints.reduce((max, point) => {
    const dx = point.x - origin.x;
    const dz = point.z - origin.z;
    return Math.max(max, Math.hypot(dx, dz));
  }, 1);
  const scale = Math.min(0.08, 22 / maxDistance);

  return {
    startPosition: new THREE.Vector3(0, 0, 0),
    markers: (sceneLayout.markers || []).map((point) => normalizeScenePoint(point, origin, scale)),
    targets: (sceneLayout.targets || []).map((point) => normalizeScenePoint(point, origin, scale)),
    path: (sceneLayout.path || []).map((point) => normalizeScenePoint(point, origin, scale)),
    finisher: sceneLayout.finisher ? normalizeScenePoint(sceneLayout.finisher, origin, scale) : null
  };
}

export function buildWorldMissionLayout(missionId = state.missionId) {
  const sceneLayout = currentSceneMissionLayouts()[missionId];
  if (!sceneLayout) {
    return {
      startPosition: null,
      markers: [],
      targets: [],
      path: [],
      finisher: null
    };
  }

  return {
    startPosition: sceneLayout.startPosition ? vectorFromData(sceneLayout.startPosition) : null,
    markers: (sceneLayout.markers || []).map((point) => vectorFromData(point)),
    targets: (sceneLayout.targets || []).map((point) => vectorFromData(point)),
    path: (sceneLayout.path || []).map((point) => vectorFromData(point)),
    finisher: sceneLayout.finisher ? vectorFromData(sceneLayout.finisher) : null
  };
}

export function getDefaultGameplayStartPosition() {
  const layouts = Object.values(currentSceneMissionLayouts());
  for (const layout of layouts) {
    if (layout?.startPosition) return vectorFromData(layout.startPosition);
  }
  return MAIN_MENU_SPAWN.clone();
}

export function resolveGameplaySpawnPosition(position, route = "mission") {
  const fallback = getSnappedMenuCarPosition(route);
  const resolved = (position?.clone?.() || vectorFromData(position, fallback)).clone();
  if (!Number.isFinite(resolved.x) || !Number.isFinite(resolved.y) || !Number.isFinite(resolved.z)) {
    resolved.copy(fallback);
  }

  const surfaceY = getMenuSurfaceHeight(resolved);

  // Compute the exact spawn lift from the vehicle dynamics extract so
  // the car body is positioned such that all wheels just touch the
  // ground at rest on spawn.
  //
  // Each wheel's rest contact patch sits at:
  //   carBody.y + wheel.localPosition.y - wheel.radius   (localPosition.y < 0)
  // Setting that equal to surfaceY:
  //   lift = |wheel.localPosition.y| + wheel.radius
  // We take the max over all wheels so every wheel touches simultaneously,
  // plus a 0.12 m buffer so Rapier doesn't see penetration on the first
  // frame (chassis cuboid collider bottom also needs clearance above the
  // spawn pad).
  //
  // Source the data from `currentVehicleDynamics()` rather than
  // `physics.wheelAnchors`, because wheelAnchors is rebuilt at the END
  // of `rebuildVehiclePhysics()` and can be stale for the about-to-be-
  // spawned vehicle if called ahead of the physics rebuild.
  let lift = 1.0;  // safe fallback
  const dynamics = currentVehicleDynamics();
  if (Array.isArray(dynamics?.wheels) && dynamics.wheels.length > 0) {
    const computed = dynamics.wheels.reduce((max, wheel) => {
      const hubDepth = -(wheel.position?.y ?? 0);   // positive: hub below body
      const contactDepth = hubDepth + (wheel.radius ?? 0.33);
      return Math.max(max, contactDepth);
    }, 0);
    if (computed > 0.3) lift = computed + 0.12;
  }

  resolved.y = Number.isFinite(surfaceY) ? surfaceY + lift : resolved.y + lift;
  return resolved;
}

export function getGameplaySpawnAnchor() {
  const sceneLayout = currentSceneMissionLayout();
  if (sceneLayout?.startPosition) return vectorFromData(sceneLayout.startPosition);
  return getDefaultGameplayStartPosition();
}

export function findLowestSurfaceSpawn(anchor, route = "main") {
  const base = (anchor?.clone?.() || vectorFromData(anchor, getSnappedMenuCarPosition(route))).clone();
  const offsets = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
    [8, 0],
    [-8, 0],
    [0, 8],
    [0, -8],
    [6, 6],
    [6, -6],
    [-6, 6],
    [-6, -6],
    [12, 0],
    [-12, 0],
    [0, 12],
    [0, -12]
  ];

  let bestPoint = null;
  let bestSurfaceY = Number.POSITIVE_INFINITY;
  offsets.forEach(([dx, dz]) => {
    const candidate = base.clone();
    candidate.x += dx;
    candidate.z += dz;
    const surfaceY = getMenuSurfaceHeight(candidate);
    if (!Number.isFinite(surfaceY)) return;
    if (surfaceY < bestSurfaceY) {
      bestSurfaceY = surfaceY;
      bestPoint = candidate;
    }
  });

  return bestPoint || base;
}

export function toGameplayLocalPoint(point) {
  return vectorFromData(point).sub(state.gameplayOrigin);
}

export function getMissionTarget() {
  const runtime = state.game.runtime;
  if (state.route === "game" && runtime) {
    if ((runtime.type === "checkpoint" || runtime.type === "trailblazer") && runtime.targets?.[runtime.currentIndex]) {
      return runtime.targets[runtime.currentIndex];
    }
    if (runtime.type === "race" && runtime.path?.[runtime.currentIndex]) {
      return runtime.path[runtime.currentIndex];
    }
    if (runtime.type === "pursuit" && runtime.targetPosition) {
      return runtime.targetPosition;
    }
  }
  const sceneLayout = buildWorldMissionLayout();
  const markerPoint = sceneLayout.markers?.[0] || sceneLayout.startPosition;
  return markerPoint ? markerPoint.clone() : currentMission().marker;
}
