// City FBX loader, CCDS material library, stage skin, and menu scene
// placement / surface-height raycasting.
//
// Ported from the inline city-loader section of main.js. Every function
// keeps its original name so the rest of main.js (still pending extraction)
// can import them unchanged.
//
// `setPresentationMode` is still owned by main.js — it depends on a large
// swath of menu/gameplay state that hasn't been extracted yet — so it is
// injected via `configureCityLoader({ setPresentationMode })` during
// bootstrap.

import * as THREE from "three";
import { rootAssetUrl, normalizeModel } from "../core/utils.js";
import {
  BASES,
  ROOT_BASES,
  CITY_WORLD_SCALE,
  CITY_WORLD_SCALE_VECTOR,
  CITY_WORLD_ROTATION,
  MAIN_MENU_SPAWN,
  MENU_ROUTES
} from "../core/config.js";
import { assets, physics, state } from "../core/state.js";
import { renderer, world, loader, manager } from "./World.js";
import { buildScenePhysics } from "../physics/World.js";

// --- Injected dependencies (main.js still owns this) ----------------------

let _setPresentationMode = () => {};

export function configureCityLoader({ setPresentationMode } = {}) {
  if (setPresentationMode) _setPresentationMode = setPresentationMode;
}

// --- Caches + material library ---------------------------------------------

const stageTextureCache = new Map();
const cityTextureCache = new Map();
let menuSceneBounds = null;
const REMOTE_MENU_SCENE_URL =
  "https://static.seeles.ai/data/upload/1c58023f-f617-45c3-a36d-f0f95705a890_RCCP_City.FBX";
const REMOTE_LOAD_CANDIDATES = {
  "Models/Spoilers/SpoilersPack.FBX":
    "https://static.seeles.ai/data/upload/d524f96b-c960-46d6-8155-f9878780e9db_SpoilersPack.FBX",
  "Models/Wheels/WheelPack.FBX":
    "https://static.seeles.ai/data/upload/b46ef192-ca33-4531-b130-afedc264fb4a_WheelPack.FBX"
};
const REMOTE_ROOT_CANDIDATES = {
  "Realistic Traffic Controller/Models/Traffic Vehicles/TrafficVehicles.FBX":
    "https://static.seeles.ai/data/upload/47ddb9ac-52df-4743-ade1-7e38bd02ffe9_TrafficVehicles.FBX"
};

const EXPANDED_CITY_SIZE = 920;
const EXPANDED_CITY_ROAD_WIDTH = 16;
const AKRON_NORTH_SOUTH_ROADS = [
  { name: "Brown Street", x: -120 },
  { name: "Main Street", x: 0 },
  { name: "Arlington Street", x: 120 }
];
const AKRON_EAST_WEST_ROADS = [
  { name: "Market Street", z: -80 },
  { name: "Exchange Street", z: 80 }
];
const AKRON_SIGNAL_GREEN = 9;
const AKRON_SIGNAL_YELLOW = 1;
const AKRON_SIGNAL_PHASE = AKRON_SIGNAL_GREEN + AKRON_SIGNAL_YELLOW;
const AKRON_SIGNAL_CYCLE = AKRON_SIGNAL_PHASE * 2;
const TERRAIN_MATERIAL_HINTS = [
  "asphalt",
  "road",
  "sidewalk",
  "pavement",
  "parking",
  "grass",
  "ground",
  "plane"
];

const CITY_MATERIAL_LIBRARY = {
  asphalt: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png",
    repeat: [4, 4],
    roughness: 0.82,
    metalness: 0
  },
  tunnelasphalt: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png",
    repeat: [4, 4],
    roughness: 0.84,
    metalness: 0.04
  },
  asphalt_old: {
    map: "Realistic Traffic Controller/Models/City/Tex/Asphalt.png",
    normalMap: "Realistic Traffic Controller/Models/City/Tex/N/Asphalt_N.png",
    repeat: [1, 1],
    roughness: 0.88,
    metalness: 0
  },
  sidewalk: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Sidewalk.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Sidewalk_Normal.png",
    repeat: [100, 100],
    roughness: 0.72,
    metalness: 0
  },
  pavement: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Sidewalk.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Sidewalk_Normal.png",
    repeat: [100, 100],
    roughness: 0.72,
    metalness: 0
  },
  plane: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png",
    repeat: [4, 4],
    roughness: 0.84,
    metalness: 0
  },
  "parking lot": {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png",
    repeat: [4, 2],
    roughness: 0.84,
    metalness: 0
  },
  material: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png",
    repeat: [4, 4],
    roughness: 0.84,
    metalness: 0
  },
  "concrete 4x8": {
    map: "Realistic Traffic Controller/Models/City/Tex/Concrete_Form_4x8.bmp",
    normalMap: "Realistic Traffic Controller/Models/City/Tex/N/Concrete_Form_N.bmp",
    repeat: [0.7, 0.7],
    roughness: 0.96,
    metalness: 0
  },
  "concrete squares": {
    map: "Realistic Traffic Controller/Models/City/Tex/Concrete_Squares.bmp",
    repeat: [0.9, 0.9],
    roughness: 0.96,
    metalness: 0
  },
  dirt: {
    map: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_S.png",
    normalMap: "Realistic Car Controller Pro/Textures/Roads/City_Highway_Road_Normal.png",
    repeat: [3, 3],
    roughness: 0.9,
    metalness: 0
  },
  grass: {
    map: "https://static.seeles.ai/data/upload/bc4b9fd6-2139-4827-a39e-9affb845f777_City_Grass.png",
    repeat: [1000, 1000],
    roughness: 1,
    metalness: 0
  },
  grass2: {
    map: "https://static.seeles.ai/data/upload/bc4b9fd6-2139-4827-a39e-9affb845f777_City_Grass.png",
    repeat: [1000, 1000],
    roughness: 1,
    metalness: 0
  },
  sea: {
    map: "https://static.seeles.ai/data/upload/f1eb5c56-1d35-4f92-9974-b4d7cb08139f_City_Water_Pool.png",
    normalMap: "https://static.seeles.ai/data/upload/87ec3fcc-f0c9-428d-a18d-46ff484d1670_City_Water_Pool_N.png",
    repeat: [140, 140],
    roughness: 0.18,
    metalness: 0.02
  }
};

// --- Texture helpers --------------------------------------------------------

export function applyStageTexture(material, relativePath, repeatX, repeatY, rotation = 0) {
  const url = rootAssetUrl(relativePath);
  if (stageTextureCache.has(url)) {
    const texture = stageTextureCache.get(url);
    texture.repeat.set(repeatX, repeatY);
    texture.rotation = rotation;
    material.map = texture;
    material.needsUpdate = true;
    return;
  }

  const texture = new THREE.TextureLoader().load(url, () => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.rotation = rotation;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    material.map = texture;
    material.needsUpdate = true;
  });

  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.rotation = rotation;
  stageTextureCache.set(url, texture);
}

export function sceneTexture(relativePath, { repeatX = 1, repeatY = 1, srgb = true } = {}) {
  const key = `${relativePath}|${repeatX}|${repeatY}|${srgb ? "srgb" : "linear"}`;
  if (cityTextureCache.has(key)) return cityTextureCache.get(key);
  const texture = new THREE.TextureLoader().load(rootAssetUrl(relativePath), () => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  cityTextureCache.set(key, texture);
  return texture;
}

export function applyCityMaterialLibrary(target) {
  target.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      const matName = String(material.name || "").toLowerCase();
      const config = CITY_MATERIAL_LIBRARY[matName];
      const terrainLike = TERRAIN_MATERIAL_HINTS.some((hint) => matName.includes(hint));
      if (!config) return;
      if (config.map) {
        material.map = sceneTexture(config.map, {
          repeatX: config.repeat?.[0] ?? 1,
          repeatY: config.repeat?.[1] ?? 1,
          srgb: true
        });
        material.color = new THREE.Color(0xffffff);
      }
      if (config.normalMap) {
        material.normalMap = sceneTexture(config.normalMap, {
          repeatX: config.repeat?.[0] ?? 1,
          repeatY: config.repeat?.[1] ?? 1,
          srgb: false
        });
      }
      if ("roughness" in material && typeof config.roughness === "number") material.roughness = config.roughness;
      if ("metalness" in material && typeof config.metalness === "number") material.metalness = config.metalness;
      if (terrainLike) material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    });
  });
}

function stabilizeTerrainRendering(target) {
  target.traverse((child) => {
    if (!child.isMesh) return;
    const name = `${child.name || ""} ${child.material?.name || ""}`.toLowerCase();
    const terrainLike = TERRAIN_MATERIAL_HINTS.some((hint) => name.includes(hint));
    if (!terrainLike) return;

    child.frustumCulled = false;
    child.renderOrder = Math.min(child.renderOrder || 0, -5);
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      material.side = THREE.DoubleSide;
      material.depthWrite = true;
      material.needsUpdate = true;
    });
  });
}

export function applyMenuStageSkin() {
  applyStageTexture(
    world.menuGrassPatch.material,
    "https://static.seeles.ai/data/upload/bc4b9fd6-2139-4827-a39e-9affb845f777_City_Grass.png",
    3,
    2.6,
    Math.PI * 0.06
  );
  applyStageTexture(
    world.menuSidewalk.material,
    "https://static.seeles.ai/data/upload/235608e2-c5b1-496e-b6bb-194cc46c0bb9_Tile_Ceramic_6.png",
    5.5,
    4.5
  );
  applyStageTexture(
    world.menuBuilding.material,
    "https://static.seeles.ai/data/upload/49d059b4-dc70-42a0-8d0e-b9f3db5a99f9_Building_Wall_1.png",
    3,
    1.35
  );
  applyStageTexture(
    world.menuBuildingWing.material,
    "https://static.seeles.ai/data/upload/49d059b4-dc70-42a0-8d0e-b9f3db5a99f9_Building_Wall_1.png",
    1.2,
    1.35
  );
}

function createFallbackPartPack(kind) {
  const group = new THREE.Group();
  group.name = `Fallback_${kind}`;
  if (kind === "spoilers") {
    ["Spoiler_00", "Spoiler_01", "Spoiler_02"].forEach((name, index) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.2 + index * 0.18, 0.08, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.35, metalness: 0.55 })
      );
      mesh.name = name;
      group.add(mesh);
    });
  }
  if (kind === "wheels") {
    ["Wheel_01", "Wheel_02", "Wheel_03"].forEach((name, index) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36 + index * 0.02, 0.36 + index * 0.02, 0.24, 32),
        new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.45, metalness: 0.35 })
      );
      mesh.name = name;
      mesh.rotation.z = Math.PI / 2;
      group.add(mesh);
    });
  }
  return group;
}

function createFallbackCityScene() {
  const group = new THREE.Group();
  group.name = "Fallback_City";

  const roadMat = new THREE.MeshStandardMaterial({ name: "asphalt", color: 0x45484d, roughness: 0.88, side: THREE.DoubleSide });
  const blockMat = new THREE.MeshStandardMaterial({ name: "concrete", color: 0x7a7d75, roughness: 0.92 });
  const grassMat = new THREE.MeshStandardMaterial({ name: "grass", color: 0x5f7f3a, roughness: 1, side: THREE.DoubleSide });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), grassMat);
  ground.name = "Ground";
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  for (let i = -3; i <= 3; i += 1) {
    const roadX = new THREE.Mesh(new THREE.PlaneGeometry(220, 8), roadMat);
    roadX.name = "Road_X";
    roadX.rotation.x = -Math.PI / 2;
    roadX.position.z = i * 28;
    roadX.position.y = 0.02;
    roadX.receiveShadow = true;
    group.add(roadX);

    const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(8, 220), roadMat);
    roadZ.name = "Road_Z";
    roadZ.rotation.x = -Math.PI / 2;
    roadZ.position.x = i * 28;
    roadZ.position.y = 0.03;
    roadZ.receiveShadow = true;
    group.add(roadZ);
  }

  for (let x = -84; x <= 84; x += 28) {
    for (let z = -84; z <= 84; z += 28) {
      if (Math.abs(x) < 12 || Math.abs(z) < 12) continue;
      const h = 5 + ((Math.abs(x + z) / 28) % 5) * 2.5;
      const building = new THREE.Mesh(new THREE.BoxGeometry(12, h, 12), blockMat.clone());
      building.name = "Building";
      building.position.set(x, h / 2, z);
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);
    }
  }

  return group;
}

function createLabelTexture(text, { width = 256, height = 64, bg = "#194b7a", fg = "#ffffff" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, width - 8, height - 8);
  ctx.fillStyle = fg;
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStreetLabel(text, x, y, z, rotationY = 0) {
  const group = new THREE.Group();
  group.name = `Street_Label_${text}`;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8), poleMat);
  pole.position.set(x, y + 1.2, z);
  group.add(pole);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 1.3),
    new THREE.MeshBasicMaterial({ map: createLabelTexture(text), side: THREE.DoubleSide })
  );
  sign.position.set(x, y + 2.45, z);
  sign.rotation.y = rotationY;
  group.add(sign);
  return group;
}

