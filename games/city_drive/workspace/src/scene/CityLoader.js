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
const EXPANDED_CITY_ROAD_SPACING = 92;
const EXPANDED_CITY_ROAD_WIDTH = 16;

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

  const roadMat = new THREE.MeshStandardMaterial({ name: "asphalt", color: 0x45484d, roughness: 0.88 });
  const blockMat = new THREE.MeshStandardMaterial({ name: "concrete", color: 0x7a7d75, roughness: 0.92 });
  const grassMat = new THREE.MeshStandardMaterial({ name: "grass", color: 0x5f7f3a, roughness: 1 });

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

function createExpandedCityMap() {
  const group = new THREE.Group();
  group.name = "Expanded_City_Map";

  const surfaceY = MAIN_MENU_SPAWN.y - 0.92;
  const roadMat = new THREE.MeshStandardMaterial({ name: "expanded_asphalt", color: 0x383b3f, roughness: 0.9, metalness: 0.02 });
  const grassMat = new THREE.MeshStandardMaterial({ name: "expanded_grass", color: 0x647d3f, roughness: 1 });
  const curbMat = new THREE.MeshStandardMaterial({ name: "expanded_curb", color: 0xbeb8a7, roughness: 0.94 });
  const buildingMat = new THREE.MeshStandardMaterial({ name: "expanded_building", color: 0x777b7f, roughness: 0.86, metalness: 0.04 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(EXPANDED_CITY_SIZE, EXPANDED_CITY_SIZE), grassMat);
  ground.name = "Expanded_Ground";
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(MAIN_MENU_SPAWN.x, surfaceY - 0.04, MAIN_MENU_SPAWN.z);
  ground.receiveShadow = true;
  group.add(ground);

  const half = EXPANDED_CITY_SIZE / 2;
  for (let offset = -half; offset <= half + 0.1; offset += EXPANDED_CITY_ROAD_SPACING) {
    const roadEastWest = new THREE.Mesh(new THREE.PlaneGeometry(EXPANDED_CITY_SIZE, EXPANDED_CITY_ROAD_WIDTH), roadMat.clone());
    roadEastWest.name = "Expanded_Road_EW";
    roadEastWest.rotation.x = -Math.PI / 2;
    roadEastWest.position.set(MAIN_MENU_SPAWN.x, surfaceY, MAIN_MENU_SPAWN.z + offset);
    roadEastWest.receiveShadow = true;
    group.add(roadEastWest);

    const roadNorthSouth = new THREE.Mesh(new THREE.PlaneGeometry(EXPANDED_CITY_ROAD_WIDTH, EXPANDED_CITY_SIZE), roadMat.clone());
    roadNorthSouth.name = "Expanded_Road_NS";
    roadNorthSouth.rotation.x = -Math.PI / 2;
    roadNorthSouth.position.set(MAIN_MENU_SPAWN.x + offset, surfaceY + 0.01, MAIN_MENU_SPAWN.z);
    roadNorthSouth.receiveShadow = true;
    group.add(roadNorthSouth);

    [-1, 1].forEach((side) => {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(EXPANDED_CITY_SIZE, 0.16, 0.32), curbMat);
      curb.name = "Expanded_Curb_EW";
      curb.position.set(MAIN_MENU_SPAWN.x, surfaceY + 0.08, MAIN_MENU_SPAWN.z + offset + side * (EXPANDED_CITY_ROAD_WIDTH / 2));
      curb.castShadow = true;
      curb.receiveShadow = true;
      group.add(curb);
    });
  }

  for (let x = -half + EXPANDED_CITY_ROAD_SPACING / 2; x < half; x += EXPANDED_CITY_ROAD_SPACING) {
    for (let z = -half + EXPANDED_CITY_ROAD_SPACING / 2; z < half; z += EXPANDED_CITY_ROAD_SPACING) {
      if (Math.abs(x) < 150 && Math.abs(z) < 150) continue;
      if ((Math.round((x + z) / EXPANDED_CITY_ROAD_SPACING) & 1) !== 0) continue;
      const height = 7 + (Math.abs(Math.round(x + z)) % 5) * 2.4;
      const building = new THREE.Mesh(new THREE.BoxGeometry(22, height, 24), buildingMat.clone());
      building.name = "Expanded_Building";
      building.position.set(MAIN_MENU_SPAWN.x + x, surfaceY + height / 2, MAIN_MENU_SPAWN.z + z);
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);
    }
  }

  return group;
}

function attachExpandedCityMap(model) {
  if (!model || model.getObjectByName("Expanded_City_Map")) return;
  const expansion = createExpandedCityMap();
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
  return model;
}

export function getMenuScenePlacement(model) {
  if (assets.menuScenePlacement) return assets.menuScenePlacement;
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
  const placement = getMenuScenePlacement(model);
  model.position.copy(placement.position);
  model.rotation.copy(placement.rotation);
  model.scale.copy(CITY_WORLD_SCALE_VECTOR);
  model.updateMatrixWorld(true);
}

export function logMenuSceneBounds(model) {
  const box = new THREE.Box3().setFromObject(model);
  if (!Number.isFinite(box.min.x)) return;
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

  const bounds = new THREE.Box3().setFromObject(assets.menuScene);
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
    resourcePath(REMOTE_MENU_SCENE_URL.slice(0, REMOTE_MENU_SCENE_URL.lastIndexOf("/") + 1));
    let source;
    try {
      source = await loadWithTimeout(REMOTE_MENU_SCENE_URL);
    } catch {
      source = createFallbackCityScene();
    }
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
  attachExpandedCityMap(assets.menuScene);
  if (physics.ready) buildScenePhysics();
  if (MENU_ROUTES.includes(state.route)) {
    state.presentationRoute = "";
    _setPresentationMode();
  }
}
