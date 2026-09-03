// THREE.js scene primitives: renderer, scene, camera, controls, lights,
// world groups, loader, reflection probe. This module owns the module-level
// singletons that every other renderer-facing system imports from.
//
// Side effects on import:
//   - Creates the WebGLRenderer and appends its canvas to #scene-root.
//   - Creates the Scene, Camera, OrbitControls.
//   - Creates the default lights (hemisphere, sun, rim, menuSun).
//   - Creates the world group hierarchy (menuStage, menuBackdrop, carPivot,
//     marker, beam, reflectionProbe) and attaches it to the scene.
//   - Creates the FBXLoader + LoadingManager shared by every asset load.
//   - Creates the CubeCamera / reflection target.
//
// Consumers import the named exports and mutate them in-place (positions,
// visibility, children) — matching the pre-refactor main.js behaviour.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { Sky } from "three/addons/objects/Sky.js";
import { ui } from "../core/state.js";
import { MAIN_MENU_SCENE } from "../core/config.js";
import { quaternionFromData } from "../core/utils.js";

// --- Renderer ---------------------------------------------------------------

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(ui.root.clientWidth, ui.root.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "Game viewport");
ui.root.appendChild(renderer.domElement);

// Detect GPU driver crash / WebGL context loss
renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  // eslint-disable-next-line no-console
  console.error("[WebGL] CONTEXT LOST — GPU driver crashed. Attempting restore…");
});
renderer.domElement.addEventListener("webglcontextrestored", () => {
  // eslint-disable-next-line no-console
  console.warn("[WebGL] Context restored.");
});

// --- Scene + camera + controls ---------------------------------------------

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1914);
scene.fog = new THREE.Fog(0x1c1914, 12, 150);

export const camera = new THREE.PerspectiveCamera(
  42,
  ui.root.clientWidth / ui.root.clientHeight,
  0.01,
  10000
);
camera.position.set(7, 3.5, 9);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.7, 0);
controls.maxPolarAngle = Math.PI * 0.48;

// --- Lights -----------------------------------------------------------------

export const hemiLight = new THREE.HemisphereLight(0xfff1d4, 0x18200d, 1.8);
scene.add(hemiLight);

export const sun = new THREE.DirectionalLight(0xfff1d2, 3);
sun.position.set(14, 16, 7);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.001;
scene.add(sun);

export const rim = new THREE.DirectionalLight(0x93d8ff, 1.4);
rim.position.set(-10, 5, -8);
scene.add(rim);

const menuSunColor = MAIN_MENU_SCENE.directionalLight?.color || { r: 1, g: 1, b: 1 };
export const menuSun = new THREE.DirectionalLight(
  new THREE.Color(menuSunColor.r ?? 1, menuSunColor.g ?? 1, menuSunColor.b ?? 1),
  MAIN_MENU_SCENE.directionalLight?.intensity ?? 1.25
);
const mainMenuLightDirection = new THREE.Vector3(0, 0, 1)
  .applyQuaternion(quaternionFromData(MAIN_MENU_SCENE.directionalLight?.transform?.rotation))
  .normalize();
menuSun.position.copy(mainMenuLightDirection.clone().multiplyScalar(-60));
menuSun.target.position.set(0, 0, 0);
scene.add(menuSun);
scene.add(menuSun.target);

// --- World group hierarchy --------------------------------------------------

