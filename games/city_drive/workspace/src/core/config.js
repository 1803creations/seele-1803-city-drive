import * as THREE from "three";
import { ccdsData } from "../generated/ccds-data.js";
import { buildVehicleCatalog } from "../vehicle/VehicleConfig.js";
import { vectorFromData, quaternionFromData } from "./utils.js";

// --- Environment / asset base URLs -----------------------------------------

export const SAVE_KEY = "ccds-flow-save";

const HAS_VITE_ENV =
  typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined";
export const IS_VITE_DEV = HAS_VITE_ENV && Boolean(import.meta.env?.DEV);
export const IS_DIRECT_STATIC = !HAS_VITE_ENV;
export const PREFER_SOURCE_ASSETS = IS_VITE_DEV || IS_DIRECT_STATIC;

export const ROOT_BASES = PREFER_SOURCE_ASSETS
  ? [
      new URL("./unity_assets/Assets/CCDS/", document.baseURI).href,
      new URL("./Assets/CCDS/", document.baseURI).href
    ]
  : [
      new URL("./Assets/CCDS/", document.baseURI).href,
      new URL("./unity_assets/Assets/CCDS/", document.baseURI).href
    ];

export const BASES = PREFER_SOURCE_ASSETS
  ? [
      new URL("./unity_assets/Assets/CCDS/Realistic Car Controller Pro/", document.baseURI).href,
      new URL("./Assets/CCDS/Realistic Car Controller Pro/", document.baseURI).href
    ]
  : [
      new URL("./Assets/CCDS/Realistic Car Controller Pro/", document.baseURI).href,
      new URL("./unity_assets/Assets/CCDS/Realistic Car Controller Pro/", document.baseURI).href
    ];

export const ROOT_URL = ROOT_BASES[0];
export const UI_TEXTURE_ROOT = `${ROOT_URL}Textures/UI/`;

// --- Gameplay tuning --------------------------------------------------------

export const FIXED_TIMESTEP = 1 / 60;
export const FREE_DRIVE_PAYOUT_DISTANCE_METERS = 30;
export const FREE_DRIVE_PAYOUT_AMOUNT = 20;

// --- Unity-derived catalogs -------------------------------------------------

export const VEHICLES = buildVehicleCatalog(ccdsData);

export const SCENES = (ccdsData.scenes || [])
  .filter((scene) => scene.kind === "Gameplay")
  .map((scene) => ({ ...scene, shortLabel: scene.label.replace(/^Gameplay\s+/i, "") }));

export const MISSION_MARKERS = {
  free: new THREE.Vector3(0, 0, 0),
  checkpoint: new THREE.Vector3(12, 0, -8),
  trailblazer: new THREE.Vector3(-18, 0, -14),
  race: new THREE.Vector3(18, 0, 10),
  pursuit: new THREE.Vector3(-14, 0, 14)
};

export const MISSION_LABELS = {
  free: "Free Drive",
  checkpoint: "Checkpoint",
  trailblazer: "Trailblazer",
  race: "Race",
  pursuit: "Pursuit"
};

export const MISSIONS = ccdsData.missions.map((mission) => ({
  id: mission.id,
  script: mission.script,
  name: MISSION_LABELS[mission.id] || mission.label,
  desc: mission.missionStartInfo || "Get ready.",
  reward: mission.reward,
  rewardPlayer: mission.rewardPlayer,
  timeLimited: mission.timeLimited,
  time: mission.time,
  startMissionInstantly: mission.startMissionInstantly,
  marker: MISSION_MARKERS[mission.id] || new THREE.Vector3(0, 0, 0)
}));

export const GAME_STATES = Object.fromEntries(
  ccdsData.gameStates.map((name) => [name.toUpperCase(), name])
);

// --- Main menu reference frame (from Unity scene) ---------------------------

export const MAIN_MENU_SCENE = ccdsData.presentationScenes?.mainMenu || {};
export const MAIN_MENU_UI = ccdsData.mainMenuUi || {};
export const MAIN_MENU_UI_UNRESOLVED = MAIN_MENU_UI.unresolvedSprites || [];

export const GAMEPLAY_UI = ccdsData.gameplayUi || {};

