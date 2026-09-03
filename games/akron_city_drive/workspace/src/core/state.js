import * as THREE from "three";
import { ccdsData } from "../generated/ccds-data.js";
import { getDefaultVehicleSetup, mergeVehicleSetup } from "../vehicle/VehicleConfig.js";
import { $ } from "./utils.js";
import { SAVE_KEY, VEHICLES, SCENES, GAME_STATES } from "./config.js";

// --- DOM singletons ---------------------------------------------------------

export const ui = {
  app: $("#app"),
  cash: $("#cash-value"),
  vehicle: $("#vehicle-value"),
  route: $("#route-value"),
  kicker: $("#scene-kicker"),
  title: $("#scene-title"),
  desc: $("#scene-description"),
  panel: $("#panel-content"),
  hud: $("#hud-overlay"),
  root: $("#scene-root"),
  mainMenuUi: $("#main-menu-ui"),
  mainMenuCanvas: $("#main-menu-canvas"),
  menuPageLayer: $("#menu-page-layer"),
  mainMenuTopbar: $("#main-menu-topbar"),
  mainMenuBrand: $("#main-menu-brand"),
  mainMenuSide: $("#main-menu-side"),
  mainMenuNav: $("#main-menu-nav"),
  utilityBar: $("#utility-bar"),
  utilityControlsBtn: $("#utility-controls-btn"),
  utilityImageFxBtn: $("#utility-imagefx-btn"),
  utilityShadowsBtn: $("#utility-shadows-btn"),
  profilePanel: $("#profile-panel"),
  profilePanelTitle: $("#profile-panel-title"),
  profilePanelCopy: $("#profile-panel-copy"),
  profileNameInput: $("#profile-name-input"),
  profileSubmitBtn: $("#profile-submit-btn"),
  leftBanner: $("#menu-banner-left"),
  rightBanner: $("#menu-banner-right"),
  testingPanel: $("#testing-panel"),
  mainMenuMode: $("#main-menu-mode"),
  mainCash: $("#main-cash-value"),
  playerName: $("#player-name-value"),
  brandLine1: $("#main-menu-brand-line-1"),
  brandLine2: $("#main-menu-brand-line-2"),
  brandLine3: $("#main-menu-brand-line-3"),
  testingToggle: $("#testing-toggle"),
  testingTitle: $("#testing-title"),
  addMoney: $("#add-money-btn"),
  unlockCars: $("#unlock-cars-btn"),
  resetSave: $("#reset-save-btn"),
  driveBtn: $("#main-drive-btn"),
  vehiclesBtn: $("#main-vehicles-btn"),
  customizeBtn: $("#main-customize-btn"),
  settingsBtn: $("#main-settings-btn"),
  quitBtn: $("#main-quit-btn")
};

export const tgaUiCache = new Map();

export const gameplayHud = {
  root: null,
  rpmNeedle: null,
  speedValue: null,
  cashValue: null,
  cashMeta: null,
  missionKicker: null,
  missionTitle: null,
  missionCopy: null,
  missionMeta: null,
  healthFill: null,
  healthValue: null,
  felonyFill: null,
  minimapImage: null,
  minimapLabel: null,
  stateText: null,
  timeText: null,
  cameraBtn: null,
  pauseBtn: null,
  menuBtn: null,
  gearDisplay: null,
  nosFill: null,
  minimapPlayer: null,
  wreckedOverlay: null,
  indicatorL: null,
  indicatorR: null,
  absIcon: null,
  espIcon: null,
  tcsIcon: null,
  headlightsIcon: null,
  countdownOverlay: null,
  countdownNumber: null,
  pointsPanel: null,
  driftPoints: null,
  stuntPoints: null,
  speedPoints: null,
  bustingPanel: null,
  bustingFill: null,
  chaseAlert: null,
  pauseOverlay: null
};

// --- Defaults derived once at import -------------------------------------

export const fallbackSceneIndex = SCENES[0]?.buildIndex ?? 1;
export const defaultVehicleId =
  VEHICLES[ccdsData.settings.defaultSelectedVehicleIndex]?.id || VEHICLES[0]?.id;

// --- Persistent save --------------------------------------------------------