export const world = {
  root: new THREE.Group(),
  carPivot: new THREE.Group(),
  menuStage: new THREE.Group(),
  menuBackdrop: new THREE.Group(),
  grass: new THREE.Mesh(
    new THREE.CircleGeometry(30, 100),
    new THREE.MeshStandardMaterial({ color: 0x7e9436, roughness: 0.95 })
  ),
  pad: new THREE.Mesh(
    new THREE.CircleGeometry(8, 80),
    new THREE.MeshStandardMaterial({ color: 0xa79777, roughness: 1 })
  ),
  road: new THREE.Mesh(
    new THREE.PlaneGeometry(160, 160),
    new THREE.MeshStandardMaterial({ color: 0x525252, roughness: 0.95 })
  ),
  menuGrassPatch: new THREE.Mesh(
    new THREE.PlaneGeometry(18, 16),
    new THREE.MeshStandardMaterial({ color: 0xa7b05a, roughness: 1 })
  ),
  menuSidewalk: new THREE.Mesh(
    new THREE.PlaneGeometry(28, 22),
    new THREE.MeshStandardMaterial({ color: 0xb8b2a4, roughness: 0.96 })
  ),
  menuRoadbed: new THREE.Mesh(
    new THREE.PlaneGeometry(18, 24),
    new THREE.MeshStandardMaterial({ color: 0x686868, roughness: 0.98 })
  ),
  menuCurb: new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.18, 20),
    new THREE.MeshStandardMaterial({ color: 0xd2c5ae, roughness: 0.92 })
  ),
  menuBuilding: new THREE.Mesh(
    new THREE.BoxGeometry(18, 9.5, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x727565, roughness: 1 })
  ),
  menuBuildingWing: new THREE.Mesh(
    new THREE.BoxGeometry(6.5, 9.5, 7.5),
    new THREE.MeshStandardMaterial({ color: 0x7b7f71, roughness: 1 })
  ),
  menuWindowBand: new THREE.Mesh(
    new THREE.PlaneGeometry(10.8, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.18, metalness: 0.08 })
  ),
  marker: new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 0.08, 32),
    new THREE.MeshStandardMaterial({ color: 0xffb11b, emissive: 0x4d2b00 })
  ),
  beam: new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.7, 5.4, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc76c,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide
    })
  ),
  reflectionProbe: new THREE.Group()
};

world.grass.rotation.x = world.pad.rotation.x = world.road.rotation.x = -Math.PI / 2;
world.menuGrassPatch.rotation.x =
  world.menuSidewalk.rotation.x =
  world.menuRoadbed.rotation.x =
    -Math.PI / 2;
world.grass.position.y = world.pad.position.y = world.road.position.y = -0.62;
world.menuGrassPatch.position.set(-4.8, -0.618, 1.5);
world.menuSidewalk.position.set(8.4, -0.604, 1.2);
world.menuRoadbed.position.set(23.6, -0.626, 1.2);
world.menuCurb.position.set(1.55, -0.516, 1.2);
world.menuBuilding.position.set(-5.8, 4.1, -8.1);
world.menuBuildingWing.position.set(5.1, 4.1, -5.1);
world.menuWindowBand.position.set(-6.1, 4.6, -7.35);
world.marker.position.y = -0.58;
world.beam.position.y = 2.1;
world.menuWindowBand.rotation.y = Math.PI;
world.menuStage.add(
  world.menuRoadbed,
  world.menuSidewalk,
  world.menuGrassPatch,
  world.menuCurb,
  world.menuBuilding,
  world.menuBuildingWing,
  world.menuWindowBand
);
world.root.add(
  world.road,
  world.grass,
  world.pad,
  world.marker,
  world.beam,
  world.menuBackdrop,
  world.carPivot,
  world.reflectionProbe
);
scene.add(world.root);

// --- Loader + reflection probe ---------------------------------------------

export const loader = new FBXLoader();
export const manager = new THREE.LoadingManager();
loader.manager = manager;
manager.addHandler(/\.tga$/i, new TGALoader(manager));

export const reflectionTarget = new THREE.WebGLCubeRenderTarget(256, {
  generateMipmaps: true,
  minFilter: THREE.LinearMipmapLinearFilter,
  colorSpace: THREE.SRGBColorSpace
});
export const reflectionCamera = new THREE.CubeCamera(0.1, 300, reflectionTarget);
world.reflectionProbe.add(reflectionCamera);

// --- Shadow camera follow (called from gameLoop) ----------------------------

export function updateShadowCamera(targetPos) {
  if (!sun.castShadow || !targetPos) return;
  const offset = sun.position.clone().normalize().multiplyScalar(80);
  sun.position.copy(targetPos).add(offset);
  sun.target.position.copy(targetPos);
  sun.target.updateMatrixWorld();
}

// --- Skybox loading ---------------------------------------------------------

