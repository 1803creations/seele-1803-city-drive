// Mission runtime factories + per-tick update steps for the 4 CCDS
// mission types (checkpoint, trailblazer, race, pursuit).
//
// Ported from the inline missions section of main.js. Imports
// `currentMission` and `buildWorldMissionLayout` directly; uses DI
// for `completeMission` and `updateMarker` since those still live
// in main.js.

import * as THREE from "three";
import { vectorFromData } from "../core/utils.js";
import { MISSION_MARKERS } from "../core/config.js";
import { state } from "../core/state.js";
import { world } from "../scene/World.js";
import { currentMission } from "../core/selectors.js";
import { buildWorldMissionLayout } from "./MissionLayouts.js";
import { setPoliceSiren } from "../effects/VehicleEffects.js";
import { updatePoliceLights } from "../traffic/TrafficSystem.js";

// --- Injected dependencies (main.js still owns these) ---------------------

let _completeMission = () => {};
let _updateMarker = () => {};
let _trafficSystem = null;

export function configureMissionRuntime({
  completeMission,
  updateMarker,
  trafficSystem
} = {}) {
  if (completeMission) _completeMission = completeMission;
  if (updateMarker) _updateMarker = updateMarker;
  if (trafficSystem) _trafficSystem = trafficSystem;
}

// --- Visual indicators helpers -------------------------------------------

const _activeIndicators = [];

