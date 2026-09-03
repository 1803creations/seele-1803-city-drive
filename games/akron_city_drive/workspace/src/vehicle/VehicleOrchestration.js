import { assets, physics } from "../core/state.js";
import { VEHICLES } from "../core/config.js";
import { currentVehicle, currentSetup } from "../core/selectors.js";
import { normalizeModel } from "../core/utils.js";
import { world } from "../scene/World.js";
import { createProceduralVehicle } from "./VehicleAssembly.js";
import { getVehicleLayout } from "./VehicleConfig.js";
import { VehicleVisualController } from "./VehicleVisualController.js";

let _render = () => {};
let _setSceneText = () => {};

export const vehicleVisualController = new VehicleVisualController({ assets });

export function configureVehicleOrchestration({ render, setSceneText } = {}) {
  if (render) _render = render;
  if (setSceneText) _setSceneText = setSceneText;
}

export function applyVisuals() {
  vehicleVisualController.applyVisuals(currentVehicle(), currentSetup());
}

export function syncWheelVisuals() {
  vehicleVisualController.syncWheels(physics.wheelAnchors || []);
}

export async function swapVehicleModel(vehicleId) {
  const vehicle = VEHICLES.find((item) => item.id === vehicleId) || VEHICLES[0];
  if (!vehicle) return;
  assets.loadingVehicle = true;
  try {
    if (assets.car) {
      world.carPivot.remove(assets.car);
      assets.car.traverse?.((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
        else child.material?.dispose?.();
      });
    }
    const car = createProceduralVehicle(vehicle, getVehicleLayout(vehicle));
    normalizeModel(car);
    assets.car = car;
    car.position.set(0, 0, 0);
    car.rotation.set(0, 0, 0);
    car.visible = true;
    car.traverse?.((child) => {
      child.visible = true;
      if (child.isMesh) {
        child.frustumCulled = false;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material) material.needsUpdate = true;
        });
      }
    });
    world.carPivot.visible = true;
    world.carPivot.add(car);
    applyVisuals();
    _setSceneText("Vehicle", vehicle.label, "Reconstructed local vehicle model.");
  } finally {
    assets.loadingVehicle = false;
  }
  _render();
}