function akronSignalState(time, approachPhase) {
  const phaseTime = time % AKRON_SIGNAL_CYCLE;
  const activePhase = phaseTime < AKRON_SIGNAL_PHASE ? "northsouth" : "eastwest";
  const timeInPhase = phaseTime < AKRON_SIGNAL_PHASE ? phaseTime : phaseTime - AKRON_SIGNAL_PHASE;
  if (approachPhase !== activePhase) return "red";
  return timeInPhase >= AKRON_SIGNAL_GREEN ? "yellow" : "green";
}

function createTrafficLight(x, surfaceY, z, rotationY = 0, approachPhase = "northsouth") {
  const group = new THREE.Group();
  group.name = "Akron_Traffic_Light";
  group.userData.akronSignalPhase = approachPhase;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x262626, roughness: 0.7 });
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.55 });
  const activeState = akronSignalState(0, approachPhase);
  const redMat = new THREE.MeshBasicMaterial({ color: activeState === "red" ? 0xff2020 : 0x330000 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: activeState === "yellow" ? 0xffd322 : 0x332400 });
  const greenMat = new THREE.MeshBasicMaterial({ color: activeState === "green" ? 0x28ff58 : 0x003300 });
  const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 10), poleMat);
  pole.position.set(x, surfaceY + 1.7, z);
  pole.castShadow = true;
  group.add(pole);
  const armDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  const armCenter = new THREE.Vector3(x, surfaceY + 3.5, z).addScaledVector(armDir, 2.2);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4.4), poleMat);
  arm.position.copy(armCenter);
  arm.rotation.y = rotationY;
  arm.castShadow = true;
  group.add(arm);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.25, 0.28), caseMat);
  box.position.set(x, surfaceY + 3.03, z).addScaledVector(armDir, 4.4);
  box.rotation.y = rotationY;
  box.castShadow = true;
  group.add(box);
  const faceOffset = new THREE.Vector3(0, 0, -0.18).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  [
    ["red", redMat, 0.34, 0xff2020, 0x330000, activeState === "red" ? 1.45 : 0],
    ["yellow", yellowMat, 0, 0xffd322, 0x332400, activeState === "yellow" ? 1.45 : 0],
    ["green", greenMat, -0.34, 0x28ff58, 0x003300, activeState === "green" ? 1.45 : 0]
  ].forEach(([signalColor, mat, y, litColor, darkColor, intensity]) => {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), mat);
    lamp.name = `Akron_Traffic_Lamp_${signalColor}`;
    lamp.userData.akronSignalLamp = { phase: approachPhase, color: signalColor, litColor, darkColor };
    lamp.position.copy(box.position).add(faceOffset);
    lamp.position.y += y;
    group.add(lamp);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), glowMat(litColor, intensity ? 0.5 : 0));
    glow.name = `Akron_Traffic_Glow_${signalColor}`;
    glow.userData.akronSignalGlow = { phase: approachPhase, color: signalColor, litOpacity: 0.5 };
    glow.position.copy(lamp.position);
    glow.rotation.y = rotationY;
    group.add(glow);
  });
  return group;
}

function createFootballFieldWithKangaroo(surfaceY) {
  const group = new THREE.Group();
  group.name = "Brown_Exchange_Football_Field_Kangaroo";

  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const brownX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Brown Street")?.x || -120;
  const fieldX = MAIN_MENU_SPAWN.x + brownX - 75;
  const fieldZ = MAIN_MENU_SPAWN.z + exchangeZ - 55;
  const fieldY = surfaceY + 0.035;
  const fieldLength = 120;
  const fieldWidth = 54;
  const stadiumLength = fieldLength + 18;
  const stadiumWidth = fieldWidth + 18;

  const turfMat = new THREE.MeshStandardMaterial({ name: "football_turf", color: 0x23703a, roughness: 0.95, side: THREE.DoubleSide });
  const endzoneMat = new THREE.MeshStandardMaterial({ name: "football_endzone", color: 0x173f2c, roughness: 0.95, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshStandardMaterial({ name: "football_stadium_wall", color: 0x22314f, roughness: 0.78 });
  const gateMat = new THREE.MeshStandardMaterial({ name: "football_stadium_gate", color: 0xd9a441, roughness: 0.5, metalness: 0.1 });
  const whiteLineMat = new THREE.MeshBasicMaterial({ name: "football_white_line", color: 0xffffff, side: THREE.DoubleSide });
  const yellowMat = new THREE.MeshBasicMaterial({ name: "football_goalpost_yellow", color: 0xffd322 });
  const logoGold = "#d9a441";
  const logoBrown = "#6f3d1f";

  const addFlat = (mesh, x, z, yOffset = 0) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(fieldX + x, fieldY + yOffset, fieldZ + z);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const field = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(fieldLength, fieldWidth), turfMat), 0, 0, 0);
  field.name = "Football_Field_Across_From_Red_Gas_Station";
  const northWall = new THREE.Mesh(new THREE.BoxGeometry(stadiumLength, 5.5, 2.0), wallMat);
  northWall.name = "Football_Stadium_North_Wall";
  northWall.position.set(fieldX, fieldY + 2.75, fieldZ - stadiumWidth / 2);
  group.add(northWall);
  const westWall = new THREE.Mesh(new THREE.BoxGeometry(2.0, 5.5, stadiumWidth), wallMat);
  westWall.name = "Football_Stadium_West_Wall";
  westWall.position.set(fieldX - stadiumLength / 2, fieldY + 2.75, fieldZ);
  group.add(westWall);
  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(2.0, 5.5, stadiumWidth), wallMat);
  eastWall.name = "Football_Stadium_East_Wall";
  eastWall.position.set(fieldX + stadiumLength / 2, fieldY + 2.75, fieldZ);
  group.add(eastWall);
  [-1, 1].forEach((side) => {
    const southWall = new THREE.Mesh(new THREE.BoxGeometry((stadiumLength - 18) / 2, 5.5, 2.0), wallMat);
    southWall.name = "Football_Stadium_South_Wall_With_Center_Gate";
    southWall.position.set(fieldX + side * ((stadiumLength + 18) / 4), fieldY + 2.75, fieldZ + stadiumWidth / 2);
    group.add(southWall);
  });
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(16, 0.18, 10), gateMat);
  entrance.name = "Football_Stadium_Center_Entrance";
  entrance.position.set(fieldX, fieldY + 0.04, fieldZ + stadiumWidth / 2 + 4);
  entrance.receiveShadow = true;
  group.add(entrance);
  addFlat(new THREE.Mesh(new THREE.PlaneGeometry(10, fieldWidth), endzoneMat), -fieldLength / 2 + 5, 0, 0.004).name = "West_Endzone";
  addFlat(new THREE.Mesh(new THREE.PlaneGeometry(10, fieldWidth), endzoneMat), fieldLength / 2 - 5, 0, 0.004).name = "East_Endzone";

  for (let x = -50; x <= 50; x += 10) {
    const line = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(0.55, fieldWidth), whiteLineMat.clone()), x, 0, 0.008);
    line.name = x === 0 ? "Football_50_Yard_Line" : "Football_Yard_Line";
  }
  addFlat(new THREE.Mesh(new THREE.PlaneGeometry(fieldLength, 0.45), whiteLineMat.clone()), 0, -fieldWidth / 2, 0.009).name = "Football_Sideline_North";
  addFlat(new THREE.Mesh(new THREE.PlaneGeometry(fieldLength, 0.45), whiteLineMat.clone()), 0, fieldWidth / 2, 0.009).name = "Football_Sideline_South";
  addFlat(new THREE.Mesh(new THREE.PlaneGeometry(0.45, fieldWidth), whiteLineMat.clone()), -fieldLength / 2, 0, 0.009).name = "Football_Goal_Line_West";
  addFlat(new THREE.Mesh(new THREE.PlaneGeometry(0.45, fieldWidth), whiteLineMat.clone()), fieldLength / 2, 0, 0.009).name = "Football_Goal_Line_East";

  [-fieldLength / 2 - 2.5, fieldLength / 2 + 2.5].forEach((x) => {
    const post = new THREE.Group();
    post.name = "Football_Goalpost";
    const uprightA = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.5, 10), yellowMat);
    uprightA.position.set(fieldX + x, fieldY + 3.25, fieldZ - 2.2);
    const uprightB = uprightA.clone();
    uprightB.position.z = fieldZ + 2.2;
    const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.4, 10), yellowMat);
    crossbar.position.set(fieldX + x, fieldY + 3.1, fieldZ);
    crossbar.rotation.x = Math.PI / 2;
    post.add(uprightA, uprightB, crossbar);
    group.add(post);
  });

  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = 512;
  logoCanvas.height = 512;
  const ctx = logoCanvas.getContext("2d");
  ctx.clearRect(0, 0, logoCanvas.width, logoCanvas.height);
  ctx.fillStyle = "#10234b";
  ctx.beginPath();
  ctx.roundRect(44, 44, 424, 424, 28);
  ctx.fill();
  ctx.strokeStyle = logoGold;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.translate(256, 256);
  ctx.scale(0.86, 0.86);
  ctx.fillStyle = logoBrown;
  ctx.strokeStyle = logoGold;
  ctx.lineWidth = 12;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-92, 38);
  ctx.bezierCurveTo(-104, -82, -188, -134, -244, -188);
  ctx.bezierCurveTo(-205, -70, -176, 13, -83, 89);
  ctx.bezierCurveTo(-144, 80, -196, 43, -236, -2);
  ctx.bezierCurveTo(-205, 75, -150, 139, -55, 150);
  ctx.bezierCurveTo(-18, 175, 42, 175, 78, 150);
  ctx.bezierCurveTo(176, 137, 226, 73, 244, -2);
  ctx.bezierCurveTo(202, 44, 151, 80, 92, 89);
  ctx.bezierCurveTo(183, 12, 212, -72, 244, -188);
  ctx.bezierCurveTo(188, -133, 105, -82, 92, 38);
  ctx.bezierCurveTo(64, 14, -63, 14, -92, 38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#9e8d5c";
  ctx.beginPath();
  ctx.ellipse(0, 86, 111, 50, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-72, 113);
  ctx.bezierCurveTo(-52, 91, -27, 88, -7, 106);
  ctx.bezierCurveTo(-31, 137, -55, 139, -72, 113);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(72, 113);
  ctx.bezierCurveTo(52, 91, 27, 88, 7, 106);
  ctx.bezierCurveTo(31, 137, 55, 139, 72, 113);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#10234b";
  ctx.beginPath();
  ctx.arc(-38, 111, 11, 0, Math.PI * 2);
  ctx.arc(38, 111, 11, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 64px Georgia";
  ctx.fillText("FEAR", 0, -154);
  ctx.fillStyle = logoGold;
  ctx.font = "900 32px Georgia";
  ctx.fillText("THE", 0, -106);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 92px Georgia";
  ctx.fillText("ROO", 0, -38);
  ctx.strokeStyle = logoGold;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-110, -122);
  ctx.lineTo(110, -122);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-124, 184);
  ctx.quadraticCurveTo(0, 217, 124, 184);
  ctx.stroke();
  const logoTexture = new THREE.CanvasTexture(logoCanvas);
  logoTexture.colorSpace = THREE.SRGBColorSpace;
  const logo = addFlat(
    new THREE.Mesh(
      new THREE.PlaneGeometry(32, 32),
      new THREE.MeshBasicMaterial({
        name: "kangaroo_midfield_logo",
        map: logoTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    ),
    0,
    0,
    0.02
  );
  logo.name = "Kangaroo_Logo_At_50_Yard_Line_Facing_North";
  logo.renderOrder = -2;

  return group;
}

function createGyroRestaurant(surfaceY) {
  const group = new THREE.Group();
  group.name = "Exchange_Street_Gyro_Restaurant";

  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const brownX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Brown Street")?.x || -120;
  const restaurantX = MAIN_MENU_SPAWN.x + brownX + 65;
  const restaurantZ = MAIN_MENU_SPAWN.z + exchangeZ + 44;
  const baseY = surfaceY;

  const brickCanvas = document.createElement("canvas");
  brickCanvas.width = 256;
  brickCanvas.height = 256;
  const brickCtx = brickCanvas.getContext("2d");
  brickCtx.fillStyle = "#9d4b34";
  brickCtx.fillRect(0, 0, brickCanvas.width, brickCanvas.height);
  brickCtx.strokeStyle = "#d7b19e";
  brickCtx.lineWidth = 3;
  const brickH = 32;
  const brickW = 64;
  for (let y = 0; y <= brickCanvas.height; y += brickH) {
    brickCtx.beginPath();
    brickCtx.moveTo(0, y);
    brickCtx.lineTo(brickCanvas.width, y);
    brickCtx.stroke();
    const offset = (y / brickH) % 2 === 0 ? 0 : brickW / 2;
    for (let x = -offset; x <= brickCanvas.width; x += brickW) {
      brickCtx.beginPath();
      brickCtx.moveTo(x, y);
      brickCtx.lineTo(x, y + brickH);
      brickCtx.stroke();
    }
  }
  const brickTexture = new THREE.CanvasTexture(brickCanvas);
  brickTexture.colorSpace = THREE.SRGBColorSpace;
  brickTexture.wrapS = THREE.RepeatWrapping;
  brickTexture.wrapT = THREE.RepeatWrapping;
  brickTexture.repeat.set(3, 2);
  const wallMat = new THREE.MeshStandardMaterial({ name: "gyro_restaurant_brick_wall", map: brickTexture, roughness: 0.82 });
  const blueMat = new THREE.MeshStandardMaterial({ name: "gyro_restaurant_blue_trim", color: 0x2367b1, roughness: 0.48, metalness: 0.02 });
  const roofMat = new THREE.MeshStandardMaterial({ name: "gyro_restaurant_roof", color: 0x1d3452, roughness: 0.68 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "gyro_restaurant_windows", color: 0x8fc8e8, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.72 });
  const meatMat = new THREE.MeshStandardMaterial({ name: "gyro_spit_meat", color: 0x9b522b, roughness: 0.82 });
  const pitaMat = new THREE.MeshStandardMaterial({ name: "gyro_pita", color: 0xe7c782, roughness: 0.9 });

  const building = new THREE.Mesh(new THREE.BoxGeometry(32, 9, 22), wallMat);
  building.name = "Gyro_Restaurant_Building";
  building.position.set(restaurantX, baseY + 4.5, restaurantZ);
  building.castShadow = true;
  building.receiveShadow = true;
  group.add(building);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(36, 2, 25), roofMat);
  roof.name = "Gyro_Restaurant_Roof";
  roof.position.set(restaurantX, baseY + 10.1, restaurantZ);
  roof.castShadow = true;
  group.add(roof);

  const awning = new THREE.Mesh(new THREE.BoxGeometry(34, 1.1, 4.2), blueMat);
  awning.name = "Gyro_Restaurant_Blue_Awning";
  awning.position.set(restaurantX, baseY + 7.3, restaurantZ - 13.2);
  awning.castShadow = true;
  group.add(awning);

  [-9, 9].forEach((x) => {
    const window = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.25), glassMat);
    window.name = "Gyro_Restaurant_Window";
    window.position.set(restaurantX + x, baseY + 4.9, restaurantZ - 11.15);
    group.add(window);
  });

  const door = new THREE.Mesh(new THREE.BoxGeometry(4, 5.4, 0.3), blueMat);
  door.name = "Gyro_Restaurant_Door";
  door.position.set(restaurantX, baseY + 2.7, restaurantZ - 11.2);
  group.add(door);

  const signCanvas = document.createElement("canvas");
  signCanvas.width = 512;
  signCanvas.height = 160;
  const ctx = signCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, signCanvas.width, signCanvas.height);
  ctx.fillStyle = "#2367b1";
  ctx.fillRect(0, 0, signCanvas.width, 18);
  ctx.fillRect(0, signCanvas.height - 18, signCanvas.width, 18);
  ctx.fillStyle = "#d24b2a";
  ctx.font = "bold 62px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("GYROS", 256, 68);
  ctx.fillStyle = "#2367b1";
  ctx.font = "bold 30px Arial";
  ctx.fillText("EXCHANGE STREET", 256, 118);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 6.25),
    new THREE.MeshBasicMaterial({ name: "gyro_restaurant_sign_panel", map: signTexture, side: THREE.DoubleSide })
  );
  sign.name = "Gyro_Restaurant_Sign";
  sign.position.set(restaurantX, baseY + 11.7, restaurantZ - 12.7);
  sign.rotation.y = Math.PI;
  group.add(sign);

  const patio = new THREE.Mesh(new THREE.BoxGeometry(40, 0.18, 12), new THREE.MeshStandardMaterial({ name: "gyro_restaurant_patio", color: 0xbeb8a7, roughness: 0.9 }));
  patio.name = "Gyro_Restaurant_Patio";
  patio.position.set(restaurantX, baseY + 0.02, restaurantZ - 18);
  patio.receiveShadow = true;
  group.add(patio);

  const spit = new THREE.Group();
  spit.name = "Gyro_Spit_Display";
  spit.position.set(restaurantX - 15, baseY + 2.2, restaurantZ - 17);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 10), blueMat);
  pole.position.y = 1.6;
  const meat = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.2, 18), meatMat);
  meat.position.y = 1.65;
  const pita = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.18, 24), pitaMat);
  pita.position.y = 0.18;
  spit.add(pole, meat, pita);
  group.add(spit);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

