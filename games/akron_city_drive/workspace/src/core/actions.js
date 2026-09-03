// Action layer: navigation, persistence, purchases, settings, mission lifecycle.
//
// Ported from the inline action-layer section of main.js. `render`,
// `applyVisuals`, and `swapVehicleModel` still live in main.js (they couple
// to the route renderers + vehicle orchestration), so they are injected
// via `configureActions({...})` during bootstrap.

import * as THREE from "three";
import {
  SAVE_KEY,
  VEHICLES,
  GAME_STATES,
  MAIN_MENU_ROTATION_Y,
  MISSIONS
} from "./config.js";
import { SPOILERS, WHEELS, NEONS, getDefaultVehicleSetup, mergeVehicleSetup, upgradeNextPrice } from "../vehicle/VehicleConfig.js";
import { state, save, ui, assets } from "./state.js";
import { renderer, scene, sun, world, camera } from "../scene/World.js";
import { resetPhysicsVehicle } from "../physics/World.js";
import {
  pick,
  currentVehicle,
  currentMission,
  currentSetup,
  savedSetup
} from "./selectors.js";
import {
  buildWorldMissionLayout,
  getGameplaySpawnAnchor,
  resolveGameplaySpawnPosition
} from "../missions/MissionLayouts.js";
import { createMissionRuntime, cleanupMissionVisuals } from "../missions/MissionRuntime.js";
import { updateMarker, updateGameplayCamera, recenterTraffic, warmUpRenderPipeline, spawnMissionBeacons, clearMissionBeacons } from "./gameLoop.js";
import { clearGameplayPresentation } from "../ui/HUD.js";
import { clearPressedKeys, focusGameplayViewport } from "../input/Keyboard.js";
import { startMusic, stopMusic, playCashSound, playUiClickSound, warmUpParticleSystems } from "../effects/VehicleEffects.js";

// --- Injected dependencies (main.js still owns these) ---------------------

let _render = () => {};
let _applyVisuals = () => {};
let _swapVehicleModel = async () => {};

export function configureActions({
  render,
  applyVisuals,
  swapVehicleModel
} = {}) {
  if (render) _render = render;
  if (applyVisuals) _applyVisuals = applyVisuals;
  if (swapVehicleModel) _swapVehicleModel = swapVehicleModel;
}

// --- Formatting -----------------------------------------------------------