function _createCheckpointBeam(position, isCurrent) {
  const group = new THREE.Group();
  group.position.copy(position);

  // Tall vertical beam
  const beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 20, 8);
  const beamMat = new THREE.MeshBasicMaterial({
    color: isCurrent ? 0x00ff88 : 0x44aa66,
    transparent: true,
    opacity: isCurrent ? 0.7 : 0.25,
    depthWrite: false
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 10;
  group.add(beam);

  // Ground ring
  const ringGeo = new THREE.RingGeometry(1.5, 2.5, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: isCurrent ? 0x00ff88 : 0x44aa66,
    transparent: true,
    opacity: isCurrent ? 0.8 : 0.3,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  group.add(ring);

  return group;
}

function _createConeMarker(position, isCurrent) {
  const group = new THREE.Group();
  group.position.copy(position);

  // Orange cone
  const coneGeo = new THREE.ConeGeometry(0.5, 1.5, 8);
  const coneMat = new THREE.MeshBasicMaterial({
    color: isCurrent ? 0xff8800 : 0xcc6600,
    transparent: true,
    opacity: isCurrent ? 0.9 : 0.4
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.y = 0.75;
  group.add(cone);

  if (isCurrent) {
    // Glowing ring for current target
    const ringGeo = new THREE.RingGeometry(1.0, 1.8, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff8800,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
  }

  return group;
}

function _updateVisualIndicators(runtime) {
  // Remove old indicators
  _clearIndicators();

  const isCheckpoint = runtime.type === "checkpoint";
  const isTrailblazer = runtime.type === "trailblazer";
  if (!isCheckpoint && !isTrailblazer) return;

  const targets = runtime.targets;
  const current = runtime.currentIndex;

  // Show indicators for current + next 3 targets
  const showCount = Math.min(4, targets.length - current);
  for (let i = 0; i < showCount; i++) {
    const idx = current + i;
    if (idx >= targets.length) break;
    const isCurrent = i === 0;
    const indicator = isCheckpoint
      ? _createCheckpointBeam(targets[idx], isCurrent)
      : _createConeMarker(targets[idx], isCurrent);
    world.root.add(indicator);
    _activeIndicators.push(indicator);
  }
}

function _clearIndicators() {
  for (const ind of _activeIndicators) {
    world.root.remove(ind);
    ind.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  }
  _activeIndicators.length = 0;
}

// --- Race opponent mesh helpers ------------------------------------------

function _spawnRaceOpponentMeshes(runtime) {
  if (!_trafficSystem?.loaded) return;
  runtime.opponents.forEach((opp, i) => {
    const mesh = _trafficSystem.createNPCCar(i + 1);
    if (mesh) {
      // Position at their starting progress along the path
      const pathIdx = Math.min(Math.floor(opp.progress), runtime.path.length - 1);
      mesh.position.copy(runtime.path[Math.max(0, pathIdx)]);
      world.root.add(mesh);
      opp.mesh = mesh;
    }
  });
}

function _updateRaceOpponentMeshes(runtime) {
  runtime.opponents.forEach((opp) => {
    if (!opp.mesh) return;
    const pathIdx = Math.min(Math.floor(opp.progress), runtime.path.length - 1);
    const pos = runtime.path[Math.max(0, pathIdx)];
    if (pos) {
      opp.mesh.position.copy(pos);
      // Face next waypoint
      const nextIdx = Math.min(pathIdx + 1, runtime.path.length - 1);
      if (nextIdx !== pathIdx) {
        const next = runtime.path[nextIdx];
        const dir = next.clone().sub(pos);
        if (dir.lengthSq() > 0.01) {
          opp.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        }
      }
    }
  });
}

function _cleanupRaceOpponents(runtime) {
  runtime.opponents.forEach((opp) => {
    if (opp.mesh) {
      world.root.remove(opp.mesh);
      opp.mesh = null;
    }
  });
}

// --- Cleanup all mission visuals -----------------------------------------

export function cleanupMissionVisuals(runtime) {
  _clearIndicators();
  if (runtime?.type === "race") _cleanupRaceOpponents(runtime);
  if (runtime?.type === "pursuit" && runtime.policeMesh) {
    world.root.remove(runtime.policeMesh);
    runtime.policeMesh = null;
  }
}

// --- Runtime factory ------------------------------------------------------

export function createMissionRuntime(mission) {
  const sceneLayout = buildWorldMissionLayout(mission.id);
  switch (mission.id) {
    case "checkpoint": {
      const runtime = {
        type: "checkpoint",
        targets: (sceneLayout?.targets?.length ? sceneLayout.targets : [MISSION_MARKERS.checkpoint]).map((point) => vectorFromData(point)),
        currentIndex: 0
      };
      _updateVisualIndicators(runtime);
      return runtime;
    }
    case "trailblazer": {
      const runtime = {
        type: "trailblazer",
        targets: (sceneLayout?.targets?.length ? sceneLayout.targets : [MISSION_MARKERS.trailblazer]).map((point) => vectorFromData(point)),
        currentIndex: 0
      };
      _updateVisualIndicators(runtime);
      return runtime;
    }
    case "race": {
      const runtime = {
        type: "race",
        path: (sceneLayout?.path?.length ? sceneLayout.path : [MISSION_MARKERS.race]).map((point) => vectorFromData(point)),
        currentIndex: 0,
        playerFinished: false,
        opponents: [
          { id: "racer_1", progress: 0.15, speed: 0.18, finished: false, mesh: null },
          { id: "racer_2", progress: 0.05, speed: 0.16, finished: false, mesh: null },
          { id: "racer_3", progress: 0.1, speed: 0.17, finished: false, mesh: null }
        ]
      };
      _spawnRaceOpponentMeshes(runtime);
      return runtime;
    }
    case "pursuit": {
      const runtime = {
        type: "pursuit",
        path: (sceneLayout?.path?.length ? sceneLayout.path : [MISSION_MARKERS.pursuit]).map((point) => vectorFromData(point)),
        pathIndex: 0,
        targetPosition: vectorFromData(sceneLayout?.path?.length ? sceneLayout.path[0] : MISSION_MARKERS.pursuit),
        damage: 0,
        targetSpeed: 5.2,
        policeMesh: null,
        _sirenActive: false
      };
      // Spawn police car mesh if traffic system has loaded
      if (_trafficSystem?.loaded) {
        runtime.policeMesh = _trafficSystem.createPoliceCar();
        if (runtime.policeMesh) {
          runtime.policeMesh.position.copy(runtime.targetPosition);
          world.root.add(runtime.policeMesh);
        }
      }
      return runtime;
    }
    default:
      return { type: mission.id };
  }
}

// --- Per-tick mission updates ---------------------------------------------

export function getRacePosition(runtime) {
  const playerProgress = runtime.currentIndex + world.carPivot.position.distanceTo(runtime.path[runtime.currentIndex] || runtime.path[runtime.path.length - 1]) * -0.001;
  const ahead = runtime.opponents.filter((opponent) => opponent.progress > playerProgress).length;
  return ahead + 1;
}

export function updateSequentialMission(runtime, reachDistance) {
  const target = runtime.targets[runtime.currentIndex];
  if (!target) return;
  if (world.carPivot.position.distanceTo(target) < reachDistance) {
    runtime.currentIndex += 1;
    if (runtime.currentIndex >= runtime.targets.length) {
      _clearIndicators();
      _completeMission(true, `${currentMission().name} complete. Reward added: $${currentMission().reward}.`);
    } else {
      _updateVisualIndicators(runtime);
      _updateMarker();
    }
  }
}

export function updateRaceMission(runtime, dt) {
  runtime.opponents.forEach((opponent) => {
    if (opponent.finished) return;
    opponent.progress = Math.min(runtime.path.length, opponent.progress + opponent.speed * dt);
    if (opponent.progress >= runtime.path.length - 0.02) opponent.finished = true;
  });
  _updateRaceOpponentMeshes(runtime);

  const target = runtime.path[runtime.currentIndex];
  if (target && world.carPivot.position.distanceTo(target) < 2.6) {
    runtime.currentIndex += 1;
    if (runtime.currentIndex >= runtime.path.length) {
      runtime.playerFinished = true;
      const position = getRacePosition(runtime);
      _cleanupRaceOpponents(runtime);
      _completeMission(position === 1, position === 1 ? `Race won. Reward added: $${currentMission().reward}.` : "Race finished, but the player did not place first.");
      return;
    }
    _updateMarker();
  }

  if (!runtime.playerFinished && runtime.opponents.every((opponent) => opponent.finished)) {
    _cleanupRaceOpponents(runtime);
    _completeMission(false, "Race failed because all rival racers finished before the player.");
  }
}

export function updatePursuitMission(runtime, dt) {
  // Activate police siren on first tick
  if (!runtime._sirenActive) {
    setPoliceSiren(true);
    runtime._sirenActive = true;
  }
  const nextTarget = runtime.path[(runtime.pathIndex + 1) % runtime.path.length];
  const toNext = nextTarget.clone().sub(runtime.targetPosition);
  const step = runtime.targetSpeed * dt;
  if (toNext.length() <= step) {
    runtime.targetPosition.copy(nextTarget);
    runtime.pathIndex = (runtime.pathIndex + 1) % runtime.path.length;
  } else {
    runtime.targetPosition.add(toNext.normalize().multiplyScalar(step));
  }

  // Update police car mesh position + rotation
  if (runtime.policeMesh) {
    runtime.policeMesh.position.copy(runtime.targetPosition);
    // Face direction of travel
    const dir = toNext.normalize();
    if (dir.lengthSq() > 0.001) {
      const angle = Math.atan2(dir.x, dir.z);
      runtime.policeMesh.rotation.set(0, angle, 0);
    }
    // RCCP_PoliceLights flash pattern (4 red + 4 blue, time-based)
    updatePoliceLights(runtime.policeMesh, dt, runtime._sirenActive);
  }

  _updateMarker();
  const distance = world.carPivot.position.distanceTo(runtime.targetPosition);
  if (distance < 3.2) {
    runtime.damage = Math.min(100, runtime.damage + Math.max(8, state.game.speed * 0.18) * dt);
  }
  if (runtime.damage >= 100) {
    setPoliceSiren(false);
    // Clean up police car mesh
    if (runtime.policeMesh) {
      world.root.remove(runtime.policeMesh);
      runtime.policeMesh = null;
    }
    _completeMission(true, `Pursuit target disabled. Reward added: $${currentMission().reward}.`);
  }
}