function createMcdsRestaurant(surfaceY) {
  const group = new THREE.Group();
  group.name = "Exchange_Street_Mcds_Restaurant";

  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const restaurantX = MAIN_MENU_SPAWN.x + 55;
  const restaurantZ = MAIN_MENU_SPAWN.z + exchangeZ + 44;
  const baseY = surfaceY;

  const redMat = new THREE.MeshStandardMaterial({ name: "mcds_red_panel", color: 0xc51d23, roughness: 0.58 });
  const brickMat = new THREE.MeshStandardMaterial({ name: "mcds_brick_base", color: 0x8d4934, roughness: 0.86 });
  const yellowMat = new THREE.MeshStandardMaterial({ name: "mcds_yellow_trim", color: 0xffc400, roughness: 0.42, metalness: 0.03 });
  const roofMat = new THREE.MeshStandardMaterial({ name: "mcds_dark_roof", color: 0x2a2725, roughness: 0.72 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "mcds_windows", color: 0x9fd4ee, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.72 });
  const asphaltMat = new THREE.MeshStandardMaterial({ name: "mcds_drive_thru_asphalt", color: 0x303336, roughness: 0.94 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(36, 4.2, 24), brickMat);
  base.name = "Mcds_Brick_Base";
  base.position.set(restaurantX, baseY + 2.1, restaurantZ);
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const upper = new THREE.Mesh(new THREE.BoxGeometry(36, 5.4, 24), redMat);
  upper.name = "Mcds_Red_Building";
  upper.position.set(restaurantX, baseY + 6.9, restaurantZ);
  upper.castShadow = true;
  upper.receiveShadow = true;
  group.add(upper);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(40, 1.6, 28), roofMat);
  roof.name = "Mcds_Roof";
  roof.position.set(restaurantX, baseY + 10.4, restaurantZ);
  roof.castShadow = true;
  group.add(roof);

  const yellowBand = new THREE.Mesh(new THREE.BoxGeometry(38, 0.7, 1.0), yellowMat);
  yellowBand.name = "Mcds_Yellow_Front_Band";
  yellowBand.position.set(restaurantX, baseY + 8.9, restaurantZ - 12.55);
  group.add(yellowBand);

  [-11, 0, 11].forEach((x) => {
    const window = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.1, 0.28), glassMat);
    window.name = "Mcds_Front_Window";
    window.position.set(restaurantX + x, baseY + 5.5, restaurantZ - 12.15);
    group.add(window);
  });

  const door = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.2, 0.35), glassMat);
  door.name = "Mcds_Glass_Door";
  door.position.set(restaurantX - 17.2, baseY + 2.8, restaurantZ - 8);
  door.rotation.y = Math.PI / 2;
  group.add(door);

  const signCanvas = document.createElement("canvas");
  signCanvas.width = 512;
  signCanvas.height = 256;
  const ctx = signCanvas.getContext("2d");
  ctx.fillStyle = "#c51d23";
  ctx.fillRect(0, 0, signCanvas.width, signCanvas.height);
  ctx.fillStyle = "#ffc400";
  ctx.strokeStyle = "#ffc400";
  ctx.lineWidth = 34;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(162, 150);
  ctx.bezierCurveTo(164, 48, 224, 48, 226, 150);
  ctx.moveTo(226, 150);
  ctx.bezierCurveTo(228, 48, 288, 48, 290, 150);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 54px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("McD's", 256, 202);
  const signTexture = new THREE.CanvasTexture(signCanvas);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 7),
    new THREE.MeshBasicMaterial({ name: "mcds_front_sign", map: signTexture, side: THREE.DoubleSide })
  );
  sign.name = "Mcds_Front_Sign";
  sign.position.set(restaurantX, baseY + 12.6, restaurantZ - 14.2);
  sign.rotation.y = Math.PI;
  group.add(sign);

  const lot = new THREE.Mesh(new THREE.BoxGeometry(46, 0.14, 18), asphaltMat);
  lot.name = "Mcds_Parking_Lot";
  lot.position.set(restaurantX, baseY + 0.015, restaurantZ - 24);
  lot.receiveShadow = true;
  group.add(lot);

  const menuBoard = new THREE.Mesh(new THREE.BoxGeometry(4, 3.5, 0.35), redMat);
  menuBoard.name = "Mcds_Drive_Thru_Menu";
  menuBoard.position.set(restaurantX + 23, baseY + 1.75, restaurantZ - 18);
  menuBoard.rotation.y = -Math.PI / 2;
  group.add(menuBoard);
  const menuTop = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.45, 0.5), yellowMat);
  menuTop.name = "Mcds_Menu_Yellow_Header";
  menuTop.position.set(restaurantX + 23, baseY + 3.75, restaurantZ - 18);
  menuTop.rotation.y = -Math.PI / 2;
  group.add(menuTop);

  group.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return group;
}

function createTextSignTexture(title, subtitle, background, primary, secondary = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = primary;
  ctx.fillRect(0, 0, canvas.width, 18);
  ctx.fillRect(0, canvas.height - 18, canvas.width, 18);
  ctx.fillStyle = secondary;
  ctx.font = "bold 58px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(title, 256, 82);
  if (subtitle) {
    ctx.fillStyle = primary;
    ctx.font = "bold 30px Arial";
    ctx.fillText(subtitle, 256, 134);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDowntownRestaurantArea(surfaceY) {
  const group = new THREE.Group();
  group.name = "Main_Exchange_Downtown_Restaurant_Area";

  const mainX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Main Street")?.x || 0;
  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const baseX = MAIN_MENU_SPAWN.x + mainX;
  const baseZ = MAIN_MENU_SPAWN.z + exchangeZ;
  const baseY = surfaceY;

  const brickCanvas = document.createElement("canvas");
  brickCanvas.width = 256;
  brickCanvas.height = 256;
  const brickCtx = brickCanvas.getContext("2d");
  brickCtx.fillStyle = "#7f3f2e";
  brickCtx.fillRect(0, 0, 256, 256);
  brickCtx.strokeStyle = "#c99378";
  brickCtx.lineWidth = 3;
  for (let y = 0; y <= 256; y += 32) {
    brickCtx.beginPath();
    brickCtx.moveTo(0, y);
    brickCtx.lineTo(256, y);
    brickCtx.stroke();
    const offset = (y / 32) % 2 === 0 ? 0 : 32;
    for (let x = -offset; x <= 256; x += 64) {
      brickCtx.beginPath();
      brickCtx.moveTo(x, y);
      brickCtx.lineTo(x, y + 32);
      brickCtx.stroke();
    }
  }
  const brickTexture = new THREE.CanvasTexture(brickCanvas);
  brickTexture.colorSpace = THREE.SRGBColorSpace;
  brickTexture.wrapS = THREE.RepeatWrapping;
  brickTexture.wrapT = THREE.RepeatWrapping;
  brickTexture.repeat.set(2.5, 1.4);

  const sidewalkMat = new THREE.MeshStandardMaterial({ name: "downtown_sidewalk", color: 0xc8c0ad, roughness: 0.92 });
  const brickMat = new THREE.MeshStandardMaterial({ name: "downtown_brick", map: brickTexture, roughness: 0.84 });
  const roofMat = new THREE.MeshStandardMaterial({ name: "downtown_flat_roof", color: 0x2f2f31, roughness: 0.75 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "downtown_storefront_glass", color: 0x8fc8e8, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.72 });

  const stores = [
    { name: "Johnnys Subs", subtitle: "HOT SUBS", x: -42, z: -76, face: Math.PI / 2, color: "#145da0", accent: "#ffd04f" },
    { name: "Beer Bar", subtitle: "DOWNTOWN", x: 42, z: -76, face: -Math.PI / 2, color: "#2a2118", accent: "#f2b84b" },
    { name: "Hookah Bar", subtitle: "LOUNGE", x: -42, z: 76, face: Math.PI / 2, color: "#381b55", accent: "#d8a9ff" }
  ];

  for (const store of stores) {
    const storefront = new THREE.Group();
    storefront.name = store.name.replace(/\s+/g, "_");
    storefront.position.set(baseX + store.x, baseY, baseZ + store.z);

    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(20, 0.18, 29), sidewalkMat);
    sidewalk.name = `${storefront.name}_Sidewalk`;
    sidewalk.position.set(store.x < 0 ? 7 : -7, 0.03, 0);
    storefront.add(sidewalk);

    const building = new THREE.Mesh(new THREE.BoxGeometry(22, 11, 26), brickMat);
    building.name = `${storefront.name}_Brick_Building`;
    building.position.y = 5.5;
    building.castShadow = true;
    building.receiveShadow = true;
    storefront.add(building);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 1.3, 28), roofMat);
    roof.name = `${storefront.name}_Roof`;
    roof.position.y = 11.65;
    roof.castShadow = true;
    storefront.add(roof);

    const frontZ = store.x < 0 ? 0 : 0;
    [-4.6, 4.6].forEach((z) => {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 5.2), glassMat);
      window.name = `${storefront.name}_Window`;
      window.position.set(store.x < 0 ? 11.15 : -11.15, 4.6, z);
      storefront.add(window);
    });

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 5.4, 3.1), glassMat);
    door.name = `${storefront.name}_Door`;
    door.position.set(store.x < 0 ? 11.2 : -11.2, 2.8, frontZ - 9);
    storefront.add(door);

    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 4.5),
      new THREE.MeshBasicMaterial({
        name: `${storefront.name}_Sign_Material`,
        map: createTextSignTexture(store.name.toUpperCase(), store.subtitle, store.color, store.accent),
        side: THREE.DoubleSide
      })
    );
    sign.name = `${storefront.name}_Sign`;
    sign.position.set(store.x < 0 ? 11.45 : -11.45, 9.0, 0);
    sign.rotation.y = store.face;
    storefront.add(sign);

    storefront.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    group.add(storefront);
  }

  return group;
}

