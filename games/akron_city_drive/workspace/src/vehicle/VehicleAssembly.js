import * as THREE from "three";
import { assets } from "../core/state.js";
import { world } from "../scene/World.js";

export function isVehicleBodyPart(materialName = "", meshName = "") {
  const token = `${materialName} ${meshName}`.toLowerCase();
  return !/(glass|window|wheel|tire|tyre|rim|light|lamp|neon|decal|spoiler)/.test(token);
}

export function createProceduralVehicle(vehicle, layout) {
  const group = new THREE.Group();
  group.name = `Vehicle_${vehicle.id}`;
  const color = new THREE.Color(vehicle.color || "#d34b31");

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1, 8, 3, 12),
    new THREE.MeshStandardMaterial({ name: "body_paint", color, roughness: 0.32, metalness: 0.55 })
  );
  body.name = "Body";
  body.scale.copy(layout.bodyScale || new THREE.Vector3(1.72, 0.72, 3.86));
  body.position.copy(layout.bodyOffset || new THREE.Vector3());
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1, 4, 2, 4),
    new THREE.MeshStandardMaterial({ name: "glass", color: 0x172638, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.82 })
  );
  cabin.name = "CabinGlass";
  cabin.scale.copy(layout.cabinScale || new THREE.Vector3(1.18, 0.54, 1.34));
  cabin.position.copy(layout.cabinOffset || new THREE.Vector3(0, 0.58, -0.34));
  cabin.castShadow = true;
  group.add(cabin);

  const trim = new THREE.MeshStandardMaterial({ name: "trim", color: 0x111318, roughness: 0.5, metalness: 0.35 });
  [-1, 1].forEach((z) => {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.18, 0.16), trim);
    bumper.name = z < 0 ? "FrontBumper" : "RearBumper";
    bumper.position.set(0, -0.08, z * 2.02);
    bumper.castShadow = true;
    group.add(bumper);
  });

  const lightMat = new THREE.MeshStandardMaterial({
    name: "brake_light",
    color: 0x7a1010,
    emissive: 0xff2020,
    emissiveIntensity: 0,
    roughness: 0.25
  });
  group.userData.lightMeshes = [];
  [-0.48, 0.48].forEach((x) => {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.04), lightMat.clone());
    light.name = "BrakeLight";
    light.position.set(x, 0.12, 2.12);
    group.userData.lightMeshes.push(light);
    group.add(light);
  });

  const tireMat = new THREE.MeshStandardMaterial({ name: "tire", color: 0x090909, roughness: 0.72, metalness: 0.05 });
  const rimMat = new THREE.MeshStandardMaterial({ name: "rim", color: 0xb6bcc0, roughness: 0.22, metalness: 0.78 });
  group.userData.wheelMeshes = [];
  (layout.wheels || []).forEach((wheel) => {
    const wheelGroup = new THREE.Group();
    wheelGroup.name = wheel.name || "Wheel";
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(wheel.radius || 0.38, wheel.radius || 0.38, 0.28, 32), tireMat);
    tire.rotation.z = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry((wheel.radius || 0.38) * 0.55, (wheel.radius || 0.38) * 0.55, 0.3, 24), rimMat);
    rim.rotation.z = Math.PI / 2;
    wheelGroup.add(tire, rim);
    wheelGroup.position.set(wheel.position.x, wheel.position.y, wheel.position.z);
    wheelGroup.userData.isWheel = true;
    wheelGroup.userData.isFront = wheel.isFront;
    group.userData.wheelMeshes.push(wheelGroup);
    group.add(wheelGroup);
  });

  group.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    child.userData.basePositions = child.geometry.attributes.position.array.slice();
  });
  return group;
}

export function getCarFocusPoint(fallback = new THREE.Vector3()) {
  if (!assets.car) return fallback.clone ? fallback.clone() : new THREE.Vector3();
  assets.car.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(assets.car);
  if (box.isEmpty()) return fallback.clone ? fallback.clone() : new THREE.Vector3();
  return box.getCenter(new THREE.Vector3());
}

export function ensureCarVisibleState() {
  world.carPivot.visible = true;
  if (assets.car) {
    assets.car.visible = true;
    assets.car.traverse((child) => {
      child.visible = true;
    });
  }
  return true;
}