export const UNITY_GAMEPLAY_REFERENCE = GAMEPLAY_UI.canvasScaler?.referenceResolution || { x: 1920, y: 1080 };

export const MAIN_MENU_SPAWN = vectorFromData(
  MAIN_MENU_SCENE.spawnPoint?.position,
  new THREE.Vector3(-2773.45, 100.9, -843.8)
);
export const MAIN_MENU_CAMERA = vectorFromData(
  MAIN_MENU_SCENE.camera?.transform?.position,
  new THREE.Vector3(-2780.6296, 102.02491, -845.52625)
);
export const MAIN_MENU_CAMERA_QUATERNION = quaternionFromData(
  MAIN_MENU_SCENE.camera?.transform?.rotation,
  new THREE.Quaternion(0.069612205, 0.61703914, -0.054933295, 0.7819202)
);
export const MAIN_MENU_CAMERA_FORWARD = new THREE.Vector3(0, 0, 1)
  .applyQuaternion(MAIN_MENU_CAMERA_QUATERNION)
  .normalize();
export const MAIN_MENU_CAMERA_DISTANCE = MAIN_MENU_SPAWN.clone()
  .sub(MAIN_MENU_CAMERA)
  .dot(MAIN_MENU_CAMERA_FORWARD);
export const MAIN_MENU_TARGET = MAIN_MENU_CAMERA.clone().add(
  MAIN_MENU_CAMERA_FORWARD.clone().multiplyScalar(MAIN_MENU_CAMERA_DISTANCE)
);
export const MAIN_MENU_ORIGIN = MAIN_MENU_SPAWN.clone();
export const MAIN_MENU_ROTATION_Y = THREE.MathUtils.degToRad(
  MAIN_MENU_SCENE.spawnPoint?.euler?.y ?? 50
);

// --- City world placement ---------------------------------------------------

export const CITY_WORLD_SCALE = 0.02032;
export const CITY_WORLD_SCALE_VECTOR = new THREE.Vector3(
  -CITY_WORLD_SCALE,
  CITY_WORLD_SCALE,
  CITY_WORLD_SCALE
);
export const CITY_WORLD_ROTATION = new THREE.Euler(-Math.PI / 2, 0, 0);

// --- Menu presentation / routing -------------------------------------------

export const MENU_ROUTES = ["main", "garage", "customize", "settings", "mission"];

export const MENU_PRESENTATION = {
  main: {
    rotationY: THREE.MathUtils.degToRad(124),
    camera: new THREE.Vector3(6.8, 2.8, 8.6),
    target: new THREE.Vector3(-1.4, 0.72, 1.1),
    carPosition: new THREE.Vector3(-1.9, 0, 1.35)
  },
  garage: {
    rotationY: THREE.MathUtils.degToRad(142),
    camera: new THREE.Vector3(5.2, 2.0, 5.4),
    target: new THREE.Vector3(0, 1.2, 0)
  },
  customize: {
    rotationY: THREE.MathUtils.degToRad(92),
    camera: new THREE.Vector3(11.4, 1.9, 0.6),
    target: new THREE.Vector3(-0.2, 1.18, 0.2)
  },
  settings: {
    rotationY: THREE.MathUtils.degToRad(208),
    camera: new THREE.Vector3(5.3, 1.95, 7.2),
    target: new THREE.Vector3(0, 1.08, 0)
  },
  mission: {
    rotationY: THREE.MathUtils.degToRad(50),
    camera: new THREE.Vector3(6.6, 2.2, 7.4),
    target: new THREE.Vector3(0, 1.18, 0)
  }
};

export const MENU_META = {
  main: { menuName: "Menu_Main", label: "Main Menu", desc: "Main entry, save status, and flow navigation." },
  garage: { menuName: "Menu_SelectVehicle", label: "Select Vehicle", desc: "Browse, purchase, and select player vehicles." },
  customize: { menuName: "Menu_Customization", label: "Customization", desc: "Preview parts, maintain a cart, and save loadout." },
  mission: { menuName: "Menu_Drive", label: "Drive", desc: "Choose mission mode before entering gameplay." },
  settings: { menuName: "Menu_Settings", label: "Settings", desc: "Scene selection and persistent player options." },
  game: { menuName: "Gameplay", label: "Gameplay", desc: "Drive the selected vehicle and complete mission objectives." }
};