function createMainStreetBaseballStadium(surfaceY) {
  const group = new THREE.Group();
  group.name = "Main_Street_Baseball_Stadium";

  const mainX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Main Street")?.x || 0;
  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const stadiumX = MAIN_MENU_SPAWN.x + mainX + 74;
  const stadiumZ = MAIN_MENU_SPAWN.z + exchangeZ + 150;
  const baseY = surfaceY + 0.04;

  const grassMat = new THREE.MeshStandardMaterial({ name: "baseball_outfield_grass", color: 0x276d3a, roughness: 0.96, side: THREE.DoubleSide });
  const dirtMat = new THREE.MeshStandardMaterial({ name: "baseball_infield_dirt", color: 0xb0723b, roughness: 0.92, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshStandardMaterial({ name: "baseball_outfield_wall", color: 0x174f35, roughness: 0.75 });
  const gateMat = new THREE.MeshStandardMaterial({ name: "baseball_stadium_gate", color: 0xd8b35b, roughness: 0.55, metalness: 0.08 });
  const seatMat = new THREE.MeshStandardMaterial({ name: "baseball_blue_seats", color: 0x1e4e86, roughness: 0.7 });
  const lineMat = new THREE.MeshBasicMaterial({ name: "baseball_chalk", color: 0xffffff, side: THREE.DoubleSide });

  const addFlat = (mesh, x, z, yOffset = 0) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(stadiumX + x, baseY + yOffset, stadiumZ + z);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const field = addFlat(new THREE.Mesh(new THREE.CircleGeometry(38, 64, Math.PI * 0.25, Math.PI * 1.5), grassMat), 0, 0, 0);
  field.name = "Baseball_Stadium_Field";
  field.rotation.z = Math.PI;

  const stadiumWidth = 92;
  const stadiumDepth = 92;
  const northWall = new THREE.Mesh(new THREE.BoxGeometry(stadiumWidth, 6, 2.2), wallMat);
  northWall.name = "Baseball_Stadium_North_Wall";
  northWall.position.set(stadiumX, baseY + 3, stadiumZ - stadiumDepth / 2);
  group.add(northWall);
  const southWall = new THREE.Mesh(new THREE.BoxGeometry(stadiumWidth, 6, 2.2), wallMat);
  southWall.name = "Baseball_Stadium_South_Wall";
  southWall.position.set(stadiumX, baseY + 3, stadiumZ + stadiumDepth / 2);
  group.add(southWall);
  const westWall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6, stadiumDepth), wallMat);
  westWall.name = "Baseball_Stadium_West_Wall";
  westWall.position.set(stadiumX - stadiumWidth / 2, baseY + 3, stadiumZ);
  group.add(westWall);
  [-1, 1].forEach((side) => {
    const eastWall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6, (stadiumDepth - 20) / 2), wallMat);
    eastWall.name = "Baseball_Stadium_East_Wall_With_Center_Gate";
    eastWall.position.set(stadiumX + stadiumWidth / 2, baseY + 3, stadiumZ + side * ((stadiumDepth + 20) / 4));
    group.add(eastWall);
  });
  const entrance = new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 18), gateMat);
  entrance.name = "Baseball_Stadium_Center_Entrance";
  entrance.position.set(stadiumX + stadiumWidth / 2 + 5, baseY + 0.04, stadiumZ);
  entrance.receiveShadow = true;
  group.add(entrance);

  const infield = addFlat(new THREE.Mesh(new THREE.CircleGeometry(15, 4), dirtMat), 0, 18, 0.01);
  infield.name = "Baseball_Infield_Diamond";
  infield.rotation.z = Math.PI / 4;
  addFlat(new THREE.Mesh(new THREE.CircleGeometry(2.2, 24), dirtMat), 0, 18, 0.012).name = "Pitchers_Mound";

  const firstBaseLine = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(0.45, 42), lineMat.clone()), 15, 18, 0.018);
  firstBaseLine.name = "Baseball_First_Base_Line";
  firstBaseLine.rotation.z = Math.PI / 4;
  const thirdBaseLine = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(0.45, 42), lineMat.clone()), -15, 18, 0.018);
  thirdBaseLine.name = "Baseball_Third_Base_Line";
  thirdBaseLine.rotation.z = -Math.PI / 4;

  [-27, 0, 27].forEach((x, index) => {
    const stands = new THREE.Mesh(new THREE.BoxGeometry(19, 6 + index * 1.2, 8), seatMat);
    stands.name = "Baseball_Stands";
    stands.position.set(stadiumX + x, baseY + stands.geometry.parameters.height / 2, stadiumZ + 49);
    stands.castShadow = true;
    stands.receiveShadow = true;
    group.add(stands);
  });

  [-34, 34].forEach((x) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 52), wallMat);
    wall.name = "Baseball_Outfield_Wall";
    wall.position.set(stadiumX + x, baseY + 2.5, stadiumZ - 7);
    wall.rotation.y = x < 0 ? -0.45 : 0.45;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  });

  const duckCanvas = document.createElement("canvas");
  duckCanvas.width = 512;
  duckCanvas.height = 512;
  const ctx = duckCanvas.getContext("2d");
  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = "#173d7a";
  ctx.beginPath();
  ctx.arc(256, 256, 205, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.fillStyle = "#ffc928";
  ctx.beginPath();
  ctx.ellipse(258, 283, 128, 92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(202, 204, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f47a2a";
  ctx.beginPath();
  ctx.moveTo(145, 214);
  ctx.lineTo(60, 238);
  ctx.lineTo(145, 261);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(188, 190, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff3a6";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(270, 222);
  ctx.bezierCurveTo(332, 193, 382, 211, 410, 259);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 54px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("DUCKS", 256, 396);
  const duckTexture = new THREE.CanvasTexture(duckCanvas);
  duckTexture.colorSpace = THREE.SRGBColorSpace;
  const duckLogo = addFlat(
    new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshBasicMaterial({ name: "rubber_duck_field_logo", map: duckTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
    ),
    0,
    -4,
    0.03
  );
  duckLogo.name = "Rubber_Duck_Logo_On_Baseball_Field";
  duckLogo.renderOrder = -2;

  return group;
}

function createAkronStreetViewDetails(surfaceY) {
  const group = new THREE.Group();
  group.name = "Akron_Street_View_Inspired_Details";

  const mainX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Main Street")?.x || 0;
  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const baseX = MAIN_MENU_SPAWN.x + mainX;
  const baseZ = MAIN_MENU_SPAWN.z + exchangeZ;
  const baseY = surfaceY;

  const brickMat = new THREE.MeshStandardMaterial({ name: "akron_historic_brick", color: 0x8a4633, roughness: 0.86 });
  const stoneMat = new THREE.MeshStandardMaterial({ name: "akron_stone_trim", color: 0xc9bda7, roughness: 0.88 });
  const corniceMat = new THREE.MeshStandardMaterial({ name: "akron_dark_cornice", color: 0x26282b, roughness: 0.72 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "akron_storefront_glass", color: 0x8dbed0, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.68 });
  const poleMat = new THREE.MeshStandardMaterial({ name: "akron_signal_poles", color: 0x2a2b2d, roughness: 0.64 });
  const lampMat = new THREE.MeshBasicMaterial({ name: "akron_lamp_glow", color: 0xfff1b2 });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x161616, transparent: true, opacity: 0.86 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ name: "akron_wide_sidewalks", color: 0xbeb8a7, roughness: 0.94 });

  const facadeRows = [
    { side: -1, z: -110, count: 4, face: Math.PI / 2, names: ["CIVIC", "LOFTS", "MARKET", "CAFE"] },
    { side: 1, z: -110, count: 4, face: -Math.PI / 2, names: ["ARCADE", "BANK", "PRESS", "GRILL"] },
    { side: -1, z: 76, count: 3, face: Math.PI / 2, names: ["MUSIC", "CLUB", "SHOP"] },
    { side: 1, z: 76, count: 3, face: -Math.PI / 2, names: ["TOWER", "LOBBY", "ROOMS"] }
  ];

  for (const row of facadeRows) {
    for (let i = 0; i < row.count; i++) {
      const x = row.side * (34 + (i % 2) * 6);
      const z = row.z + i * 22;
      const h = 18 + (i % 3) * 5;
      const building = new THREE.Group();
      building.name = `Akron_Downtown_Facade_${row.names[i]}`;
      building.position.set(baseX + x, baseY, baseZ + z);

      const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(12, 0.16, 22), sidewalkMat);
      sidewalk.name = "Downtown_Wide_Sidewalk";
      sidewalk.position.set(-row.side * 5.5, 0.03, 0);
      building.add(sidewalk);

      const body = new THREE.Mesh(new THREE.BoxGeometry(16, h, 19), brickMat);
      body.name = "Historic_Brick_Building";
      body.position.y = h / 2;
      body.castShadow = true;
      body.receiveShadow = true;
      building.add(body);

      const cornice = new THREE.Mesh(new THREE.BoxGeometry(17.5, 1.0, 20.5), corniceMat);
      cornice.name = "Historic_Cornice";
      cornice.position.y = h + 0.5;
      cornice.castShadow = true;
      building.add(cornice);

      for (let floor = 0; floor < Math.floor(h / 5) - 1; floor++) {
        [-3.8, 3.8].forEach((zOff) => {
          const window = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 3.0), glassMat);
          window.name = "Tall_Downtown_Window";
          window.position.set(-row.side * 8.1, 5.2 + floor * 4.4, zOff);
          building.add(window);
        });
      }

      const storefront = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.2, 13), glassMat);
      storefront.name = "Street_Level_Storefront";
      storefront.position.set(-row.side * 8.2, 2.9, 0);
      building.add(storefront);

      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(7.8, 2.5),
        new THREE.MeshBasicMaterial({
          name: "Akron_Downtown_Sign",
          map: createTextSignTexture(row.names[i], "MAIN EXCHANGE", "#28364b", "#d8b35b"),
          side: THREE.DoubleSide
        })
      );
      sign.name = `${row.names[i]}_Main_Exchange_Sign`;
      sign.position.set(-row.side * 8.45, 7.1, 0);
      sign.rotation.y = row.face;
      building.add(sign);

      group.add(building);
    }
  }

  [-1, 1].forEach((side) => {
    [-120, -82, 72, 110].forEach((z) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 6.8, 10), poleMat);
      pole.name = "Downtown_Streetlight_Pole";
      pole.position.set(baseX + side * 14.5, baseY + 3.4, baseZ + z);
      pole.castShadow = true;
      group.add(pole);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), lampMat);
      head.name = "Downtown_Streetlight_Glow";
      head.position.set(baseX + side * 14.5, baseY + 6.95, baseZ + z);
      group.add(head);
    });
  });

  [-1, 1].forEach((side) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8.5, 10), poleMat);
    pole.name = "Main_Exchange_Overhead_Wire_Pole";
    pole.position.set(baseX + side * 18, baseY + 4.25, baseZ - 18);
    group.add(pole);
  });
  const wireGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(baseX - 18, baseY + 8.2, baseZ - 18),
    new THREE.Vector3(baseX - 6, baseY + 7.65, baseZ - 18),
    new THREE.Vector3(baseX + 6, baseY + 7.65, baseZ - 18),
    new THREE.Vector3(baseX + 18, baseY + 8.2, baseZ - 18)
  ]);
  const overheadWire = new THREE.Line(wireGeometry, wireMat);
  overheadWire.name = "Main_Exchange_Overhead_Signal_Wire";
  group.add(overheadWire);

  const wayfindingSign = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 5),
    new THREE.MeshBasicMaterial({
      name: "Canal_Park_Wayfinding_Sign",
      map: createTextSignTexture("CANAL PARK", "RUBBER DUCKS", "#173d7a", "#ffc928"),
      side: THREE.DoubleSide
    })
  );
  wayfindingSign.name = "Canal_Park_Rubber_Ducks_Wayfinding";
  wayfindingSign.position.set(baseX + 20, baseY + 6.5, baseZ + 110);
  wayfindingSign.rotation.y = Math.PI;
  group.add(wayfindingSign);

  return group;
}