export function formatCash(value) {
  return `$ ${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
}

// --- Core actions ---------------------------------------------------------

export function setMessage(message = "") {
  state.message = message;
}

export function persist() {
  save.selectedVehicle = VEHICLES.findIndex((vehicle) => vehicle.id === state.vehicleId);
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

export function applySettings() {
  // Shadows toggle
  renderer.shadowMap.enabled = save.shadows;
  sun.castShadow = save.shadows;

  // Graphics quality → shadow resolution + pixel ratio
  const qualityMap = {
    low: { shadowSize: 0, pixelRatio: 1 },
    medium: { shadowSize: 512, pixelRatio: 1.5 },
    high: { shadowSize: 1024, pixelRatio: 2 },
    ultra: { shadowSize: 2048, pixelRatio: Math.min(devicePixelRatio, 2) }
  };
  const q = qualityMap[save.graphicsQuality] || qualityMap.ultra;
  if (save.shadows && q.shadowSize > 0) {
    sun.shadow.mapSize.width = q.shadowSize;
    sun.shadow.mapSize.height = q.shadowSize;
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  renderer.setPixelRatio(q.pixelRatio);

  // Image effects → tone mapping
  renderer.toneMapping = save.imageEffects ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = save.imageEffects ? 1.08 : 1;

  // Draw distance → fog far
  const fogFar = 400 + (save.drawDistance ?? 0.58) * 2400;
  if (scene.fog) scene.fog.far = fogFar;
}

export function resetSave() {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

// --- Customization --------------------------------------------------------

export function restoreDraft() {
  state.draft = mergeVehicleSetup(savedSetup());
  _applyVisuals();
  _render();
}

export async function setVehicle(id) {
  state.vehicleId = id;
  if (!save.vehicleSetups[id]) save.vehicleSetups[id] = getDefaultVehicleSetup();
  await _swapVehicleModel(id);
  restoreDraft();
}

export async function selectVehicleAndReturnToMain(id) {
  await setVehicle(id);
  persist();
  navigate("main");
}

export async function buyVehicle(id) {
  const vehicle = pick(VEHICLES, id);
  const vehicleIndex = VEHICLES.findIndex((item) => item.id === id);
  if (save.playerMoney < vehicle.price) {
    setMessage(`Not enough money to purchase ${vehicle.label}. Need $${vehicle.price - save.playerMoney} more.`);
    _render();
    return;
  }
  save.playerMoney -= vehicle.price;
  if (!save.ownedVehicles.includes(vehicleIndex)) save.ownedVehicles.push(vehicleIndex);
  setMessage(`${vehicle.label} purchased and unlocked.`);
  await setVehicle(id);
  persist();
  _render();
}

export function applyPurchase() {
  const next = currentSetup();
  const prev = savedSetup();
  const nextTotal = next.spoiler.price + next.wheel.price;
  const prevTotal = pick(SPOILERS, prev.spoiler).price + pick(WHEELS, prev.wheel).price;
  let delta = Math.max(0, nextTotal - prevTotal);
  // Add progressive upgrade costs
  ["engine", "handling", "speed"].forEach((key) => {
    const newLvl = state.draft.upgrades?.[key] ?? 0;
    const oldLvl = prev.upgrades?.[key] ?? 0;
    for (let i = oldLvl; i < newLvl; i++) delta += upgradeNextPrice(i);
  });
  // Add neon cost
  if (state.draft.neon && state.draft.neon !== prev.neon) {
    const neonEntry = NEONS.find((n) => n.id === state.draft.neon);
    if (neonEntry) delta += neonEntry.price;
  }
  if (save.playerMoney < delta) {
    setMessage(`Not enough money to purchase the cart. Need $${delta - save.playerMoney} more.`);
    _render();
    return;
  }
  save.playerMoney -= delta;
  save.vehicleSetups[state.vehicleId] = { ...state.draft };
  setMessage(`Customization saved for ${currentVehicle().label}.`);
  persist();
  _render();
}

// --- Settings -------------------------------------------------------------

export function adjustSetting(key, step) {
  save[key] = Math.min(1, Math.max(0, Number((save[key] + step).toFixed(2))));
  persist();
  _render();
}

export function toggleSetting(key) {
  save[key] = !save[key];
  applySettings();
  persist();
  _render();
}

// --- Mission lifecycle ----------------------------------------------------

function headingForCarForwardToward(from, to) {
  return Math.atan2(from.x - to.x, from.z - to.z);
}

function resolveMissionStartTransform(missionId, fallbackPosition, fallbackHeading) {
  const sceneLayout = buildWorldMissionLayout(missionId);
  const baseStartPosition = sceneLayout?.startPosition || fallbackPosition;
  const startPosition = resolveGameplaySpawnPosition(baseStartPosition);
  const previewTarget = sceneLayout?.targets?.[0] || sceneLayout?.path?.[0] || sceneLayout?.markers?.[0] || null;
  const startHeading = previewTarget
    ? headingForCarForwardToward(startPosition, previewTarget)
    : fallbackHeading;
  return { startPosition, startHeading };
}

function transportPlayer(position, heading) {
  world.carPivot.position.copy(position);
  world.carPivot.rotation.set(0, heading, 0);
  world.carPivot.updateMatrixWorld(true);
  resetPhysicsVehicle(position, heading);
  recenterTraffic(position);
}

export function completeMission(success, message) {
  // Clean up mission visuals (indicators, race cars, pursuit car)
  cleanupMissionVisuals(state.game.runtime);
  const returnPosition = state.game.missionReturnPosition?.clone?.() || null;
  const returnHeading = state.game.missionReturnHeading ?? state.game.heading ?? world.carPivot.rotation.y ?? 0;
  const returnScene = state.game.missionReturnScene;

  if (success) {
    if (!save.completed.includes(currentMission().id)) save.completed.push(currentMission().id);
    if (currentMission().rewardPlayer) {
      save.playerMoney += currentMission().reward;
      playCashSound();
    }
    save.firstGameplay = false;
  }

  setMessage(message);
  if (typeof returnScene === "number") save.selectedScene = returnScene;
  persist();

  // Return to free drive with beacons instead of going to menu
  state.missionId = "free";
  state.game.complete = false;
  state.game.active = true;
  state.game.state = GAME_STATES.STARTED;
  state.game.countdownRemaining = 0;
  state.game.missionTimeRemaining = -1;
  state.game.runtime = { type: "free" };
  state.game.nearMission = null;
  state.game.freeDriveDistance = 0;
  state.game.freeDriveRewardDistance = 0;
  state.game.freeDriveSessionMoney = 0;
  state.game.missionReturnPosition = null;
  state.game.missionReturnHeading = null;
  state.game.missionReturnScene = null;
  if (returnPosition) {
    transportPlayer(returnPosition, returnHeading);
    state.game.spawnPosition = returnPosition.clone();
    state.game.heading = returnHeading;
    state.game.lastPosition = returnPosition.clone();
  } else {
    state.game.lastPosition = world.carPivot.position.clone();
  }
  updateMarker();
  spawnMissionBeacons();
  _render();
}

export function startMissionFromFreeDrive(missionId) {
  // Match the Unity marker flow: teleport to the mission's authored start,
  // then restore the player to free-drive when the mission ends.
  clearMissionBeacons();
  const freeDrivePosition = world.carPivot.position.clone();
  const freeDriveHeading = state.game.heading ?? world.carPivot.rotation.y ?? 0;
  const { startPosition, startHeading } = resolveMissionStartTransform(
    missionId,
    freeDrivePosition,
    freeDriveHeading
  );
  state.game.nearMission = null;
  state.game.missionReturnPosition = freeDrivePosition;
  state.game.missionReturnHeading = freeDriveHeading;
  state.game.missionReturnScene = save.selectedScene;
  state.missionId = missionId;
  const mission = currentMission();

  transportPlayer(startPosition, startHeading);
  state.game.spawnPosition = startPosition.clone();
  state.game.heading = startHeading;
  state.game.lastPosition = startPosition.clone();

  // Create mission runtime (spawns visual indicators, race opponents, etc.)
  state.game.runtime = createMissionRuntime(mission);

  // Countdown then start
  state.game.state = mission.startMissionInstantly ? GAME_STATES.STARTED : GAME_STATES.COUNTDOWN;
  state.game.countdownRemaining = mission.startMissionInstantly ? 0 : 3;
  state.game.missionTimeRemaining = mission.timeLimited ? mission.time : -1;
  state.game.complete = false;

  // Reset free drive tracking
  state.game.freeDriveDistance = 0;
  state.game.freeDriveRewardDistance = 0;
  state.game.freeDriveSessionMoney = 0;

  updateMarker();
  focusGameplayViewport();
  _render();
}

export function startGame() {
  const mission = currentMission();
  const sceneLayout = buildWorldMissionLayout(mission.id);
  const baseStartPosition = sceneLayout?.startPosition || getGameplaySpawnAnchor();
  const startPosition = resolveGameplaySpawnPosition(baseStartPosition);
  const previewTarget = sceneLayout?.targets?.[0] || sceneLayout?.path?.[0] || sceneLayout?.markers?.[0] || null;
  const startHeading = previewTarget
    ? headingForCarForwardToward(startPosition, previewTarget)
    : 0;
  document.activeElement?.blur?.();
  state.gameplayOrigin.set(0, 0, 0);
  state.levelType = "Gameplay";
  state.game = {
    active: true,
    speed: 0,
    driveSpeed: 0,
    heading: startHeading,
    damage: 0,
    spawnPosition: startPosition.clone(),
    complete: false,
    state: mission.startMissionInstantly ? GAME_STATES.STARTED : GAME_STATES.COUNTDOWN,
    countdownRemaining: mission.startMissionInstantly ? 0 : 3,
    missionTimeRemaining: mission.timeLimited ? mission.time : -1,
    runtime: createMissionRuntime(mission),
    freeDriveDistance: 0,
    freeDriveRewardDistance: 0,
    freeDriveSessionMoney: 0,
    lastPosition: startPosition.clone(),
    missionReturnPosition: null,
    missionReturnHeading: null,
    missionReturnScene: null,
    missionBeaconOrigin: mission.id === "free" ? startPosition.clone() : null,
    missionBeaconHeading: mission.id === "free" ? startHeading : null,
    // Police / felony (CCDS_Player + CCDS_AI_Cop)
    felony: 0,
    busting: 0,
    policeNearby: false,
    inPursue: false,
    busted: false,
    policeFineMoney: 0
  };
  world.carPivot.position.copy(startPosition);
  world.carPivot.rotation.set(0, startHeading, 0);
  resetPhysicsVehicle(startPosition, startHeading);
  recenterTraffic(startPosition);
  warmUpParticleSystems();
  // Position the camera at the gameplay viewpoint BEFORE the warm-up render
  // so that frustum culling includes the correct objects.
  updateGameplayCamera(true);
  // Force GPU shader compilation for the full render pipeline BEFORE
  // gameplay begins. On Windows/ANGLE, the first use of each WebGL shader
  // triggers synchronous GLSL→HLSL→D3D compilation that blocks for seconds.
  warmUpRenderPipeline();
  focusGameplayViewport();
  updateMarker();
  startMusic(0);
  // Spawn mission beacons in free drive mode
  if (mission.id === "free") spawnMissionBeacons();
  _render();
}

function restoreVehicleMesh() {
  if (!assets.car) return;
  assets.car.traverse((child) => {
    if (!child.isMesh || !child.userData.basePositions) return;
    const pos = child.geometry.attributes.position;
    if (pos && pos.array.length === child.userData.basePositions.length) {
      pos.array.set(child.userData.basePositions);
      pos.needsUpdate = true;
      child.geometry.computeBoundingSphere();
    }
  });
}

export function navigate(route) {
  clearPressedKeys();
  const leavingGarage = (state.route === "garage" || state.route === "customize") && route === "main";
  state.route = route;
  state.levelType = route === "game" ? "Gameplay" : "MainMenu";
  if (leavingGarage) {
    const savedId = VEHICLES[save.selectedVehicle]?.id || VEHICLES[0].id;
    if (state.vehicleId !== savedId) {
      setVehicle(savedId);
    }
  }
  if (route === "customize") {
    state.customizeTab = null;
    state.mechanicPicker = null;
    restoreDraft();
  }
  if (route === "game") startGame();
  else {
    stopMusic();
    clearGameplayPresentation();
    state.game.active = false;
    state.game.state = GAME_STATES.STOPPED;
    state.game.damage = 0;
    state.game.runtime = null;
    state.game.lastPosition = null;
    // Restore vehicle to clean state after gameplay (undo dent deformation,
    // re-apply paint + wheel setup so no duplicate wheels appear in menu)
    restoreVehicleMesh();
    _applyVisuals();
    _render();
  }
}

// --- UI event wiring ------------------------------------------------------

export function registerUiEvents() {
  ui.testingToggle?.addEventListener("click", () => {
    ui.app.classList.toggle("is-testing-collapsed");
  });

  ui.addMoney?.addEventListener("click", () => {
    save.playerMoney += 10000;
    setMessage("Added $10000 through the testing panel.");
    persist();
    _render();
  });

  ui.unlockCars?.addEventListener("click", () => {
    save.ownedVehicles = VEHICLES.map((_, index) => index);
    setMessage("All vehicles unlocked.");
    persist();
    _render();
  });

  ui.resetSave?.addEventListener("click", resetSave);
  ui.utilityControlsBtn?.addEventListener("click", () => navigate("settings"));
  ui.utilityImageFxBtn?.addEventListener("click", () => toggleSetting("imageEffects"));
  ui.utilityShadowsBtn?.addEventListener("click", () => toggleSetting("shadows"));
  ui.profileSubmitBtn?.addEventListener("click", () => {
    const nextName = ui.profileNameInput?.value?.trim();
    if (!nextName) return;
    save.playerName = nextName;
    save.firstGameplay = false;
    persist();
    _render();
  });
  ui.profileNameInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    ui.profileSubmitBtn?.click();
  });
  ui.driveBtn?.addEventListener("click", () => navigate("mission"));
  ui.vehiclesBtn?.addEventListener("click", () => navigate("garage"));
  ui.customizeBtn?.addEventListener("click", () => navigate("customize"));
  ui.settingsBtn?.addEventListener("click", () => navigate("settings"));
  ui.quitBtn?.addEventListener("click", () => {
    setMessage("Quit is not available in the browser build.");
    _render();
  });

  // Global UI click sound for all interactive elements
  document.addEventListener("click", (e) => {
    if (e.target.closest("button, [data-action], .unity-btn, .unity-vehicle-card, .unity-tab")) {
      playUiClickSound();
    }
  });
}
