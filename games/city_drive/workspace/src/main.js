import * as THREE from "three";
import { RCCPCarController } from "./vehicle/RCCPCarController.js";
import { rootAssetUrl, normalizeModel } from "./core/utils.js";
import { state, assets, save, physics } from "./core/state.js";
import {
  initPhysics,
  buildScenePhysics,
  rebuildVehiclePhysics,
  configurePhysics
} from "./physics/World.js";
import {
  loadCandidate,
  getMenuSurfaceHeight,
  applyMenuScene,
  configureCityLoader
} from "./scene/CityLoader.js";
import {
  applyUiSkin,
  syncViewportSize,
  applyUnityMenuLayout,
  applyUnityGameplayLayout,
  applyUnityMenuText
} from "./ui/UnityLayoutMapper.js";
import {
  clearGameplayPresentation,
  configureHud
} from "./ui/HUD.js";
import {
  playImpactSound,
  updateDamageEffects,
  deformVehicleAtImpact,
  playTurboBlowOff
} from "./effects/VehicleEffects.js";
import { configureMissionRuntime } from "./missions/MissionRuntime.js";
import { installInputListeners } from "./input/Keyboard.js";
import { setPresentationMode } from "./scene/MenuPresentation.js";
import { initSky } from "./scene/World.js";
import { currentVehicleLayout, currentVehicleDynamics } from "./core/selectors.js";
import { getGameplaySpawnAnchor } from "./missions/MissionLayouts.js";
import {
  updateMarker,
  updateGameplayCamera,
  configureGameLoop,
  animate
} from "./core/gameLoop.js";
import {
  formatCash,
  setMessage,
  persist,
  applySettings,
  completeMission,
  navigate,
  registerUiEvents,
  configureActions,
  startMissionFromFreeDrive
} from "./core/actions.js";
import {
  vehicleVisualController,
  applyVisuals,
  swapVehicleModel,
  configureVehicleOrchestration
} from "./vehicle/VehicleOrchestration.js";
import { setSceneText } from "./ui/domHelpers.js";
import { render } from "./ui/Router.js";
import { TrafficSystem } from "./traffic/TrafficSystem.js";
import { emitRuntimeReports } from "./core/runtimeReports.js";

const _loadingBar = document.getElementById("loading-bar-fill");
const _loadingStatus = document.getElementById("loading-status");
const _loadingScreen = document.getElementById("loading-screen");

function setLoadingProgress(pct, text) {
  if (_loadingBar) _loadingBar.style.width = `${pct}%`;
  if (_loadingStatus) _loadingStatus.textContent = text;
}

function dismissLoadingScreen() {
  const app = document.getElementById("app");
  if (app) app.classList.remove("is-loading");
  if (_loadingScreen) {
    _loadingScreen.classList.add("is-hidden");
    setTimeout(() => _loadingScreen.remove(), 700);
  }
}


window.addEventListener("resize", () => {
  syncViewportSize();
  applyUnityMenuLayout();
  applyUnityGameplayLayout();
});







