function createExchangeStreetCorridor(surfaceY) {
  const group = new THREE.Group();
  group.name = "Exchange_Street_InfoCision_To_Main_Corridor";

  const mainX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Main Street")?.x || 0;
  const brownX = AKRON_NORTH_SOUTH_ROADS.find((road) => road.name === "Brown Street")?.x || -120;
  const exchangeZ = AKRON_EAST_WEST_ROADS.find((road) => road.name === "Exchange Street")?.z || 80;
  const startX = MAIN_MENU_SPAWN.x + brownX;
  const endX = MAIN_MENU_SPAWN.x + mainX;
  const streetZ = MAIN_MENU_SPAWN.z + exchangeZ;
  const baseY = surfaceY;

  const sidewalkMat = new THREE.MeshStandardMaterial({ name: "exchange_corridor_sidewalk", color: 0xc9c0ad, roughness: 0.93 });
  const campusBrickMat = new THREE.MeshStandardMaterial({ name: "ua_campus_brick", color: 0x8c4430, roughness: 0.84 });
  const campusStoneMat = new THREE.MeshStandardMaterial({ name: "ua_limestone_trim", color: 0xd2c5ad, roughness: 0.86 });
  const deckMat = new THREE.MeshStandardMaterial({ name: "exchange_parking_deck_concrete", color: 0xb9b9b3, roughness: 0.9 });
  const deckShadowMat = new THREE.MeshStandardMaterial({ name: "parking_deck_openings", color: 0x2c3135, roughness: 0.82 });
  const stadiumBlueMat = new THREE.MeshStandardMaterial({ name: "infocision_blue", color: 0x143d78, roughness: 0.68 });
  const goldMat = new THREE.MeshStandardMaterial({ name: "akron_zips_gold", color: 0xd8aa36, roughness: 0.5, metalness: 0.05 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "exchange_corridor_glass", color: 0x91c7dc, roughness: 0.18, metalness: 0.08, transparent: true, opacity: 0.7 });
  const blackMat = new THREE.MeshStandardMaterial({ name: "exchange_street_fixture_black", color: 0x1f2224, roughness: 0.68 });

  const addFlat = (mesh, x, z, yOffset = 0) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, baseY + yOffset, z);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  [-1, 1].forEach((side) => {
    const sidewalk = addFlat(
      new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(endX - startX), 7), sidewalkMat),
      (startX + endX) / 2,
      streetZ + side * 12.8,
      0.035
    );
    sidewalk.name = side < 0 ? "North_Exchange_Sidewalk" : "South_Exchange_Sidewalk";
  });

  const makeBuilding = ({ name, x, z, w, d, h, mat, trim = true, sign = null, signColor = "#24364f", accent = "#d8aa36" }) => {
    const exchangeClearance = EXPANDED_CITY_ROAD_WIDTH / 2 + 12;
    if (Math.abs(z - streetZ) - d / 2 < exchangeClearance) {
      z = streetZ + Math.sign(z - streetZ || 1) * (exchangeClearance + d / 2);
    }
    const mainClearance = EXPANDED_CITY_ROAD_WIDTH / 2 + 12;
    if (Math.abs(x - endX) - w / 2 < mainClearance) {
      x = endX + Math.sign(x - endX || -1) * (mainClearance + w / 2);
    }

    const building = new THREE.Group();
    building.name = name;
    building.position.set(x, baseY, z);

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    body.name = `${name}_Body`;
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    building.add(body);

    if (trim) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.8, d + 1.2), campusStoneMat);
      cap.name = `${name}_Stone_Cornice`;
      cap.position.y = h + 0.45;
      cap.castShadow = true;
      building.add(cap);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.8, d + 0.8), campusStoneMat);
      base.name = `${name}_Stone_Base`;
      base.position.y = 0.45;
      building.add(base);
    }

    const frontSide = z < streetZ ? 1 : -1;
    for (let ix = -1; ix <= 1; ix += 1) {
      for (let floor = 0; floor < Math.max(1, Math.floor(h / 5) - 1); floor += 1) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 0.24), glassMat);
        window.name = `${name}_Window`;
        window.position.set(ix * (w / 4), 4.4 + floor * 4.2, frontSide * (d / 2 + 0.14));
        building.add(window);
      }
    }

    if (sign) {
      const signMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(w - 2, 18), 4.6),
        new THREE.MeshBasicMaterial({
          name: `${name}_Sign_Material`,
          map: createTextSignTexture(sign, "E EXCHANGE", signColor, accent),
          side: THREE.DoubleSide
        })
      );
      signMesh.name = `${name}_Sign`;
      signMesh.position.set(0, h + 3.2, frontSide * (d / 2 + 0.2));
      signMesh.rotation.y = frontSide > 0 ? 0 : Math.PI;
      building.add(signMesh);
    }

    group.add(building);
    return building;
  };

  makeBuilding({
    name: "InfoCision_Stadium_Exchange_Frontage",
    x: startX - 16,
    z: streetZ - 44,
    w: 58,
    d: 28,
    h: 18,
    mat: stadiumBlueMat,
    sign: "INFOCISION",
    signColor: "#143d78",
    accent: "#d8aa36"
  });
  const stadiumGate = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 3), goldMat);
  stadiumGate.name = "InfoCision_Stadium_Gate_One";
  stadiumGate.position.set(startX - 16, baseY + 5, streetZ - 27.5);
  stadiumGate.castShadow = true;
  group.add(stadiumGate);

  makeBuilding({
    name: "UA_South_Campus_Parking_Deck",
    x: startX + 18,
    z: streetZ - 42,
    w: 34,
    d: 24,
    h: 20,
    mat: deckMat,
    sign: "PARKING",
    signColor: "#303336",
    accent: "#d8aa36"
  });
  for (let floor = 0; floor < 4; floor += 1) {
    const opening = new THREE.Mesh(new THREE.BoxGeometry(30, 1.15, 0.28), deckShadowMat);
    opening.name = "Parking_Deck_Open_Bay";
    opening.position.set(startX + 18, baseY + 4 + floor * 3.7, streetZ - 29.75);
    group.add(opening);
  }

  makeBuilding({
    name: "UA_Exchange_Classroom_Building",
    x: startX + 58,
    z: streetZ - 42,
    w: 30,
    d: 23,
    h: 15,
    mat: campusBrickMat,
    sign: "AKRON U",
    signColor: "#10234b",
    accent: "#d8aa36"
  });

  const foodStops = [
    { name: "Hanini_Subs_Exchange", label: "HANINI SUBS", x: startX + 8, z: streetZ + 35, color: "#174f35", accent: "#ffffff" },
    { name: "Penn_Station_Exchange", label: "PENN SUBS", x: startX + 45, z: streetZ + 35, color: "#7a241d", accent: "#f4d35e" },
    { name: "Taste_Of_Bangkok_Exchange", label: "THAI", x: startX + 82, z: streetZ + 35, color: "#27213c", accent: "#f2a65a" }
  ];
  for (const stop of foodStops) {
    makeBuilding({
      name: stop.name,
      x: stop.x,
      z: stop.z,
      w: 28,
      d: 20,
      h: 10,
      mat: campusBrickMat,
      sign: stop.label,
      signColor: stop.color,
      accent: stop.accent
    });
  }

  makeBuilding({
    name: "Polsky_Style_Main_Exchange_Block",
    x: endX - 38,
    z: streetZ - 46,
    w: 24,
    d: 22,
    h: 24,
    mat: campusStoneMat,
    sign: "POLSKY",
    signColor: "#d4c59b",
    accent: "#28364b"
  });

  const crosswalkMat = new THREE.MeshBasicMaterial({ name: "exchange_crosswalk_white", color: 0xf5f2e8, side: THREE.DoubleSide });
  [startX + 3, startX + 47, startX + 88, endX - 6].forEach((x, index) => {
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      const crosswalk = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(1.2, 5.8), crosswalkMat.clone()), x + stripe * 2.1, streetZ, 0.095);
      crosswalk.name = `Exchange_Corridor_Midblock_Crosswalk_${index}`;
    }
  });

  for (let x = startX - 50; x <= endX + 10; x += 22) {
    [-1, 1].forEach((side) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.8, 10), blackMat);
      pole.name = "Exchange_Corridor_Streetlight";
      pole.position.set(x, baseY + 2.4, streetZ + side * 15.7);
      pole.castShadow = true;
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b2 }));
      lamp.name = "Exchange_Corridor_Streetlight_Lamp";
      lamp.position.set(x, baseY + 4.95, streetZ + side * 15.7);
      group.add(lamp);
    });
  }

  const wireMat = new THREE.LineBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.72 });
  [-1, 1].forEach((side) => {
    const points = [];
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const x = THREE.MathUtils.lerp(startX - 46, endX + 8, t);
      const sag = Math.sin(t * Math.PI * 4) * 0.5;
      points.push(new THREE.Vector3(x, baseY + 7.2 + sag, streetZ + side * 17.8));
    }
    const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wireMat);
    wire.name = side < 0 ? "North_Exchange_Overhead_Wire" : "South_Exchange_Overhead_Wire";
    group.add(wire);
  });

  return group;
}

export function updateAkronSceneTrafficLights(dt = 0) {
  if (!assets.menuScene) return;
  assets.akronSignalTime = ((assets.akronSignalTime || 0) + dt) % AKRON_SIGNAL_CYCLE;
  assets.menuScene.traverse((child) => {
    const lamp = child.userData?.akronSignalLamp;
    if (lamp && child.material?.color) {
      const stateName = akronSignalState(assets.akronSignalTime, lamp.phase);
      child.material.color.setHex(stateName === lamp.color ? lamp.litColor : lamp.darkColor);
      return;
    }
    const glow = child.userData?.akronSignalGlow;
    if (glow && child.material) {
      const stateName = akronSignalState(assets.akronSignalTime, glow.phase);
      child.material.opacity = stateName === glow.color ? glow.litOpacity : 0;
    }
  });
}

