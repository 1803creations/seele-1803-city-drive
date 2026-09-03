// Gameplay loop: vehicle stepping, free-drive earnings, mission update,
// marker + camera placement, reflection probe, RAF animate.
//
// Ported from the inline game-loop section of main.js. The vehicle
// physics controller instance + action-layer callbacks (completeMission,
// navigate, setMessage, persist) still live in main.js, so they are
// injected via `configureGameLoop({...})` during bootstrap.

import * as THREE from "three";
import {
  FIXED_TIMESTEP,
  GAME_STATES,
  MAIN_MENU_SPAWN,
  MAIN_MENU_ROTATION_Y,
  FREE_DRIVE_PAYOUT_DISTANCE_METERS,
  FREE_DRIVE_PAYOUT_AMOUNT,
  MISSIONS
} from "./config.js";
import { state, save, physics, assets, keys } from "./state.js";
import {
  renderer,
  scene,
  camera,
  controls,
  world,
  reflectionCamera,
  updateShadowCamera
} from "../scene/World.js";
import {
  syncWheelVisuals,
  resetPhysicsVehicle,
  stabilizeVehicleAboveGround,
  detectAndResolveStuck
} from "../physics/World.js";
import { updateVehicleAudio, playCashSound, updateTireSmoke, updateExhaust, addSkidSegment, updateDamageEffects, setPoliceSiren } from "../effects/VehicleEffects.js";
import {
  updateSequentialMission,
  updateRaceMission,
  updatePursuitMission
} from "../missions/MissionRuntime.js";
import { getMissionTarget } from "../missions/MissionLayouts.js";
import { getMenuSurfaceHeight, updateAkronSceneTrafficLights } from "../scene/CityLoader.js";
import { currentMission, currentSceneMissionLayouts, currentVehicleDynamics, statsFor } from "./selectors.js";
import { ensureCarVisibleState } from "../vehicle/VehicleAssembly.js";
import { updateHud } from "../ui/HUD.js";
import { vehicleVisualController } from "../vehicle/VehicleOrchestration.js";

// --- Pre-allocated vectors to avoid GC pressure in hot loops ----------------
const _skidWpos = new THREE.Vector3();
const _smokeOffset = new THREE.Vector3();
const _freeDriveDelta = new THREE.Vector3();
const _freeDrivePrevPos = new THREE.Vector3();
const _camOffset = new THREE.Vector3();
const _camEuler = new THREE.Euler();
const _camTarget = new THREE.Vector3();
const _camPosition = new THREE.Vector3();
const _camTargetUp = new THREE.Vector3();
const _camCarForward = new THREE.Vector3();
const _camCarQuaternion = new THREE.Quaternion();
const _terrainProbe = new THREE.Vector3();
const _bodyTranslation = { x: 0, y: 0, z: 0 };

// --- Injected dependencies (main.js still owns these) ---------------------

let _vehiclePhysicsController = null;
let _setMessage = () => {};
let _completeMission = () => {};
let _navigate = () => {};
let _persist = () => {};
let _trafficSystem = null;

export function configureGameLoop({
  vehiclePhysicsController,
  setMessage,
  completeMission,
  navigate,
  persist,
  trafficSystem
} = {}) {
  if (vehiclePhysicsController) _vehiclePhysicsController = vehiclePhysicsController;
  if (setMessage) _setMessage = setMessage;
  if (completeMission) _completeMission = completeMission;
  if (navigate) _navigate = navigate;
  if (persist) _persist = persist;
  if (trafficSystem) _trafficSystem = trafficSystem;
}

// Called from startGame() to re-center traffic around gameplay spawn
export function recenterTraffic(spawnPosition) {
  if (_trafficSystem) _trafficSystem.recenterWaypoints(spawnPosition);
}

// --- Pure helpers ---------------------------------------------------------

