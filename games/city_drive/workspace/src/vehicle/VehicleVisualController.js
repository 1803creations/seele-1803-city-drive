import * as THREE from "three";
import { PAINT_COLORS, WHEELS } from "./VehicleConfig.js";
import { isVehicleBodyPart } from "./VehicleAssembly.js";

export class VehicleVisualController {
  constructor({ assets }) {
    this.assets = assets;
  }

  applyVisuals(vehicle, setup = {}) {
    const car = this.assets.car;
    if (!car) return;
    const paint = setup.paintColor && PAINT_COLORS[setup.paintColor]?.hex;
    const color = new THREE.Color(paint || vehicle?.color || "#d34b31");
    car.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!isVehicleBodyPart(material.name, child.name)) return;
        material.color.copy(color);
        if ("metalness" in material) material.metalness = 0.55;
        if ("roughness" in material) material.roughness = 0.32;
      });
    });
    const wheelConfig = WHEELS.find((item) => item.id === setup.wheel);
    car.userData.wheelStyle = wheelConfig?.id || "wheel_stock";
  }

  syncWheels(wheelAnchors = []) {
    const wheels = this.assets.car?.userData?.wheelMeshes || [];
    wheels.forEach((mesh, index) => {
      const anchor = wheelAnchors[index];
      if (!anchor) return;
      mesh.rotation.x = -(anchor.spin || 0);
      if (anchor.isFront) mesh.rotation.y = anchor.steerAngle || 0;
    });
  }

  syncWheelVisuals(wheelsOrAnchors = [], maybeAnchors = null) {
    this.syncWheels(maybeAnchors || wheelsOrAnchors);
  }

  updateBrakeLights(assets, brakeAmount = 0, headlightsOn = false) {
    const car = assets?.car || this.assets.car;
    if (!car) return;
    const intensity = Math.max(brakeAmount, headlightsOn ? 0.35 : 0);
    if (!car.userData.lightMeshes) return;
    car.userData.lightMeshes.forEach((light) => {
      light.material.emissiveIntensity = intensity;
      light.visible = intensity > 0.02;
    });
  }
}
