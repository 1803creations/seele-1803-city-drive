// Pure selectors over state + save + config catalogs.
//
// Ported from the inline selector section of main.js. These are
// side-effect-free lookups for the current vehicle/mission/scene +
// setup + stats. Consumed by the HUD, route renderers, mission
// runtime, and action layer. No DI needed — they read state, save,
// and config constants directly.

import {
  getDefaultVehicleSetup,
  getVehicleLayout,
  resolveVehicleStats,
  SPOILERS,
  WHEELS
} from "../vehicle/VehicleConfig.js";
import { ccdsData } from "../generated/ccds-data.js";
import { rootAssetUrl } from "./utils.js";
import { VEHICLES, MISSIONS, SCENES } from "./config.js";
import { state, save } from "./state.js";

export const pick = (list, id) => list.find((item) => item.id === id) || list[0];

export const currentVehicle = () => pick(VEHICLES, state.vehicleId);
export const currentVehicleLayout = () => getVehicleLayout(currentVehicle());
export const currentVehicleDynamics = () => {
  const v = currentVehicle();
  const d = v?.raw?.dynamics;
  if (d && v.raw.upgradedEngineEfficiency !== undefined) {
    d.upgradedEngineEfficiency = v.raw.upgradedEngineEfficiency;
  }
  return d || null;
};
export const currentMission = () => pick(MISSIONS, state.missionId);
export const currentScene = () => SCENES.find((item) => item.buildIndex === save.selectedScene) || SCENES[0] || null;
export const currentSceneMissionLayouts = () => ccdsData.sceneMissionLayouts?.[currentScene()?.name] || {};
export const currentSceneMissionLayout = () => currentSceneMissionLayouts()[state.missionId] || null;

export function driveSceneOptions() {
  return SCENES.map((scene, index) => {
    const isMidnight = /city[_\s]?2/i.test(scene.name) || /city[_\s]?2/i.test(scene.label);
    return {
      ...scene,
      title: isMidnight ? "CITY_MIDNIGHT" : (index === 0 ? "CITY_DAY" : scene.shortLabel.replace(/\s+/g, "_").toUpperCase()),
      preview: rootAssetUrl(isMidnight ? "Textures/UI/CCDS_UI_Scene_Midnight.png" : "Textures/UI/CCDS_UI_Scene_Day.png"),
      variantClass: isMidnight ? "is-midnight" : "is-day"
    };
  });
}

export const isOwnedVehicle = (vehicleId) => save.ownedVehicles.includes(VEHICLES.findIndex((item) => item.id === vehicleId));
export const savedSetup = (vehicleId = state.vehicleId) => save.vehicleSetups[vehicleId] || getDefaultVehicleSetup();

export function currentSetup() {
  const setup = state.route === "customize" ? state.draft : savedSetup();
  // Pass through all customization fields (paintColor, upgrades, decal,
  // neon, mechanic) so applyVisuals can drive the 3D model, not just
  // spoiler/wheel which were the only two before Phase-2 customization.
  return {
    ...setup,
    spoiler: pick(SPOILERS, setup.spoiler),
    wheel: pick(WHEELS, setup.wheel)
  };
}

export function statsFor(vehicleId = state.vehicleId) {
  const vehicle = pick(VEHICLES, vehicleId);
  const setup = state.route === "customize" && vehicleId === state.vehicleId ? state.draft : savedSetup(vehicleId);
  return resolveVehicleStats(vehicle, setup);
}