export function updateMarker() {
  const mission = currentMission();
  const target = getMissionTarget();
  const groundY = target.y ?? 0;
  world.marker.position.set(target.x, groundY + 0.08, target.z);
  world.beam.position.set(target.x, groundY + 2.8, target.z);
  const visible = mission.id !== "free" || state.route === "mission";
  world.marker.visible = visible;
  world.beam.visible = visible;
}

// --- Mission beacon system (in-world light pillars for free drive) --------

const _missionBeacons = [];

const BEACON_COLORS = {
  checkpoint:  { main: 0x4488ff, emissive: 0x112244 },
  trailblazer: { main: 0xff8800, emissive: 0x4d2200 },
  race:        { main: 0xff4444, emissive: 0x441111 },
  pursuit:     { main: 0x8855cc, emissive: 0x221144 }
};

// Free-drive mission beacons are intentionally clustered near the initial
// gameplay spawn so all four mission entrances are visible immediately on
// load instead of being scattered at their original mission start points.
const BEACON_RING_RADIUS = 24;
const BEACON_ANGLE_OFFSETS = {
  checkpoint: THREE.MathUtils.degToRad(-52),
  trailblazer: THREE.MathUtils.degToRad(-18),
  race: THREE.MathUtils.degToRad(18),
  pursuit: THREE.MathUtils.degToRad(52)
};
const BEACON_HIGHLIGHT_DISTANCE = 22;
const BEACON_ENTER_DISTANCE = 12;
const BEACON_CLEAR_DISTANCE = 28;
let _gameplayCameraYaw = 0;