export function loadSkybox(rootAssetUrl) {
  const cubeLoader = new THREE.CubeTextureLoader();
  const urls = [
    rootAssetUrl("Skybox/sky_right.png"),
    rootAssetUrl("Skybox/sky_left.png"),
    rootAssetUrl("Skybox/sky_up.png"),
    rootAssetUrl("Skybox/sky_down.png"),
    rootAssetUrl("Skybox/sky_front.png"),
    rootAssetUrl("Skybox/sky_back.png")
  ];
  cubeLoader.load(urls, (cubeTexture) => {
    scene.background = cubeTexture;
    scene.environment = cubeTexture;
  });
}

// --- Procedural sky (Three.js Sky = Preetham atmospheric model) -----------

export const sky = new Sky();
sky.scale.setScalar(50000);
sky.visible = false;
scene.add(sky);

let pmremGenerator = null;
let currentSkyEnvMap = null;
let activeSkyPreset = null;

const DAY_PRESET = {
  turbidity: 2,
  rayleigh: 1,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  elevation: 65,
  azimuth: 150,
  exposure: 0.5,
  sunColor: new THREE.Color(1, 1, 1),
  sunIntensity: 3,
  hemiSky: 0xfff1d4,
  hemiGround: 0x18200d,
  hemiIntensity: 1.8,
  fogColor: 0xb8d4e8
};

const MIDNIGHT_PRESET = {
  turbidity: 10,
  rayleigh: 3,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.999,
  elevation: 2,
  azimuth: 180,
  exposure: 0.35,
  sunColor: new THREE.Color(1, 0.84, 0.7),
  sunIntensity: 1.8,
  hemiSky: 0xffa366,
  hemiGround: 0x080808,
  hemiIntensity: 0.6,
  fogColor: 0x1a0f07
};

export function initSky() {
  pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
}

export function applySkyPreset(isMidnight) {
  const preset = isMidnight ? MIDNIGHT_PRESET : DAY_PRESET;
  const tag = isMidnight ? "midnight" : "day";
  if (activeSkyPreset === tag) return preset.fogColor;
  activeSkyPreset = tag;

  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = preset.turbidity;
  uniforms.rayleigh.value = preset.rayleigh;
  uniforms.mieCoefficient.value = preset.mieCoefficient;
  uniforms.mieDirectionalG.value = preset.mieDirectionalG;

  const phi = THREE.MathUtils.degToRad(90 - preset.elevation);
  const theta = THREE.MathUtils.degToRad(preset.azimuth);
  uniforms.sunPosition.value.setFromSphericalCoords(1, phi, theta);

  sky.visible = true;
  scene.background = null;
  renderer.toneMappingExposure = preset.exposure;

  sun.color.copy(preset.sunColor);
  sun.intensity = preset.sunIntensity;
  hemiLight.color.setHex(preset.hemiSky);
  hemiLight.groundColor.setHex(preset.hemiGround);
  hemiLight.intensity = preset.hemiIntensity;

  if (pmremGenerator) {
    if (currentSkyEnvMap) currentSkyEnvMap.dispose();
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(50000);
    envSky.material.uniforms.turbidity.value = preset.turbidity;
    envSky.material.uniforms.rayleigh.value = preset.rayleigh;
    envSky.material.uniforms.mieCoefficient.value = preset.mieCoefficient;
    envSky.material.uniforms.mieDirectionalG.value = preset.mieDirectionalG;
    envSky.material.uniforms.sunPosition.value.copy(uniforms.sunPosition.value);
    envScene.add(envSky);
    currentSkyEnvMap = pmremGenerator.fromScene(envScene).texture;
    scene.environment = currentSkyEnvMap;
    envSky.geometry.dispose();
    envSky.material.dispose();
  }

  return preset.fogColor;
}

export function hideSky() {
  sky.visible = false;
  activeSkyPreset = null;
  renderer.toneMappingExposure = 1.0;
  sun.color.setRGB(1, 1, 1);
  sun.intensity = 3;
  hemiLight.color.setHex(0xfff1d4);
  hemiLight.groundColor.setHex(0x18200d);
  hemiLight.intensity = 1.8;
  scene.environment = null;
}