function createExpandedCityMap() {
  const group = new THREE.Group();
  group.name = "Expanded_City_Map";
  group.userData.worldSpaceScene = true;

  const surfaceY = MAIN_MENU_SPAWN.y - 0.92;
  const roadLength = EXPANDED_CITY_SIZE;
  const roadMat = new THREE.MeshStandardMaterial({ name: "akron_asphalt", color: 0x363a3d, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide });
  const grassMat = new THREE.MeshStandardMaterial({ name: "akron_ground", color: 0x607447, roughness: 1, side: THREE.DoubleSide });
  const curbMat = new THREE.MeshStandardMaterial({ name: "akron_curb", color: 0xbeb8a7, roughness: 0.94 });
  const lineMat = new THREE.MeshBasicMaterial({ name: "akron_yellow_centerline", color: 0xffd322, side: THREE.DoubleSide });
  const whiteMat = new THREE.MeshBasicMaterial({ name: "akron_stop_bar", color: 0xf0f0e8, side: THREE.DoubleSide });
  const stationRed = new THREE.MeshStandardMaterial({ name: "red_gas_station", color: 0xd51e16, roughness: 0.5, metalness: 0.03 });
  const stationWhite = new THREE.MeshStandardMaterial({ name: "gas_station_trim", color: 0xf4f0e4, roughness: 0.62 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(roadLength, roadLength * 0.72), grassMat);
  ground.name = "Akron_Ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(MAIN_MENU_SPAWN.x, surfaceY - 0.04, MAIN_MENU_SPAWN.z);
  ground.receiveShadow = true;
  group.add(ground);

  const addFlat = (mesh, x, z, yOffset = 0) => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(MAIN_MENU_SPAWN.x + x, surfaceY + yOffset, MAIN_MENU_SPAWN.z + z);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const addTurnPocket = (x, z, rotation = 0) => {
    const lane = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(1.0, 25), whiteMat.clone()), x, z, 0.085);
    lane.name = "Left_Turn_Lane_Line";
    lane.rotation.z = rotation;
    const arrow = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.4), lineMat.clone()), x, z, 0.09);
    arrow.name = "Left_Turn_Lane_Arrow";
    arrow.rotation.z = rotation;
  };

  for (const road of AKRON_NORTH_SOUTH_ROADS) {
    addFlat(new THREE.Mesh(new THREE.PlaneGeometry(EXPANDED_CITY_ROAD_WIDTH, roadLength), roadMat.clone()), road.x, 0, 0.01).name = `Road_${road.name}`;
    const line = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(0.5, roadLength), lineMat.clone()), road.x, 0, 0.045);
    line.name = `Centerline_${road.name}`;
    line.renderOrder = -4;
    [-1, 1].forEach((side) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, roadLength), curbMat);
      curb.name = `Curb_${road.name}`;
      curb.position.set(MAIN_MENU_SPAWN.x + road.x + side * (EXPANDED_CITY_ROAD_WIDTH / 2), surfaceY + 0.08, MAIN_MENU_SPAWN.z);
      curb.castShadow = true;
      curb.receiveShadow = true;
      group.add(curb);
    });
    group.add(createStreetLabel(road.name, MAIN_MENU_SPAWN.x + road.x + 12, surfaceY + 0.08, MAIN_MENU_SPAWN.z - roadLength * 0.34, 0));
  }

  for (const road of AKRON_EAST_WEST_ROADS) {
    addFlat(new THREE.Mesh(new THREE.PlaneGeometry(roadLength, EXPANDED_CITY_ROAD_WIDTH), roadMat.clone()), 0, road.z, 0.02).name = `Road_${road.name}`;
    const line = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(roadLength, 0.5), lineMat.clone()), 0, road.z, 0.055);
    line.name = `Centerline_${road.name}`;
    line.renderOrder = -4;
    [-1, 1].forEach((side) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(roadLength, 0.18, 0.32), curbMat);
      curb.name = `Curb_${road.name}`;
      curb.position.set(MAIN_MENU_SPAWN.x, surfaceY + 0.08, MAIN_MENU_SPAWN.z + road.z + side * (EXPANDED_CITY_ROAD_WIDTH / 2));
      curb.castShadow = true;
      curb.receiveShadow = true;
      group.add(curb);
    });
    group.add(createStreetLabel(road.name, MAIN_MENU_SPAWN.x - roadLength * 0.33, surfaceY + 0.08, MAIN_MENU_SPAWN.z + road.z - 12, Math.PI / 2));
  }

  for (const ns of AKRON_NORTH_SOUTH_ROADS) {
    for (const ew of AKRON_EAST_WEST_ROADS) {
      const x = ns.x;
      const z = ew.z;
      const crosswalkEW = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(EXPANDED_CITY_ROAD_WIDTH + 8, 1.0), whiteMat.clone()), x, z - 11, 0.07);
      crosswalkEW.name = `StopBar_${ns.name}_${ew.name}_EW`;
      const crosswalkNS = addFlat(new THREE.Mesh(new THREE.PlaneGeometry(1.0, EXPANDED_CITY_ROAD_WIDTH + 8), whiteMat.clone()), x - 11, z, 0.075);
      crosswalkNS.name = `StopBar_${ns.name}_${ew.name}_NS`;
      group.add(createTrafficLight(MAIN_MENU_SPAWN.x + x + 11.2, surfaceY, MAIN_MENU_SPAWN.z + z + 12.5, Math.PI, "northsouth"));
      group.add(createTrafficLight(MAIN_MENU_SPAWN.x + x - 11.2, surfaceY, MAIN_MENU_SPAWN.z + z - 12.5, 0, "northsouth"));
      group.add(createTrafficLight(MAIN_MENU_SPAWN.x + x + 12.5, surfaceY, MAIN_MENU_SPAWN.z + z - 11.2, -Math.PI / 2, "eastwest"));
      group.add(createTrafficLight(MAIN_MENU_SPAWN.x + x - 12.5, surfaceY, MAIN_MENU_SPAWN.z + z + 11.2, Math.PI / 2, "eastwest"));
      if ((ns.name === "Main Street" && ew.name === "Market Street") ||
          (ns.name === "Brown Street" && ew.name === "Exchange Street") ||
          (ns.name === "Arlington Street" && ew.name === "Exchange Street")) {
        addTurnPocket(x - 2.2, z + 24, 0);
        addTurnPocket(x + 2.2, z - 24, 0);
        addTurnPocket(x - 24, z - 2.2, Math.PI / 2);
        addTurnPocket(x + 24, z + 2.2, Math.PI / 2);
      }
    }
  }

  const gasX = MAIN_MENU_SPAWN.x + AKRON_NORTH_SOUTH_ROADS[0].x - 34;
  const gasZ = MAIN_MENU_SPAWN.z + AKRON_EAST_WEST_ROADS[1].z + 30;
  const station = new THREE.Group();
  station.name = "Red_Gas_Station_Brown_Exchange";
  const store = new THREE.Mesh(new THREE.BoxGeometry(24, 8, 16), stationRed);
  store.position.set(gasX, surfaceY + 4, gasZ);
  store.castShadow = true;
  store.receiveShadow = true;
  station.add(store);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(34, 1.4, 24), stationRed);
  roof.position.set(gasX + 16, surfaceY + 5.6, gasZ - 18);
  roof.castShadow = true;
  station.add(roof);
  [-7, 7].forEach((x) => {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, 1.8), stationWhite);
    pump.position.set(gasX + 16 + x, surfaceY + 1.4, gasZ - 18);
    pump.castShadow = true;
    station.add(pump);
  });
  station.add(createStreetLabel("GAS", gasX, surfaceY + 8.7, gasZ + 8, 0));
  group.add(station);
  group.add(createFootballFieldWithKangaroo(surfaceY));
  group.add(createGyroRestaurant(surfaceY));
  group.add(createMcdsRestaurant(surfaceY));
  group.add(createDowntownRestaurantArea(surfaceY));
  group.add(createMainStreetBaseballStadium(surfaceY));
  group.add(createAkronStreetViewDetails(surfaceY));
  group.add(createExchangeStreetCorridor(surfaceY));

  return group;
}

function attachExpandedCityMap(model) {
  if (!model || model.getObjectByName("Expanded_City_Map")) return;
  const expansion = createExpandedCityMap();
  stabilizeTerrainRendering(expansion);
  world.menuBackdrop.add(expansion);
  world.menuBackdrop.updateMatrixWorld(true);
  model.updateMatrixWorld(true);
  model.attach(expansion);
  model.updateMatrixWorld(true);
}