export function spawnMissionBeacons() {
  clearMissionBeacons();
  const layouts = currentSceneMissionLayouts();
  if (!layouts) return;

  const spawnBase = state.game?.missionBeaconOrigin?.clone?.()
    || state.game?.spawnPosition?.clone?.()
    || world.carPivot.position.clone();
  const baseHeading = state.game?.missionBeaconHeading
    ?? state.game?.heading
    ?? world.carPivot.rotation.y
    ?? 0;
  const missionIds = ["checkpoint", "trailblazer", "race", "pursuit"];
  for (const id of missionIds) {
    const layout = layouts[id];
    if (!layout?.startPosition) continue;
    const colors = BEACON_COLORS[id];
    const authoredStart = new THREE.Vector3(layout.startPosition.x, layout.startPosition.y, layout.startPosition.z);
    const angle = baseHeading + (BEACON_ANGLE_OFFSETS[id] ?? 0);
    const pos = new THREE.Vector3(
      spawnBase.x + Math.sin(angle) * BEACON_RING_RADIUS,
      spawnBase.y,
      spawnBase.z + Math.cos(angle) * BEACON_RING_RADIUS
    );

    // Disc marker on the ground
    const markerGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.1, 32);
    const markerMat = new THREE.MeshStandardMaterial({
      color: colors.main,
      emissive: colors.emissive,
      transparent: true,
      opacity: 0.85
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(pos.x, pos.y + 0.1, pos.z);

    // Tall beam
    const beamGeo = new THREE.CylinderGeometry(0.7, 2.4, 12, 24, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: colors.main,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(pos.x, pos.y + 6, pos.z);

    world.root.add(marker);
    world.root.add(beam);

    _missionBeacons.push({
      missionId: id,
      marker,
      beam,
      position: pos,
      authoredStart
    });
  }
}

export function clearMissionBeacons() {
  for (const b of _missionBeacons) {
    world.root.remove(b.marker);
    world.root.remove(b.beam);
    b.marker.geometry.dispose();
    b.marker.material.dispose();
    b.beam.geometry.dispose();
    b.beam.material.dispose();
  }
  _missionBeacons.length = 0;
}

function _updateBeaconProximity() {
  if (state.missionId !== "free" || state.game.state !== GAME_STATES.STARTED) {
    if (state.game.nearMission) state.game.nearMission = null;
    return;
  }

  const carPos = world.carPivot.position;
  let closest = null;
  let closestDist = Infinity;

  for (const b of _missionBeacons) {
    const dist = carPos.distanceTo(b.position);

    const highlight = dist < BEACON_HIGHLIGHT_DISTANCE;
    b.marker.material.emissiveIntensity = highlight ? 2.0 : 1.0;
    b.beam.material.opacity = highlight ? 0.45 : 0.22;

    if (dist < closestDist) {
      closestDist = dist;
      closest = b;
    }
  }

  if (closest && closestDist < BEACON_ENTER_DISTANCE) {
    state.game.nearMission = closest.missionId;
    state.game.nearMissionDist = closestDist;
  } else if (closestDist > BEACON_CLEAR_DISTANCE) {
    state.game.nearMission = null;
    state.game.nearMissionDist = 0;
  }
}

export function gameplayCameraOffset() {
  return state.gameCameraMode === "close"
    ? _camOffset.set(0, 1.65, 2.85)
    : _camOffset.set(0, 2.15, 6.8);
}

function getGameplayCameraYaw() {
  const sourceRotation = physics.carBody?.rotation?.();
  if (sourceRotation) {
    _camCarQuaternion.set(sourceRotation.x, sourceRotation.y, sourceRotation.z, sourceRotation.w);
  } else {
    world.carPivot.getWorldQuaternion(_camCarQuaternion);
  }
  _camCarForward.set(0, 0, -1).applyQuaternion(_camCarQuaternion);
  _camCarForward.y = 0;
  if (_camCarForward.lengthSq() < 0.0001) return state.game.heading ?? world.carPivot.rotation.y ?? 0;
  _camCarForward.normalize();
  return Math.atan2(-_camCarForward.x, -_camCarForward.z);
}

export function updateGameplayCamera(immediate = false, dt = 1 / 60) {
  if (state.route !== "game") return;
  const carYaw = getGameplayCameraYaw();
  state.game.heading = carYaw;
  if (immediate) {
    _gameplayCameraYaw = carYaw;
  } else {
    const yawDelta = THREE.MathUtils.euclideanModulo(
      carYaw - _gameplayCameraYaw + Math.PI,
      Math.PI * 2
    ) - Math.PI;
    const snapBehind = Math.abs(yawDelta) > Math.PI * 0.75;
    const yawFollow = 1 - Math.exp(-dt * (snapBehind ? 18 : 8.5));
    _gameplayCameraYaw += yawDelta * yawFollow;
  }
  const offset = gameplayCameraOffset().applyEuler(_camEuler.set(0, _gameplayCameraYaw, 0));
  _camTarget.copy(world.carPivot.position).add(_camTargetUp.set(0, 1.5, 0));
  _camPosition.copy(world.carPivot.position).add(offset);
  if (physics.cameraShake > 0) {
    const shake = physics.cameraShake;
    _camPosition.x += (Math.random() - 0.5) * shake;
    _camPosition.y += (Math.random() - 0.5) * shake * 0.4;
    _camPosition.z += (Math.random() - 0.5) * shake;
  }
  if (immediate) {
    camera.position.copy(_camPosition);
    controls.target.copy(_camTarget);
  } else {
    const cameraFollow = 1 - Math.exp(-dt * 7.5);
    const targetFollow = 1 - Math.exp(-dt * 10);
    camera.position.lerp(_camPosition, cameraFollow);
    controls.target.lerp(_camTarget, targetFollow);
  }
  camera.lookAt(controls.target);
}

export function updateReflections() {
  if (!assets.car || assets.loadingVehicle) return;
  const reflectiveRoute = state.route !== "game";
  if (!reflectiveRoute) return;

  const carBox = new THREE.Box3().setFromObject(world.carPivot);
  const center = carBox.getCenter(new THREE.Vector3());
  center.y += Math.max(0.6, carBox.getSize(new THREE.Vector3()).y * 0.18);
  reflectionCamera.position.copy(center);

  try {
    world.carPivot.visible = false;
    reflectionCamera.update(renderer, scene);
  } finally {
    ensureCarVisibleState();
  }
}

// --- Vehicle stepping -----------------------------------------------------

// Physics-only stepping — safe to call multiple times per frame inside the
// fixed-timestep accumulator.  Visual / audio feedback is deferred to
// syncVehicleVisuals() which runs ONCE per render frame.
let _cachedStats = null;
export function stepVehiclePhysics(dt, throttleInput, steerInput, handbrakeInput, nosInput) {
  // statsFor() allocates a new object; cache per-frame so the accumulator
  // loop doesn't re-create it on every tick.
  if (!_cachedStats) _cachedStats = statsFor();
  const result = _vehiclePhysicsController.step({
    dt,
    throttleInput,
    steerInput,
    handbrakeInput,
    nosInput,
    gameState: state.game,
    worldCarPivot: world.carPivot,
    physics,
    stats: _cachedStats,
    sceneObject: assets.menuScene,
    wheelAnchors: physics.wheelAnchors
  });

  // Store latest result — only the last tick's values matter for visuals
  state.game.speed = result.speedKmh;
  state.game._lastSkidAmount = result.maxSkidAmount;
}

// Visual + audio feedback that depends on the physics result.  Must run
// exactly ONCE per render frame (after the accumulator loop) to avoid
// redundant audio.play() calls, wheel-visual syncs, and skid-mark geometry
// writes when the accumulator catches up with 2-3 ticks in one frame.
export function syncVehicleVisuals(dt) {
  syncWheelVisuals();
  updateVehicleAudio(
    THREE.MathUtils.clamp(state.game.speed / 180, 0, 1),
    state.game._lastSkidAmount ?? 0,
    state.game.isShifting,
    state.game.brakeSmoothed
  );
  // Skidmarks: add ground segments behind rear wheels when sliding
  if ((state.game._lastSkidAmount ?? 0) > 0.3 && physics.wheelAnchors) {
    for (const wheel of physics.wheelAnchors) {
      if (wheel.isFront) continue;
      _skidWpos.copy(wheel.localPosition).applyQuaternion(world.carPivot.quaternion).add(world.carPivot.position);
      _skidWpos.y = world.carPivot.position.y + 0.05;
      const prev = wheel._lastSkidPos;
      if (prev && prev.distanceTo(_skidWpos) > 0.15) addSkidSegment(prev, _skidWpos);
      if (!wheel._lastSkidPos) wheel._lastSkidPos = new THREE.Vector3();
      wheel._lastSkidPos.copy(_skidWpos);
    }
  }
  if (physics.smoke && physics.smoke.material.opacity > 0) {
    _smokeOffset.set(0, 1.4, -0.3).applyQuaternion(world.carPivot.quaternion);
    physics.smoke.position.copy(world.carPivot.position).add(_smokeOffset);
    physics.smoke.material.rotation += dt * 0.2;
  }
  physics.impactCooldown = Math.max(0, physics.impactCooldown - dt);
  physics.cameraShake = Math.max(0, physics.cameraShake - dt * 1.6);
  if (physics.sparks) {
    physics.sparks.material.opacity = Math.max(0, physics.sparks.material.opacity - dt * 10);
  }
  if (state.game.damage >= 100) {
    state.game.state = GAME_STATES.STOPPED;
    state.game.active = false;
    _setMessage("Vehicle wrecked. Return to the drive menu or restart.");
  }
}

function getVehicleGroundClearance() {
  const dynamics = currentVehicleDynamics();
  if (!Array.isArray(dynamics?.wheels) || dynamics.wheels.length === 0) return 1.0;

  const clearance = dynamics.wheels.reduce((max, wheel) => {
    const hubDepth = -(wheel.position?.y ?? 0);
    const contactDepth = hubDepth + (wheel.radius ?? 0.33);
    return Math.max(max, contactDepth);
  }, 0);

  return clearance > 0.3 ? clearance + 0.12 : 1.0;
}

function followVisibleRoadSurface(dt) {
  if (state.route !== "game" || !assets.menuScene || !world.carPivot) return;

  _terrainProbe.copy(world.carPivot.position);
  const surfaceY = getMenuSurfaceHeight(_terrainProbe);
  if (!Number.isFinite(surfaceY)) return;

  const targetY = surfaceY + getVehicleGroundClearance();
  const deltaY = targetY - world.carPivot.position.y;
  if (Math.abs(deltaY) < 0.015) return;

  const maxStep = Math.max(1.2, Math.abs(state.game.speed || 0) / 3.6) * dt * 4;
  world.carPivot.position.y += THREE.MathUtils.clamp(deltaY, -maxStep, maxStep);
  world.carPivot.updateMatrixWorld(true);

  if (physics.carBody) {
    _bodyTranslation.x = world.carPivot.position.x;
    _bodyTranslation.y = world.carPivot.position.y;
    _bodyTranslation.z = world.carPivot.position.z;
    physics.carBody.setTranslation(_bodyTranslation, true);
  }
}

// --- Free-drive earnings --------------------------------------------------

export function updateFreeDriveEarnings(dt) {
  if (currentMission().id !== "free") return;

  const cx = world.carPivot.position.x;
  const cy = world.carPivot.position.y;
  const cz = world.carPivot.position.z;
  const px = state.game._lastPosX ?? cx;
  const py = state.game._lastPosY ?? cy;
  const pz = state.game._lastPosZ ?? cz;
  state.game._lastPosX = cx;
  state.game._lastPosY = cy;
  state.game._lastPosZ = cz;

  const dx = cx - px;
  const dz = cz - pz;
  const distanceDelta = Math.sqrt(dx * dx + dz * dz);
  if (distanceDelta <= 0.001 || distanceDelta > 12) return;

  state.game.freeDriveDistance = (state.game.freeDriveDistance || 0) + distanceDelta;
  state.game.freeDriveRewardDistance = (state.game.freeDriveRewardDistance || 0) + distanceDelta;

  let rewardEarned = 0;
  while (state.game.freeDriveRewardDistance >= FREE_DRIVE_PAYOUT_DISTANCE_METERS) {
    state.game.freeDriveRewardDistance -= FREE_DRIVE_PAYOUT_DISTANCE_METERS;
    rewardEarned += FREE_DRIVE_PAYOUT_AMOUNT;
  }

  if (rewardEarned > 0) {
    save.playerMoney += rewardEarned;
    state.game.freeDriveSessionMoney = (state.game.freeDriveSessionMoney || 0) + rewardEarned;
    playCashSound();
    _persist();
  }
}

// --- Main game tick -------------------------------------------------------

// --- Temporary frame profiler (auto-disables after 10 slow frames) --------
// --- Police felony accumulation (CCDS_Player.Scores) -------------------------

function updateFelony(dt) {
  const g = state.game;
  if (g.busted) return;
  if (!g.policeNearby) {
    // Felony decays when no police are nearby (~50s from 100→0)
    g.felony = Math.max(0, g.felony - dt * 2);
    return;
  }

  const FELONY_MP = 0.02;
  // Speeding >= 80 km/h
  if (g.speed >= 80) {
    g.felony += (g.speedingTime || 0) * FELONY_MP;
  }
  // Drifting
  if ((g.driftingTime || 0) > 0.5) {
    g.felony += (g.driftingTime || 0) * FELONY_MP;
  }
  // Stunting (airborne at speed)
  if ((g.stuntingTime || 0) > 0 && g.speed > 80) {
    g.felony += (g.stuntingTime || 0) * FELONY_MP;
  }

  g.felony = THREE.MathUtils.clamp(g.felony, 0, 100);
}

// --- Police busting logic (CCDS_Player.CheckBusted) --------------------------

function updateBusting(dt) {
  const g = state.game;
  if (g.busted) return;

  const BUSTING_MP = 20;

  // Busting decreases when not pursued, or when player is fast
  if (!g.inPursue || g.speed >= 40) {
    g.busting = Math.max(0, g.busting - dt * BUSTING_MP);
  }

  // When busting reaches 100 → busted: freeze car, show overlay
  if (g.busting >= 100) {
    g.busting = 100;
    g.busted = true;
    const penalty = Math.max(500, Math.round(save.playerMoney * 0.1));
    g.policeFineMoney = penalty;
    g.state = GAME_STATES.STOPPED;
  }

  // Siren audio follows pursuit state
  setPoliceSiren(g.inPursue);
}

let _profSlowCount = 0;
const _PROF_MAX = 10;

export function updateGame(dt) {
  if (state.route !== "game" || !state.game.active || !assets.loaded) return;
  if (state.game.state === GAME_STATES.COUNTDOWN) {
    state.game.countdownRemaining = Math.max(0, state.game.countdownRemaining - dt);
    if (state.game.countdownRemaining <= 0) state.game.state = GAME_STATES.STARTED;
    return;
  }
  if (state.game.state === GAME_STATES.PAUSED || state.game.state === GAME_STATES.STOPPED) return;

  const profiling = _profSlowCount < _PROF_MAX;
  const t0 = profiling ? performance.now() : 0;

  const forward = keys.get("KeyW") || keys.get("ArrowUp");
  const backward = keys.get("KeyS") || keys.get("ArrowDown");
  const left = keys.get("KeyA") || keys.get("ArrowLeft");
  const right = keys.get("KeyD") || keys.get("ArrowRight");
  const handbrake = keys.get("Space");
  const nos = keys.get("ShiftLeft") || keys.get("KeyN");
  const throttleInput = (forward ? 1 : 0) - (backward ? 0.7 : 0);
  const steerInput = (left ? 1 : 0) - (right ? 1 : 0);

  // Headlight toggle (L key — one-shot per press)
  if (keys.get("KeyL")) {
    keys.set("KeyL", false);
    state.game.headlightsOn = !state.game.headlightsOn;
  }

  const t1 = profiling ? performance.now() : 0;

  physics.fixedTimeAccumulator += Math.min(dt, 0.05);
  _cachedStats = null; // force re-fetch once per frame
  while (physics.fixedTimeAccumulator >= FIXED_TIMESTEP) {
    stepVehiclePhysics(FIXED_TIMESTEP, throttleInput, steerInput, handbrake, nos);
    physics.fixedTimeAccumulator -= FIXED_TIMESTEP;
  }
  followVisibleRoadSurface(dt);

  const t2 = profiling ? performance.now() : 0;

  // Visual + audio sync — once per render frame, after all physics ticks
  syncVehicleVisuals(dt);

  const t3 = profiling ? performance.now() : 0;

  stabilizeVehicleAboveGround();
  detectAndResolveStuck(dt, throttleInput);
  updateDamageEffects();

  // F3: Update vehicle headlights / brake lights — once per render frame
  vehicleVisualController.updateBrakeLights(
    assets,
    Math.max(state.game.brakeSmoothed ?? 0, state.game.handbrakeActive ? 1 : 0),
    !!state.game.headlightsOn,
    state.game.currentGear ?? 0
  );

  const t4 = profiling ? performance.now() : 0;

  // G1+G2: tire smoke & exhaust particles — once per render frame, NOT per substep
  updateTireSmoke(state.game._lastSkidAmount ?? 0, dt);
  updateExhaust(throttleInput, dt, state.game.speed, state.game.engineRPM ?? 0, 7000, state.game.nosActive ?? false);

  const t5 = profiling ? performance.now() : 0;

  if (world.carPivot.position.y < (state.game.spawnPosition?.y ?? 0) - 8) {
    // eslint-disable-next-line no-console
    console.warn(
      `[FallOutReset] pivotY=${world.carPivot.position.y.toFixed(3)} spawnY=${(state.game.spawnPosition?.y ?? 0).toFixed(3)}`
    );
    resetPhysicsVehicle(state.game.spawnPosition || MAIN_MENU_SPAWN.clone(), state.game.heading || MAIN_MENU_ROTATION_Y);
    world.carPivot.position.copy(state.game.spawnPosition || MAIN_MENU_SPAWN);
    world.carPivot.updateMatrixWorld(true);
  }

  updateFreeDriveEarnings(dt);

  // H5: update traffic NPC vehicles
  if (_trafficSystem) _trafficSystem.update(dt, world.carPivot.position);

  // Police felony / busting (CCDS_AI_Cop + CCDS_Player)
  updateFelony(dt);
  updateBusting(dt);

  const t6 = profiling ? performance.now() : 0;

  updateGameplayCamera(false, dt);

  if (state.game.missionTimeRemaining >= 0) {
    state.game.missionTimeRemaining = Math.max(0, state.game.missionTimeRemaining - dt);
    if (state.game.missionTimeRemaining <= 0) {
      _completeMission(false, `${currentMission().name} failed because the mission timer reached zero.`);
      return;
    }
  }

  const runtime = state.game.runtime;
  if (runtime && !state.game.complete) {
    if (runtime.type === "checkpoint") {
      updateSequentialMission(runtime, 2.4);
    }
    if (runtime.type === "trailblazer") {
      updateSequentialMission(runtime, 2.8);
    }
    if (runtime.type === "race") {
      updateRaceMission(runtime, dt);
    }
    if (runtime.type === "pursuit") {
      updatePursuitMission(runtime, dt);
    }
  }

  // Mission beacon proximity check (free drive only)
  _updateBeaconProximity();

  if (state.route !== "game" || !state.game.active) return;

  if (keys.get("KeyM")) {
    keys.set("KeyM", false);
    _setMessage("Returned to the drive menu.");
    _navigate("mission");
  }
  if (keys.get("KeyP")) {
    keys.set("KeyP", false);
    state.game.state = state.game.state === GAME_STATES.PAUSED ? GAME_STATES.STARTED : GAME_STATES.PAUSED;
  }

  // --- Profiling output (first N slow frames) ---
  if (profiling) {
    const total = performance.now() - t0;
    if (total > 14) {
      _profSlowCount++;
      // eslint-disable-next-line no-console
      console.warn(
        `[SlowFrame #${_profSlowCount}] total=${total.toFixed(1)}ms | ` +
        `physics=${(t2 - t1).toFixed(1)} visuals=${(t3 - t2).toFixed(1)} ` +
        `stabilize+brake=${(t4 - t3).toFixed(1)} smoke+exhaust=${(t5 - t4).toFixed(1)} ` +
        `traffic+camera=${(t6 - t5).toFixed(1)} rest=${(performance.now() - t6).toFixed(1)} ` +
        `speed=${(state.game.speed ?? 0).toFixed(0)}km/h brake=${(state.game.brakeSmoothed ?? 0).toFixed(2)}`
      );
    }
  }
}

// --- Post-processing (lazy init) -------------------------------------------

let _composer = null;

async function getComposer() {
  if (_composer) return _composer;
  const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
  const { RenderPass } = await import("three/addons/postprocessing/RenderPass.js");
  const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
  const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.3, 0.4, 0.85
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  _composer = composer;
  return composer;
}

// Warm-up: force GPU shader compilation for all render pipelines BEFORE
// gameplay starts. On Windows/ANGLE the first use of each WebGL program
// triggers synchronous GLSL→HLSL→D3D compilation that can block for ~3 s
// per shader. By rendering through the full bloom pipeline here, all
// shader programs are compiled during startGame() (perceived as load time)
// rather than stuttering during the first few gameplay frames.
//
// MUST be synchronous — async yields let animate() run before warm-up.
export function warmUpRenderPipeline() {
  const t0 = performance.now();

  // Temporarily reveal every hidden object AND disable frustum culling so
  // materials are compiled regardless of camera angle. Without this, objects
  // outside the warm-up camera frustum skip compilation and stutter later.
  const wasHidden = [];
  const wasCulled = [];
  scene.traverse((obj) => {
    if (!obj.visible) { obj.visible = true; wasHidden.push(obj); }
    if (obj.frustumCulled) { obj.frustumCulled = false; wasCulled.push(obj); }
  });

  // Render through the full bloom pipeline to force shader compilation
  if (save.imageEffects && _composer) {
    _composer.render();
    // eslint-disable-next-line no-console
    console.log(`[WarmUp] composer.render() done in ${(performance.now() - t0).toFixed(0)}ms`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[WarmUp] composer NOT available (imageEffects=${save.imageEffects}, composer=${!!_composer})`);
  }

  // Also compile the plain renderer path (no post-processing fallback)
  const t1 = performance.now();
  renderer.render(scene, camera);
  // eslint-disable-next-line no-console
  console.log(`[WarmUp] renderer.render() done in ${(performance.now() - t1).toFixed(0)}ms`);

  // Force GPU to finish all pending work (shader compilation, uploads)
  const gl = renderer.getContext();
  gl.finish();
  // eslint-disable-next-line no-console
  console.log(`[WarmUp] gl.finish() done — total=${(performance.now() - t0).toFixed(0)}ms`);

  // Restore visibility and frustum culling
  wasHidden.forEach((obj) => { obj.visible = false; });
  wasCulled.forEach((obj) => { obj.frustumCulled = true; });
}

// --- RAF loop -------------------------------------------------------------

const clock = new THREE.Clock();

export function animate(time) {
  // Schedule next frame FIRST — ensures the loop survives errors in the body
  requestAnimationFrame(animate);

  try {
    const frameStart = performance.now();
    const dt = clock.getDelta();

    updateAkronSceneTrafficLights(dt);
    if (assets.loaded && ["garage", "customize", "mission", "settings"].includes(state.route)) world.carPivot.rotation.y += 0.12 * dt;

    const aT1 = performance.now();
    updateGame(dt);
    const aT2 = performance.now();

    updateHud();
    const aT3 = performance.now();
    updateReflections();
    world.marker.scale.setScalar(1 + Math.sin(time * 0.004) * 0.08);
    world.beam.material.opacity = 0.22 + Math.sin(time * 0.004) * 0.08;
    // Animate mission beacons
    for (const b of _missionBeacons) {
      b.marker.scale.setScalar(1 + Math.sin(time * 0.003) * 0.1);
      const baseOpacity = b.beam.material.opacity > 0.35 ? 0.4 : 0.18;
      b.beam.material.opacity = baseOpacity + Math.sin(time * 0.003) * 0.08;
    }
    controls.update();

    // Shadow camera follows car during gameplay
    if (state.route === "game") {
      updateShadowCamera(world.carPivot.position);
    }

    const aT4 = performance.now();

    // Post-processing (bloom) when image effects enabled
    if (save.imageEffects && _composer) {
      _composer.render();
    } else {
      renderer.render(scene, camera);
    }

    const aT5 = performance.now();

    const totalFrame = aT5 - frameStart;
    if (totalFrame > 18 && state.route === "game" && _profSlowCount < _PROF_MAX + 5) {
      // eslint-disable-next-line no-console
      console.warn(
        `[AnimateFrame] total=${totalFrame.toFixed(1)}ms | ` +
        `game=${(aT2 - aT1).toFixed(1)} hud=${(aT3 - aT2).toFixed(1)} ` +
        `reflect+shadow=${(aT4 - aT3).toFixed(1)} render=${(aT5 - aT4).toFixed(1)}`
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[animate] frame error:", err);
  }
}

// Kick off composer init so it's ready when needed
getComposer().catch(() => {});