async function bootstrap() {
  try {
    installInputListeners();
    configureActions({ render, applyVisuals, swapVehicleModel });
    configureVehicleOrchestration({ render, setSceneText });
    configureCityLoader({ setPresentationMode });
    configureHud({
      formatCash,
      updateGameplayCamera,
      navigate,
      startMissionFromFreeDrive,
      persist
    });
    configureMissionRuntime({
      completeMission,
      updateMarker,
      trafficSystem
    });
    configureGameLoop({
      vehiclePhysicsController,
      setMessage,
      completeMission,
      navigate,
      persist,
      trafficSystem
    });
    configurePhysics({
      rootAssetUrl,
      getMenuSurfaceHeight,
      getGameplaySpawnAnchor,
      currentVehicleLayout,
      currentVehicleDynamics,
      vehiclePhysicsController,
      vehicleVisualController
    });
    clearGameplayPresentation();
    setSceneText("Boot", "Loading Assets", "Reading mapped FBX vehicle, spoiler, and wheel packs.");
    setLoadingProgress(5, "Initializing physics engine...");
    await initPhysics();
    setLoadingProgress(15, "Setting up sky environment...");
    initSky();
    setLoadingProgress(20, "Loading vehicle parts and city scene...");
    const [spoilerPack, wheelPack] = await Promise.all([
      loadCandidate("Models/Spoilers/SpoilersPack.FBX"),
      loadCandidate("Models/Wheels/WheelPack.FBX"),
      applyMenuScene()
    ]);
    setLoadingProgress(55, "Processing vehicle parts...");
    [spoilerPack, wheelPack].forEach(normalizeModel);
    spoilerPack.traverse((child) => {
      if (child.isMesh && child.name.startsWith("Spoiler_")) assets.spoilers.set(child.name, child);
    });
    wheelPack.traverse((child) => {
      if (child.isMesh && child.name.startsWith("Wheel_")) assets.wheels.set(child.name, child);
    });
    // Load decal textures from the asset directory
    const { DECALS, NEON_PROJECTOR } = await import("./vehicle/VehicleConfig.js");
    const texLoader = new THREE.TextureLoader();
    for (const decal of DECALS) {
      const url = rootAssetUrl(decal.texture);
      const tex = texLoader.load(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      assets.decalTextures.set(decal.id, tex);
    }
    // Load neon underglow TGA texture
    const { TGALoader } = await import("three/addons/loaders/TGALoader.js");
    assets.neonTexture = await new Promise((resolve) => {
      new TGALoader().load(
        rootAssetUrl(NEON_PROJECTOR.texture),
        (tex) => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); },
        undefined,
        () => resolve(null)
      );
    });
    assets.loaded = true;
    setLoadingProgress(70, "Applying graphics settings...");
    applySettings();
    setLoadingProgress(75, "Loading vehicle model...");
    await swapVehicleModel(state.vehicleId);
    setLoadingProgress(85, "Building collision physics...");
    buildScenePhysics();
    rebuildVehiclePhysics();
    setLoadingProgress(90, "Spawning traffic...");
    // H5: Initialize traffic system — load mesh + generate paths + spawn
    await trafficSystem.loadVehicleMeshes();
    console.log("[Traffic:main] loadVehicleMeshes done. sceneBounds?", !!physics.sceneBounds, "loaded?", trafficSystem.loaded);
    if (physics.sceneBounds) {
      // Use spawn position as center — the city geometry is concentrated
      // around the spawn, NOT centered on scene bounds.
      const spawnCenter = state.game?.spawnPosition
        || new THREE.Vector3(-2773.45, 100.9, -843.8); // MAIN_MENU_SPAWN fallback
      const surfaceY = getMenuSurfaceHeight(spawnCenter);
      if (surfaceY != null) spawnCenter.y = surfaceY;
      trafficSystem.generateWaypoints(physics.sceneBounds, spawnCenter);
      const count = Math.round((save.trafficIntensity ?? 0.62) * 20);
      trafficSystem.spawn(count, physics.sceneBounds);
    }
    setLoadingProgress(100, "Ready!");
    render();
    emitRuntimeReports({ assets, world: (await import("./scene/World.js")).world, playerVehicle: state.vehicleId });
    dismissLoadingScreen();
  } catch (error) {
    console.error(error);
    setSceneText("Error", "Asset Load Failed", "Open the project through a local static server and confirm unity_assets is reachable.");
    dismissLoadingScreen();
  }
}

const MAX_DEFORMATIONS = 10;

const vehiclePhysicsController = new RCCPCarController({
  getCurrentDynamics: currentVehicleDynamics,
  onTurboBlowOff: playTurboBlowOff,
  onImpact: ({ collisionForce, direction, otherColliderHandle, gameState, worldCarPivot, physics: currentPhysics }) => {
    // At very low speed the car is just rubbing the wall — apply light damage
    // but skip the expensive visual effects (mesh deformation, sparks, sound)
    // that cause frame budget blowout during sustained contact.
    const lowSpeedContact = gameState.speed < 8;

    const addedDamage = THREE.MathUtils.clamp(collisionForce / 240, lowSpeedContact ? 0.5 : 1.5, lowSpeedContact ? 4 : 18);
    gameState.damage = THREE.MathUtils.clamp(gameState.damage + addedDamage, 0, 100);
    currentPhysics.impactCooldown = 0.45;

    // CCDS_Player.OnCollisionEnter: collision with police car → felony boost
    if (otherColliderHandle != null && trafficSystem.isPoliceCollider(otherColliderHandle)) {
      if (gameState.felony < 25) gameState.felony = 25;
      else gameState.felony = Math.min(100, gameState.felony + 10);
    }

    if (lowSpeedContact) {
      // Minimal feedback for wall rubbing — just update damage visuals
      updateDamageEffects();
      return;
    }

    currentPhysics.cameraShake = Math.max(currentPhysics.cameraShake, Math.min(0.35, collisionForce / 4200));
    playImpactSound(collisionForce);
    if (currentPhysics.sparks) {
      currentPhysics.sparks.position.copy(worldCarPivot.position).add(direction.clone().multiplyScalar(currentPhysics.carHalfExtents.z * 0.9));
      currentPhysics.sparks.material.opacity = 0.8;
    }
    // Cap total deformations to prevent accumulated vertex corruption + GPU stalls
    gameState._deformCount = (gameState._deformCount || 0);
    if (gameState._deformCount < MAX_DEFORMATIONS) {
      deformVehicleAtImpact(worldCarPivot.position.clone().add(direction.clone().multiplyScalar(currentPhysics.carHalfExtents.z * 0.75)), collisionForce);
      gameState._deformCount++;
    }
    updateDamageEffects();
  }
});

const trafficSystem = new TrafficSystem();

applyUiSkin();
applyUnityMenuText();
applyUnityMenuLayout();
applyUnityGameplayLayout();
registerUiEvents();
render();
bootstrap();

animate(0);