async function loadWithTimeout(url, timeoutMs = 12000) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out loading ${url}`)), timeoutMs);
  });
  try {
    return await Promise.race([loader.loadAsync(url), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- FBX loader path management --------------------------------------------

// Many RCCP vehicle FBXs embed texture references by bare/short names (e.g.
// "Carbonfiber.png", "caterhamDiffuse.png") and rely on Unity's .meta GUID
// remap to resolve them. Three.js's FBXLoader has no knowledge of .meta files,
// so we translate those names here:
//   - string value → rewrite to this path relative to the vehicle root
//   - null         → swallow the request (dangling GUID / unloadable format
//                    like TGA) by returning a 1x1 transparent PNG stub so no
//                    404 appears in the console and no broken image decode
//                    error surfaces in three.js
//
// Rules are keyed by a regex matched against the URL's parent directory so
// the modifier is stateless and safe across parallel FBX loads — important
// because main.js kicks off several loadCandidate calls via Promise.all, and
// a per-call closure over `root` would race (the modifier is a singleton on
// the LoadingManager, so whichever caller wins sets the closure for every
// texture request in flight).
const TRANSPARENT_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
const CITY_TEXTURE_REDIRECTS = {
  "Blinds_Roman_Hobbled_Blue.png": "https://static.seeles.ai/data/upload/8d6623cd-8962-4aae-8cef-c9fe66171eb2_Blinds_Roman_Hobbled_Blue.png",
  "Building texture 1.png": "https://static.seeles.ai/data/upload/17820120-ea3c-4a2b-8497-d5e92a0fb7a4_Building texture 1.png",
  "Building texture 2.png": "https://static.seeles.ai/data/upload/e67e5bcf-b56f-4711-890f-7afc11331d01_Building texture 2.png",
  "Building texture 3.png": "https://static.seeles.ai/data/upload/2bbac181-a4de-40a8-89e0-5c6ca9ac8755_Building texture 3.png",
  "Building texture 4.png": "https://static.seeles.ai/data/upload/9db992f4-0dd9-4220-abaf-b0b8a36ba37d_Building texture 4.png",
  "Building texture 5.png": "https://static.seeles.ai/data/upload/1479fa9f-7b34-4b1f-a91f-82d0502e7073_Building texture 5.png",
  "Building texture 6.png": "https://static.seeles.ai/data/upload/fa2d4267-5722-4c37-9f1d-8546010d9413_Building texture 6.png",
  "Building texture 7.png": "https://static.seeles.ai/data/upload/db8287f7-d7a9-4b28-9914-bfe39c4c5cbf_Building texture 7.png",
  "Building texture 8.png": "https://static.seeles.ai/data/upload/c8338148-abf7-49db-9022-9d5922e6f02d_Building texture 8.png",
  "Building texture 9.png": "https://static.seeles.ai/data/upload/55fada3d-6ea6-4f86-a792-cfe33061221e_Building texture 9.png",
  "Building texture 11.png": "https://static.seeles.ai/data/upload/f58cb084-aaf8-415e-9fc9-658bacfd995a_Building texture 11.png",
  "Building texture 12.png": "https://static.seeles.ai/data/upload/ec258eae-a4bc-489b-920b-f6975e7fe6fa_Building texture 12.png",
  "Building texture 13.png": "https://static.seeles.ai/data/upload/13406d32-132e-42da-bccf-e62225f6764e_Building texture 13.png",
  "Building texture 14.png": "https://static.seeles.ai/data/upload/bdbf598f-fd68-4355-b803-dada73b9d517_Building texture 14.png",
  "Building texture 15.png": "https://static.seeles.ai/data/upload/71c49cd0-fb98-47d5-951c-c16692ebec39_Building texture 15.png",
  "Building texture 16.png": "https://static.seeles.ai/data/upload/e51bb1a5-4224-43ee-9725-b2ce25d92236_Building texture 16.png",
  "Building texture 17.png": "https://static.seeles.ai/data/upload/8fcfc52d-68c0-45b5-80c6-aea9325f04ce_Building texture 17.png",
  "Building texture 18.png": "https://static.seeles.ai/data/upload/4828bb52-0dc5-440c-8d4f-504f5220a608_Building texture 18.png",
  "Building texture 19.png": "https://static.seeles.ai/data/upload/a722d385-3922-4b1b-8cc3-ac63baac92d7_Building texture 19.png",
  "Building texture 20.png": "https://static.seeles.ai/data/upload/464d191f-7232-46c1-96ba-a6bd60d0c3ae_Building texture 20.png",
  "Building texture 21.png": "https://static.seeles.ai/data/upload/6c81be47-7c4d-4ebe-82a7-0dfaa7801fcd_Building texture 21.png",
  "Building texture 22.png": "https://static.seeles.ai/data/upload/e404dc57-6220-4ff5-bf64-307751e2bc97_Building texture 22.png",
  "Building texture 23.png": "https://static.seeles.ai/data/upload/6e24fe25-4be8-450d-bc35-1865dc43fd41_Building texture 23.png",
  "Building texture 24.png": "https://static.seeles.ai/data/upload/9364d896-0527-4a1c-a3e3-c5dcc179a5fc_Building texture 24.png",
  "Building texture 25.png": "https://static.seeles.ai/data/upload/89f90dfa-56d2-41c9-9296-5334da1f531c_Building texture 25.png",
  "Building texture 26.png": "https://static.seeles.ai/data/upload/43c6b1ea-6c40-4a19-8004-7df0c6522776_Building texture 26.png",
  "Building texture 27.png": "https://static.seeles.ai/data/upload/3a2e8abb-4443-4a76-a347-202393e7e53a_Building texture 27.png",
  "Building texture 28.png": "https://static.seeles.ai/data/upload/beb597b9-79a8-407e-ae08-e70291c801ea_Building texture 28.png",
  "Building texture 29.png": "https://static.seeles.ai/data/upload/19d008c4-153e-4571-a7c6-73e2f3f013eb_Building texture 29.png",
  "Building texture 31.png": "https://static.seeles.ai/data/upload/df14c020-ff07-48ae-851a-14d3649bc4ab_Building texture 31.png",
  "Building texture 32.png": "https://static.seeles.ai/data/upload/e7118f5b-8106-4cc6-9c5a-a7f2e918798a_Building texture 32.png",
  "Building texture 33.png": "https://static.seeles.ai/data/upload/a2dbc5c3-c1df-4382-96a2-e26947dfff44_Building texture 33.png",
  "Building texture 34.png": "https://static.seeles.ai/data/upload/729c1454-89c9-4109-b7a5-e93a1601bc4b_Building texture 34.png",
  "Building texture 35.png": "https://static.seeles.ai/data/upload/e91648a1-4034-4a76-8a2b-334684f482fb_Building texture 35.png",
  "Building texture 36.png": "https://static.seeles.ai/data/upload/1a0b7778-5561-4c47-9d9b-b5ee51ade43d_Building texture 36.png",
  "Building texture 37.png": "https://static.seeles.ai/data/upload/c2169c8f-743f-4da6-aff0-63b60f6acd5a_Building texture 37.png",
  "Building texture 38.png": "https://static.seeles.ai/data/upload/e69ee345-fe0e-4c97-a772-cf5dde089450_Building texture 38.png",
  "Building texture 39.png": "https://static.seeles.ai/data/upload/b2f8c16c-6065-4a6f-b7a5-374e64639541_Building texture 39.png",
  "Building texture 40.png": "https://static.seeles.ai/data/upload/037f40e7-f7f4-4aa9-8b95-5c7b2b2348d1_Building texture 40.png",
  "Building texture 41.png": "https://static.seeles.ai/data/upload/ba12e66b-f059-47bc-a849-d8ed53eb1611_Building texture 41.png",
  "Building texture 42.png": "https://static.seeles.ai/data/upload/0d1b1793-544d-4061-9c74-c7f30157a144_Building texture 42.png",
  "Building texture 43.png": "https://static.seeles.ai/data/upload/1b591bb9-d8da-434d-bc0e-8d00e277b871_Building texture 43.png",
  "Building texture 44.png": "https://static.seeles.ai/data/upload/624137f9-9f17-4bec-8156-1038f23102fd_Building texture 44.png",
  "Building texture 45.png": "https://static.seeles.ai/data/upload/988f4a3e-4378-456f-9636-2e6e5e1f4a4c_Building texture 45.png",
  "Building texture 46.png": "https://static.seeles.ai/data/upload/98bdf8a2-6d77-4353-a9b1-bda972259151_Building texture 46.png",
  "Building texture 47.png": "https://static.seeles.ai/data/upload/9cfa5f53-f5e6-44d6-bd64-aaa4dcc63f98_Building texture 47.png",
  "Building texture 48.png": "https://static.seeles.ai/data/upload/e2c6f332-8e7c-4fdf-b14e-96c8f2ab9065_Building texture 48.png",
  "Building texture 49.png": "https://static.seeles.ai/data/upload/085b72e1-3568-4431-a5f4-309ee29ae991_Building texture 49.png",
  "Building texture 50.png": "https://static.seeles.ai/data/upload/b09f65af-f3ca-47a8-b07c-7136801f879a_Building texture 50.png",
  "Building texture 51.png": "https://static.seeles.ai/data/upload/a7f63189-77cc-4683-bb8a-b13364e41c96_Building texture 51.png",
  "Building texture 52.png": "https://static.seeles.ai/data/upload/90c0283f-e438-489c-be05-cc9f48e6bc08_Building texture 52.png",
  "Building texture 53.png": "https://static.seeles.ai/data/upload/077b1a06-6d2b-4a4f-976c-254be8b1de93_Building texture 53.png",
  "Building texture 54.png": "https://static.seeles.ai/data/upload/ae467975-68a0-4137-bb06-6a91a4a9f591_Building texture 54.png",
  "Building texture 55.png": "https://static.seeles.ai/data/upload/c61d70c8-6c24-4324-ad0e-1ebaa2187fab_Building texture 55.png",
  "Building texture 56.png": "https://static.seeles.ai/data/upload/ad966e95-9e4f-4347-852a-2869c532dc24_Building texture 56.png",
  "Building texture 57.png": "https://static.seeles.ai/data/upload/3a26e19f-ae26-42c1-895b-347558c5452a_Building texture 57.png",
  "Building texture 58.png": "https://static.seeles.ai/data/upload/2181d890-f8cf-4beb-8a6a-571bf27b3df0_Building texture 58.png",
  "Building_088.png": "https://static.seeles.ai/data/upload/387435db-639a-45f0-aa74-9760a6f8d555_Building_088.png",
  "Building_88.png": "https://static.seeles.ai/data/upload/393a9647-2605-45a8-a819-70e9e025cba1_Building_88.png",
  "Building_89.png": "https://static.seeles.ai/data/upload/634894d0-68af-4e11-9697-71358b5ae0dd_Building_89.png",
  "Building_Wall_1.png": "https://static.seeles.ai/data/upload/49d059b4-dc70-42a0-8d0e-b9f3db5a99f9_Building_Wall_1.png",
  "Building_Windows_1.png": "https://static.seeles.ai/data/upload/10f98b4c-fdea-4adc-a07b-a2f734eccb8a_Building_Windows_1.png",
  "Building_Windows_2.png": "https://static.seeles.ai/data/upload/3e4aeac5-8d54-4393-9ab8-73188581f049_Building_Windows_2.png",
  "Building_Windows_3.png": "https://static.seeles.ai/data/upload/ad644834-33a1-42d5-b222-c0cfd6d77afc_Building_Windows_3.png",
  "Building_Windows_4.png": "https://static.seeles.ai/data/upload/5ef3ff0f-f5d1-4a17-a361-e0aac775546e_Building_Windows_4.png",
  "Building_Windows_5.png": "https://static.seeles.ai/data/upload/f468c5e7-5d20-4ab4-ac70-3ee794bb1f77_Building_Windows_5.png",
  "Building_Windows_6.png": "https://static.seeles.ai/data/upload/a6b3fad6-7799-42fe-abe0-580befe4fc10_Building_Windows_6.png",
  "Building_Windows_7.png": "https://static.seeles.ai/data/upload/6fd1e525-221b-4219-86fe-72b07a3629e1_Building_Windows_7.png",
  "Building_Windows_8.png": "https://static.seeles.ai/data/upload/b2fb0cef-8f34-4b86-8fcc-f303430cbeef_Building_Windows_8.png",
  "Building_Windows_9.png": "https://static.seeles.ai/data/upload/b061df50-ffab-4add-912c-2d079000928e_Building_Windows_9.png",
  "Building_Windows_10.png": "https://static.seeles.ai/data/upload/749480d5-3433-462d-a15c-ae4ffd6a0e7f_Building_Windows_10.png",
  "Building_Windows_12.png": "https://static.seeles.ai/data/upload/f5aeb464-7cb9-497d-ae21-a4f9cd095d57_Building_Windows_12.png",
  "Building_Windows_14.png": "https://static.seeles.ai/data/upload/f32a6a13-97a8-42bd-b595-21d9e8281c11_Building_Windows_14.png",
  "Building_Windows_15.png": "https://static.seeles.ai/data/upload/680f757d-2d7b-4f24-9ce7-06193eab8ced_Building_Windows_15.png",
  "Building_Windows_16.png": "https://static.seeles.ai/data/upload/f6586f8e-2888-4618-8b4e-bc8d724b2824_Building_Windows_16.png",
  "Building_Windows_17.png": "https://static.seeles.ai/data/upload/2443c16c-7b25-4b91-98ce-657ef385c1b7_Building_Windows_17.png",
  "Building_Windows_18.png": "https://static.seeles.ai/data/upload/6af9a587-5b7f-49cb-97ec-da60543208e6_Building_Windows_18.png",
  "Building_Windows_19.png": "https://static.seeles.ai/data/upload/cfcdadaf-bd52-4eca-984c-3c4437960e12_Building_Windows_19.png",
  "Building_Windows_20.png": "https://static.seeles.ai/data/upload/8c1935e2-9de5-460a-9c09-29cdb665ccc8_Building_Windows_20.png",
  "Building_Windows_21.png": "https://static.seeles.ai/data/upload/c1b0d6e4-1f11-4c4d-9e67-ee9b48f9d089_Building_Windows_21.png",
  "Building_Windows_22.png": "https://static.seeles.ai/data/upload/fbf4c51b-e861-4b87-9994-76ee9cfd9be2_Building_Windows_22.png",
  "Building_Windows_23.png": "https://static.seeles.ai/data/upload/fcf28f48-6331-41e2-bdb7-24373e1fc996_Building_Windows_23.png",
  "Building_Windows_24.png": "https://static.seeles.ai/data/upload/f5a29a1c-d282-408a-ac7e-602e777e3069_Building_Windows_24.png",
  "Building_Windows_25.png": "https://static.seeles.ai/data/upload/717c5f1b-52e1-4241-8eb4-8ea7fb09233b_Building_Windows_25.png",
  "City_Grass.png": "https://static.seeles.ai/data/upload/bc4b9fd6-2139-4827-a39e-9affb845f777_City_Grass.png",
  "City_Water_Pool.png": "https://static.seeles.ai/data/upload/f1eb5c56-1d35-4f92-9974-b4d7cb08139f_City_Water_Pool.png",
  "City_Water_Pool_N.png": "https://static.seeles.ai/data/upload/87ec3fcc-f0c9-428d-a18d-46ff484d1670_City_Water_Pool_N.png",
  "Fencing_Iron.png": "https://static.seeles.ai/data/upload/7d9690f2-c2ff-4411-b127-5b5e1a8f1c01_Fencing_Iron.png",
  "Fencing_Metal_Straight.png": "https://static.seeles.ai/data/upload/e8088881-a22e-4509-955d-5d9f0c6c4fbd_Fencing_Metal_Straight.png",
  "Fencing_Wood_Rail.png": "https://static.seeles.ai/data/upload/732192de-0b67-48be-b593-4b6900d365b3_Fencing_Wood_Rail.png",
  "Metal_Brass_Ceiling.png": "https://static.seeles.ai/data/upload/119af01f-1505-4304-81f9-f47db83917d1_Metal_Brass_Ceiling.png",
  "Metal_Seamed.png": "https://static.seeles.ai/data/upload/bb683ce3-8db1-4b07-9734-e3dffa494286_Metal_Seamed.png",
  "Roofing_Metal_Standing_Seam_Green.png": "https://static.seeles.ai/data/upload/5681ab49-d206-475d-a1f7-566d6b047756_Roofing_Metal_Standing_Seam_Green.png",
  "Roofing_Shingles_GAF_Mansion.png": "https://static.seeles.ai/data/upload/77e023ce-9129-4c13-8209-68072908f231_Roofing_Shingles_GAF_Mansion.png",
  "Roofing_Shingles_Variable.png": "https://static.seeles.ai/data/upload/d03bf274-c5cc-4dde-841e-9c95b7f1e606_Roofing_Shingles_Variable.png",
  "Tile_Ceramic.png": "https://static.seeles.ai/data/upload/30baebd9-c03c-4b35-ae8b-5c3ef6d1c0c2_Tile_Ceramic.png",
  "Tile_Ceramic_2.png": "https://static.seeles.ai/data/upload/aea31516-3996-4543-8414-7287671a0364_Tile_Ceramic_2.png",
  "Tile_Ceramic_4.png": "https://static.seeles.ai/data/upload/38680aab-9f0b-4113-8c72-2b15418af571_Tile_Ceramic_4.png",
  "Tile_Ceramic_5.png": "https://static.seeles.ai/data/upload/6505032f-9cbb-4d0c-bd04-abc46f62e1e2_Tile_Ceramic_5.png",
  "Tile_Ceramic_6.png": "https://static.seeles.ai/data/upload/235608e2-c5b1-496e-b6bb-194cc46c0bb9_Tile_Ceramic_6.png",
  "Tile_Marble_Basket.png": "https://static.seeles.ai/data/upload/9160b754-5f09-43eb-9ddf-7ffe8ce45637_Tile_Marble_Basket.png",
  "Translucent_Block_Swirl.png": "https://static.seeles.ai/data/upload/708ee0e1-3e96-4d94-999a-3a92c8ddfe0b_Translucent_Block_Swirl.png"
};
const REMOTE_VEHICLE_TEXTURE_REDIRECTS = {
  "Carbonfiber.png": "https://static.seeles.ai/data/upload/ff2551bf-8bf3-4e57-b5c0-edd4e590b38a_Carbonfiber.png",
  "Carbonfiber_N.png": "https://static.seeles.ai/data/upload/ec55c9d6-2545-4d65-84e3-17011d150c5c_F1_Carbonfiber_N.png",
  "skylineColor.png": "https://static.seeles.ai/data/upload/4d782b69-09d4-4518-b977-78b518ae8f52_skylineColor.png",
  "skylineColor_N.png": "https://static.seeles.ai/data/upload/be78dedf-0e90-4a08-93d4-f91e8c78c058_skylineColor_N.png",
  "skylineDetail2.png": "https://static.seeles.ai/data/upload/a9b785ca-9f93-4403-ab24-a6bc1e91b55e_skylineDetail2.png",
  "skylineEmmisive.png": "https://static.seeles.ai/data/upload/8f4a11aa-a2a6-4c09-9653-0d32a7a2e826_skylineEmmisive.png",
  "skylineSpecular.png": "https://static.seeles.ai/data/upload/647c0c5d-6a38-41fc-8b66-dd8b6aec58d8_skylineSpecular.png",
  "caterhamDiffuse.png": "https://static.seeles.ai/data/upload/97e93965-7f53-42bf-8266-f5473220c343_caterhamDiffuse.png",
  "caterhamSpecular.png": "https://static.seeles.ai/data/upload/18698fd3-61dc-40fb-bf02-c8ef3a419730_caterhamSpecular.tga",
  "caterhamSpecular.tga": "https://static.seeles.ai/data/upload/18698fd3-61dc-40fb-bf02-c8ef3a419730_caterhamSpecular.tga",
  "sofieD.png": "https://static.seeles.ai/data/upload/a8e7fa11-008d-42a1-a291-eb437cc829e6_sofieD.png",
  "sofieS.png": "https://static.seeles.ai/data/upload/e7133944-97ba-4fa3-a82f-e53153379fdb_sofieS.png",
  "CTR_Front.png": "https://static.seeles.ai/data/upload/5644e4da-8417-4454-8a23-fb366ea99f48_CTR_Front.png",
  "CTR_Rear.png": "https://static.seeles.ai/data/upload/9ec09e32-c247-49bd-b523-0e0f212051e2_CTR_Rear.png",
  "E30_Headlights.png": "https://static.seeles.ai/data/upload/264e12ea-4026-4e0f-afae-e629674f963a_E30_Headlights.png",
  "E30_RearLights.png": "https://static.seeles.ai/data/upload/bb564f9e-a14d-4b39-bd44-fd5deb8ee597_E30_RearLights.png",
  "M3_E36_Light.png": "https://static.seeles.ai/data/upload/41c38ece-23c8-4ccc-9f51-82dbf9640fe6_M3_E36_Light.png",
  "M3_E36_Light_normal.png": "https://static.seeles.ai/data/upload/9e625766-ddfa-48ca-91d2-ea77b8dadc1d_M3_E36_Light_normal.png",
  "M3_E36_Misc.png": "https://static.seeles.ai/data/upload/caef866e-2537-4cdc-be41-ad6ba11110fa_M3_E36_Misc.png",
  "M3_E36_Misc_normal.png": "https://static.seeles.ai/data/upload/7f5157f4-de0f-48e5-92cf-0ea5c04c3e0a_M3_E36_Misc_normal.png",
  "M3_E36_Rim.png": "https://static.seeles.ai/data/upload/8c93e49f-aa1b-4e0a-aeb8-0f415586ecaf_M3_E36_Rim.png",
  "M3_E36_Rim_normal.png": "https://static.seeles.ai/data/upload/d3c90cd1-314e-4632-9e1b-2c9c16f4a5c8_M3_E36_Rim_normal.png",
  "M3_E36_Tire.png": "https://static.seeles.ai/data/upload/a60becf4-51ba-484a-90f4-c7f9270b2c41_M3_E36_Tire.png",
  "M3_E36_Tire_normal.png": "https://static.seeles.ai/data/upload/0e9e508d-8cd8-4366-a329-3c29b9854bd9_M3_E36_Tire_normal.png",
  "M3_E36 Light.png": "https://static.seeles.ai/data/upload/41c38ece-23c8-4ccc-9f51-82dbf9640fe6_M3_E36_Light.png",
  "M3_E36 Light_normal.png": "https://static.seeles.ai/data/upload/9e625766-ddfa-48ca-91d2-ea77b8dadc1d_M3_E36_Light_normal.png",
  "M3_E36 Misc.png": "https://static.seeles.ai/data/upload/caef866e-2537-4cdc-be41-ad6ba11110fa_M3_E36_Misc.png",
  "M3_E36 Misc_normal.png": "https://static.seeles.ai/data/upload/7f5157f4-de0f-48e5-92cf-0ea5c04c3e0a_M3_E36_Misc_normal.png",
  "M3_E36 Rim.png": "https://static.seeles.ai/data/upload/8c93e49f-aa1b-4e0a-aeb8-0f415586ecaf_M3_E36_Rim.png",
  "M3_E36 Rim_normal.png": "https://static.seeles.ai/data/upload/d3c90cd1-314e-4632-9e1b-2c9c16f4a5c8_M3_E36_Rim_normal.png",
  "M3_E36 Tire.png": "https://static.seeles.ai/data/upload/a60becf4-51ba-484a-90f4-c7f9270b2c41_M3_E36_Tire.png",
  "M3_E36 Tire_normal.png": "https://static.seeles.ai/data/upload/0e9e508d-8cd8-4366-a329-3c29b9854bd9_M3_E36_Tire_normal.png",
  "Carpet.png": "https://static.seeles.ai/data/upload/ac15fe80-7d7a-4806-941a-5df3abf04157_Carpet.png",
  "E46_Carpet.png": "https://static.seeles.ai/data/upload/5c657abb-21fb-4117-b6a7-c74305988cbb_E46_Carpet.png",
  "E46_Dashboard.png": "https://static.seeles.ai/data/upload/e930e2a1-b1c9-40f8-b0dd-51cd031f7d21_E46_Dashboard.png",
  "E46_Leather.png": "https://static.seeles.ai/data/upload/df21f47d-c9fc-41e3-9dbe-13eb0e7ec17d_E46_Leather.png",
  "E46_Needle.png": "https://static.seeles.ai/data/upload/9ba74bd7-6616-49be-9b67-f5e9df33368a_E46_Needle.png",
  "E46_Rear.png": "https://static.seeles.ai/data/upload/be6521d3-b1fb-4372-bf61-f2dbbc48ddc8_E46_Rear.png",
  "Leather.png": "https://static.seeles.ai/data/upload/20658996-27b0-45d6-a4bb-4ba0caaf6b1f_Leather.png"
};
const VEHICLE_TEXTURE_RULES = [
  {
    // F1: FBX uses the bare name "Carbonfiber"/"Tire"; Tex file is F1_-prefixed,
    // Tire has no asset (dangling GUID from the base RCCP package).
    match: /\/F1\/$/i,
    rewrites: {
      "Carbonfiber.png": "Tex/F1_Carbonfiber.png",
      "Carbonfiber_N.png": "Tex/F1_Carbonfiber_N.png",
      "Tire.png": null,
      "Tire_N.png": null
    }
  },
  {
    // Sofie (BUMSTRUM): textures live under Tex/ with matching bare names,
    // except caterhamSpecular is shipped as a .tga (browsers can't decode),
    // and caterhamNormal + sofieN don't exist in the repo at all.
    match: /\/Sofie\/$/i,
    rewrites: {
      "caterhamDiffuse.png": "Tex/caterhamDiffuse.png",
      "caterhamSpecular.png": null,
      "caterhamNormal.png": null,
      "sofieD.png": "Tex/sofieD.png",
      "sofieS.png": "Tex/sofieS.png",
      "sofieN.png": null
    }
  }
];

function resolveVehicleRewrite(parentDir, fileName) {
  for (const rule of VEHICLE_TEXTURE_RULES) {
    if (!rule.match.test(parentDir)) continue;
    if (Object.prototype.hasOwnProperty.call(rule.rewrites, fileName)) {
      return rule.rewrites[fileName];
    }
  }
  return undefined;
}

function resolveCityTextureRedirect(url, fileName) {
  const isCitySceneAsset =
    /\/Models\/City(?:\/|$)/i.test(url) ||
    url.startsWith(REMOTE_MENU_SCENE_URL.slice(0, REMOTE_MENU_SCENE_URL.lastIndexOf("/") + 1));
  if (!isCitySceneAsset) return undefined;
  return CITY_TEXTURE_REDIRECTS[fileName];
}

function resolveRemoteVehicleTextureRedirect(fileName) {
  return REMOTE_VEHICLE_TEXTURE_REDIRECTS[fileName];
}

// Install the URL modifier once, at module load, against the shared manager.
// The modifier is stateless: it derives the parent directory from the URL it
// receives, so it works for any FBX root and does not depend on which
// resourcePath() call most recently ran.
manager.setURLModifier((url) => {
  // data: URIs are already-embedded content; blob: URIs are object URLs from
  // in-memory buffers. Leave them alone — we only rewrite network fetches.
  if (/^(data:|blob:)/i.test(url)) return url;
  const normalized = url.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return normalized;
  const fileName = normalized.slice(slash + 1);
  const parentDir = normalized.slice(0, slash + 1);
  let decodedFileName = fileName;
  try {
    decodedFileName = decodeURIComponent(fileName);
  } catch {}
  const cityRedirect = resolveCityTextureRedirect(normalized, decodedFileName);
  if (cityRedirect) return cityRedirect;
  const remoteVehicleTextureRedirect = resolveRemoteVehicleTextureRedirect(decodedFileName);
  if (remoteVehicleTextureRedirect) return remoteVehicleTextureRedirect;
  const rewrite = resolveVehicleRewrite(parentDir, fileName);
  if (rewrite === null) return TRANSPARENT_PNG_DATA_URI;
  if (typeof rewrite === "string") return `${parentDir}${rewrite}`;
  return normalized;
});

export function resourcePath(root) {
  loader.setResourcePath(root);
}

export async function loadCandidate(relative) {
  const remoteUrl = REMOTE_LOAD_CANDIDATES[relative];
  if (remoteUrl) {
    resourcePath(remoteUrl.slice(0, remoteUrl.lastIndexOf("/") + 1));
    try {
      return await loadWithTimeout(remoteUrl);
    } catch {
      return createFallbackPartPack(relative.includes("Spoilers") ? "spoilers" : "wheels");
    }
  }
  for (const base of BASES) {
    const assetPath = `${base}${relative}`;
    const root = assetPath.slice(0, assetPath.lastIndexOf("/") + 1);
    try {
      resourcePath(root);
      return await loader.loadAsync(assetPath);
    } catch {}
  }
  throw new Error(`Missing asset: ${relative}`);
}

export async function loadRootCandidate(relative) {
  const remoteUrl = REMOTE_ROOT_CANDIDATES[relative];
  if (remoteUrl) {
    resourcePath(remoteUrl.slice(0, remoteUrl.lastIndexOf("/") + 1));
    try {
      return await loadWithTimeout(remoteUrl);
    } catch {
      return createFallbackPartPack("traffic");
    }
  }
  for (const base of ROOT_BASES) {
    const assetPath = `${base}${relative}`;
    const root = assetPath.slice(0, assetPath.lastIndexOf("/") + 1);
    try {
      resourcePath(root);
      return await loader.loadAsync(assetPath);
    } catch {}
  }
  throw new Error(`Missing root asset: ${relative}`);
}

// --- Menu scene construction ------------------------------------------------

export function cloneMenuScene(source) {
  const model = source.clone(true);
  normalizeModel(model);
  applyCityMaterialLibrary(model);
  stabilizeTerrainRendering(model);
  return model;
}

export function getMenuScenePlacement(model) {
  if (assets.menuScenePlacement) return assets.menuScenePlacement;
  if (model?.userData?.worldSpaceScene) {
    assets.menuScenePlacement = {
      scale: 1,
      rotation: new THREE.Euler(),
      position: new THREE.Vector3()
    };
    return assets.menuScenePlacement;
  }
  model.rotation.copy(CITY_WORLD_ROTATION);
  model.updateMatrixWorld(true);
  assets.menuScenePlacement = {
    scale: CITY_WORLD_SCALE,
    rotation: CITY_WORLD_ROTATION.clone(),
    position: new THREE.Vector3()
  };
  return assets.menuScenePlacement;
}

export function placeMenuScene(model) {
  if (model?.userData?.worldSpaceScene) {
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    model.updateMatrixWorld(true);
    return;
  }
  const placement = getMenuScenePlacement(model);
  model.position.copy(placement.position);
  model.rotation.copy(placement.rotation);
  model.scale.copy(CITY_WORLD_SCALE_VECTOR);
  model.updateMatrixWorld(true);
}

export function logMenuSceneBounds(model) {
  const box = new THREE.Box3().setFromObject(model);
  if (!Number.isFinite(box.min.x)) return;
  menuSceneBounds = box;
}

// lowestHit: when true, iterate hits from bottom up and return the LOWEST
// valid (upward-facing) surface. Used when building the ground physics
// trimesh so that building rooftops do NOT produce spikes in the mesh —
// the road surface below always wins over the roof above it.
// Default (false) returns the topmost valid surface, which is correct for
// spawn-point resolution (car should land on a bridge, not the road under it).
//
// maxDropFromTop (only meaningful with lowestHit:true): clamps the lowest
// hit so it can't be more than N metres below the topmost valid hit. Scenes
// built from single-piece city FBX files often have a hidden "terrain
// plane" or basement geometry tens of metres beneath the visible road, and
// `lowestHit: true` without a clamp will return THAT, putting the whole
// trimesh far below the drivable surface and out of wheel raycast range.
// With maxDropFromTop set, we walk up from the bottom but only accept a
// hit that is within [topmost - maxDropFromTop, topmost].
export function getMenuSurfaceHeight(
  point,
  { lowestHit = false, maxDropFromTop = Infinity } = {}
) {
  if (!assets.menuScene) return null;
  assets.menuScene.updateMatrixWorld(true);

  const bounds = menuSceneBounds || new THREE.Box3().setFromObject(assets.menuScene);
  if (!Number.isFinite(bounds.min.x)) return null;

  const rayOrigin = new THREE.Vector3(
    point.x,
    Math.max(bounds.max.y + 250, point.y + 250),
    point.z
  );
  const raycaster = new THREE.Raycaster(
    rayOrigin,
    new THREE.Vector3(0, -1, 0),
    0,
    rayOrigin.y - (bounds.min.y - 250)
  );
  const hits = raycaster.intersectObject(assets.menuScene, true);
  const worldNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  // Walk the hit list once to collect upward-facing, valid hits (sorted
  // from nearest-to-ray-origin = highest Y to farthest = lowest Y).
  const validHeights = [];
  for (const hit of hits) {
    if (!hit.face || !hit.object?.matrixWorld) continue;
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    worldNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
    if (worldNormal.y < 0.35) continue;
    validHeights.push(hit.point.y);
  }

  if (validHeights.length === 0) return hits[0]?.point.y ?? null;

  if (!lowestHit) return validHeights[0];

  // lowestHit = true: start from the bottom and walk UP, but only accept
  // a hit that is within maxDropFromTop of the topmost valid hit. This
  // keeps us on the road-under-building (if present) while rejecting
  // basement / terrain-plane geometry that lurks far below.
  const top = validHeights[0];
  const floor = top - maxDropFromTop;
  for (let i = validHeights.length - 1; i >= 0; i--) {
    if (validHeights[i] >= floor) return validHeights[i];
  }
  return top;
}

export async function ensureMenuScene() {
  if (!assets.menuSceneSource) {
    const source = createExpandedCityMap();
    normalizeModel(source);
    assets.menuSceneSource = source;
  }
  return assets.menuSceneSource;
}

export async function applyMenuScene() {
  const source = await ensureMenuScene();
  if (assets.menuScene) world.menuBackdrop.remove(assets.menuScene);
  assets.menuScene = cloneMenuScene(source);
  placeMenuScene(assets.menuScene);
  logMenuSceneBounds(assets.menuScene);
  world.menuBackdrop.add(assets.menuScene);
  if (physics.ready) buildScenePhysics();
  if (MENU_ROUTES.includes(state.route)) {
    state.presentationRoute = "";
    _setPresentationMode();
  }
}
