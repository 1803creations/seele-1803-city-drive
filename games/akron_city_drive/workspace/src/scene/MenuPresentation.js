// Menu-route camera/car placement + scene background switching.
//
// Ported from the inline menu-presentation section of main.js. These
// helpers pin the player car and OrbitControls to the per-route
// presentation pose (defined in core/config.MENU_PRESENTATION) whenever
// the router navigates between main/garage/customize/mission/settings,
// and swap scene background/fog/FOV between menu and gameplay.

import * as THREE from "three";
import {
  MAIN_MENU_SCENE,
  MAIN_MENU_SPAWN,
  MAIN_MENU_CAMERA,
  MAIN_MENU_TARGET,
  MAIN_MENU_ROTATION_Y,
  MENU_ROUTES,
  MENU_PRESENTATION
} from "../core/config.js";
import { ui, state, save, assets } from "../core/state.js";
import { scene, camera, controls, menuSun, world, applySkyPreset, hideSky } from "./World.js";
import { placeMenuScene, getMenuSurfaceHeight } from "./CityLoader.js";
import { syncVehiclePhysicsToMenu } from "../physics/World.js";
import { getCarFocusPoint, ensureCarVisibleState } from "../vehicle/VehicleAssembly.js";
import { currentScene } from "../core/selectors.js";

export function getMenuCarPosition(route) {
  if (route === "main") {
    return MAIN_MENU_SPAWN.clone();
  }
  const fallbackCar = MENU_PRESENTATION[route]?.carPosition || new THREE.Vector3();
  return MAIN_MENU_SPAWN.clone().add(fallbackCar);
}

export function getSnappedMenuCarPosition(route) {
  const position = getMenuCarPosition(route);
  const surfaceY = getMenuSurfaceHeight(position);
  if (!Number.isFinite(surfaceY)) return position;

  const snapped = position.clone();
  snapped.y = surfaceY;
  return snapped;
}

export function getMenuTarget(route) {
  if (route === "main") return MAIN_MENU_TARGET.clone();
  const fallbackTarget = MENU_PRESENTATION[route]?.target || MENU_PRESENTATION.main.target;
  return MAIN_MENU_SPAWN.clone().add(fallbackTarget);
}

export function getMenuCameraPosition(route) {
  if (route === "main") {
    return MAIN_MENU_CAMERA.clone();
  }
  const fallbackCamera = MENU_PRESENTATION[route]?.camera || MENU_PRESENTATION.main.camera;
  return MAIN_MENU_SPAWN.clone().add(fallbackCamera);
}

export function setPresentationMode() {
  const isMenuRoute = MENU_ROUTES.includes(state.route);
  const isGameplayRoute = state.route === "game";
  const presentation = MENU_PRESENTATION[state.route] || MENU_PRESENTATION.main;
  ui.app.dataset.route = state.route;
  world.menuBackdrop.visible = isGameplayRoute || isMenuRoute;
  controls.enabled = state.route !== "game";
  controls.autoRotate = isMenuRoute && state.route === "main";
  controls.autoRotateSpeed = 1.0;
  // Use intensity instead of visible to avoid changing the active light count,
  // which forces Three.js to recompile ALL scene shaders (~3s on Windows/ANGLE).
  const menuSunIntensity = MAIN_MENU_SCENE.directionalLight?.intensity ?? 1.25;
  menuSun.intensity = (isMenuRoute || isGameplayRoute) ? menuSunIntensity : 0;
  if (assets.menuScene) {
    placeMenuScene(assets.menuScene);
  }

  if (isMenuRoute) {
    hideSky();
    scene.background = new THREE.Color(0xcfe8ff);
    scene.fog = new THREE.Fog(0xcfe8ff, 450, 2200);
    camera.fov = MAIN_MENU_SCENE.camera?.fieldOfView ?? 34;
    camera.updateProjectionMatrix();
  } else if (isGameplayRoute) {
    const sceneData = currentScene();
    const isMidnight = sceneData && (/city[_\s]?2/i.test(sceneData.name) || /city[_\s]?2/i.test(sceneData.label));
    const fogColor = applySkyPreset(isMidnight);
    scene.fog = new THREE.Fog(fogColor, 120, 400 + (save.drawDistance ?? 0.58) * 2400);
    camera.fov = 60;
    camera.updateProjectionMatrix();
  } else {
    hideSky();
    scene.background = new THREE.Color(0x1c1914);
    scene.fog = new THREE.Fog(0x1c1914, 12, 150);
    camera.fov = 42;
    camera.updateProjectionMatrix();
  }

  if (state.presentationRoute === state.route) {
    return;
  }
  state.presentationRoute = state.route;

  if (isMenuRoute) {
    world.marker.visible = false;
    world.beam.visible = false;
    world.road.visible = false;
    world.pad.visible = false;
    world.grass.visible = false;
    ensureCarVisibleState();
    world.carPivot.position.copy(getSnappedMenuCarPosition(state.route));
    world.carPivot.rotation.set(0, state.route === "main" ? MAIN_MENU_ROTATION_Y : (presentation.rotationY ?? MAIN_MENU_ROTATION_Y), 0);
    world.carPivot.updateMatrixWorld(true);
    syncVehiclePhysicsToMenu();
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 16;
    controls.minPolarAngle = Math.PI * 0.24;
    controls.maxPolarAngle = Math.PI * 0.48;
    const focusTarget = getCarFocusPoint(getMenuTarget(state.route));
    controls.target.copy(focusTarget);
    camera.position.copy(getMenuCameraPosition(state.route));
    if (state.route === "main") {
      camera.lookAt(focusTarget);
    } else if (presentation.quaternion) {
      camera.quaternion.copy(presentation.quaternion);
    } else {
      camera.lookAt(controls.target);
    }
    controls.update();
    return;
  }

  if (isGameplayRoute) {
    world.road.visible = false;
    world.pad.visible = false;
    world.grass.visible = false;
    menuSun.intensity = 0;
    ensureCarVisibleState();
    controls.enablePan = false;
    controls.minDistance = 2;
    controls.maxDistance = 40;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI * 0.48;
    return;
  }

  world.menuBackdrop.visible = false;
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 40;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI * 0.48;
}