function loadSave() {
  const fallback = {
    playerName: ccdsData.settings.defaultPlayerName,
    playerMoney: ccdsData.settings.defaultMoney,
    selectedVehicle: ccdsData.settings.defaultSelectedVehicleIndex,
    selectedScene: fallbackSceneIndex,
    ownedVehicles: [ccdsData.settings.defaultSelectedVehicleIndex],
    vehicleSetups: { [defaultVehicleId]: getDefaultVehicleSetup() },
    audioVolume: ccdsData.settings.defaultAudioVolume,
    musicVolume: ccdsData.settings.defaultMusicVolume,
    imageEffects: false,
    shadows: false,
    graphicsQuality: "ultra",
    trafficIntensity: 0.62,
    drawDistance: 0.58,
    rtLights: 0.42,
    autoHandbrake: true,
    firstGameplay: true,
    completed: []
  };

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const parsed = { ...fallback, ...JSON.parse(raw) };
    if (Array.isArray(parsed.owned) && !parsed.ownedVehicles?.length) {
      parsed.ownedVehicles = parsed.owned
        .map((id) => VEHICLES.findIndex((vehicle) => vehicle.id === id))
        .filter((index) => index >= 0);
    }
    if (parsed.selectedVehicleId && typeof parsed.selectedVehicle !== "number") {
      const vehicleIndex = VEHICLES.findIndex((vehicle) => vehicle.id === parsed.selectedVehicleId);
      parsed.selectedVehicle = vehicleIndex >= 0 ? vehicleIndex : fallback.selectedVehicle;
    }
    if (typeof parsed.playerMoney !== "number" && typeof parsed.cash === "number") {
      parsed.playerMoney = parsed.cash;
    }
    if (!Array.isArray(parsed.ownedVehicles) || !parsed.ownedVehicles.length) {
      parsed.ownedVehicles = [...fallback.ownedVehicles];
    }
    if (typeof parsed.selectedScene !== "number") parsed.selectedScene = fallback.selectedScene;
    if (typeof parsed.graphicsQuality !== "string") parsed.graphicsQuality = fallback.graphicsQuality;
    if (typeof parsed.trafficIntensity !== "number") parsed.trafficIntensity = fallback.trafficIntensity;
    if (typeof parsed.drawDistance !== "number") parsed.drawDistance = fallback.drawDistance;
    if (typeof parsed.rtLights !== "number") parsed.rtLights = fallback.rtLights;
    if (typeof parsed.autoHandbrake !== "boolean") parsed.autoHandbrake = fallback.autoHandbrake;
    // Migrate old "spoiler_00" (was "No Spoiler") → "spoiler_none" so the
    // id can now be used for the actual Spoiler_00 mesh.
    for (const key of Object.keys(parsed.vehicleSetups || {})) {
      if (parsed.vehicleSetups[key]?.spoiler === "spoiler_00" && !parsed.vehicleSetups[key]?._spoilerMigrated) {
        parsed.vehicleSetups[key].spoiler = "spoiler_none";
      }
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export const save = loadSave();

// --- Runtime game state -----------------------------------------------------

export const state = {
  route: "main",
  levelType: "MainMenu",
  vehicleId: VEHICLES[save.selectedVehicle]?.id || VEHICLES[0].id,
  missionId: "checkpoint",
  gameCameraMode: "follow",
  customizeTab: null,
  mechanicPicker: null,
  draft: mergeVehicleSetup(
    save.vehicleSetups[VEHICLES[save.selectedVehicle]?.id || VEHICLES[0].id]
  ),
  message: "",
  game: {
    active: false,
    speed: 0,
    driveSpeed: 0,
    heading: 0,
    damage: 0,
    complete: false,
    state: GAME_STATES.STOPPED,
    countdownRemaining: 0,
    missionTimeRemaining: -1,
    runtime: null,
    freeDriveDistance: 0,
    freeDriveRewardDistance: 0,
    freeDriveSessionMoney: 0,
    lastPosition: null,
    missionReturnPosition: null,
    missionReturnHeading: null,
    missionReturnScene: null,
    missionBeaconOrigin: null,
    missionBeaconHeading: null,
    // Scoring (drift / stunt / speed)
    scoreDrift: 0,
    scoreStunt: 0,
    scoreSpeed: 0,
    driftingTime: 0,
    stuntingTime: 0,
    speedingTime: 0,
    // Police / felony (CCDS_Player + CCDS_AI_Cop)
    felony: 0,            // 0-100
    busting: 0,           // 0-100, reaches 100 = busted
    policeNearby: false,
    inPursue: false,
    busted: false,
    policeFineMoney: 0
  },
  gameplayOrigin: new THREE.Vector3(),
  presentationRoute: ""
};

// --- Asset / physics / input / audio singletons ----------------------------

export const assets = {
  loaded: false,
  fit: 1,
  car: null,
  carSources: new Map(),
  carScaleFactors: new Map(),
  spoilers: new Map(),
  wheels: new Map(),
  decalTextures: new Map(),
  activeSpoiler: null,
  activeWheels: [],
  stockWheels: [],
  activeDecals: { front: null, back: null, left: null, right: null },
  neonTexture: null,
  activeNeon: null,
  loadingVehicle: false,
  menuSceneSource: null,
  menuScene: null,
  trafficVehiclesLoaded: false,
  menuScenePlacement: null
};

export const keys = new Map();

export const physics = {
  ready: false,
  world: null,
  eventQueue: null,
  carBody: null,
  carCollider: null,
  wheelRig: null,
  staticBody: null,
  staticColliders: [],
  // Diagnostic: map of collider.handle → short label ("pad", "trimesh",
  // "obstacle", "deepfloor") so the RCCP wheel-contact log can name which
  // static surface each wheel is actually hitting. Populated by
  // addStaticCuboid / addStaticTrimesh.
  staticColliderLabels: new Map(),
  sceneReady: false,
  sceneColliderMode: "full",
  fixedTimeAccumulator: 0,
  carHalfExtents: new THREE.Vector3(1, 0.7, 2),
  carOffset: new THREE.Vector3(),
  wheelAnchors: [],
  impactCooldown: 0,
  cameraShake: 0,
  sparks: null,
  smoke: null,
  skidMarks: null,
  skidCursor: 0,
  skidPrevious: [null, null, null, null],
  groundRescueCount: 0,
  groundRescueTime: 0,
  groundRescuePosition: null,
  // NPC traffic body handles — populated by TrafficSystem, used by
  // RCCPCarController to exclude NPC colliders from wheel raycasts.
  npcBodyHandles: new Set()
};

export const audioState = {
  impact: [],
  impactIndex: 0,
  engineIdle: null,
  engineLow: null,
  engineMed: null,
  engineHigh: null,
  skid: null,
  gearShift: [],
  gearShiftIndex: 0,
  gearReverse: null,
  turboBlow: [],
  turboSpool: null,
  nos: null,
  brakes: null,
  wind: null,
  exhaustFire: [],
  policeSiren: null,
  cash: null,
  uiClick: null,
  music: [null, null],
  _lastShiftState: false,
  _lastGear: 0
};
