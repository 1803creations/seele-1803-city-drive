import * as THREE from "three";

const DEFAULT_WHEELS = [
  { name: "front_left", position: { x: -0.78, y: -0.38, z: -1.18 }, radius: 0.38, suspensionDistance: 0.34, isFront: true, side: -1 },
  { name: "front_right", position: { x: 0.78, y: -0.38, z: -1.18 }, radius: 0.38, suspensionDistance: 0.34, isFront: true, side: 1 },
  { name: "rear_left", position: { x: -0.78, y: -0.38, z: 1.16 }, radius: 0.4, suspensionDistance: 0.34, isFront: false, side: -1 },
  { name: "rear_right", position: { x: 0.78, y: -0.38, z: 1.16 }, radius: 0.4, suspensionDistance: 0.34, isFront: false, side: 1 }
];

const DEFAULT_DYNAMICS = {
  engineTorque: 980,
  maxSpeedKmh: 185,
  brakeForce: 26,
  handbrakeForce: 42,
  steerAngle: 0.58,
  traction: 1.25,
  lateralGrip: 8.5,
  downforce: 0.12,
  rigidbody: { mass: 950, drag: 0.12, angularDrag: 0.9, centerOfMass: { x: 0, y: -0.35, z: 0.1 } },
  wheels: DEFAULT_WHEELS
};

export const SPOILERS = [
  { id: "spoiler_none", label: "Stock", price: 0, model: null, stats: { engine: 0, handling: 0, speed: 0 } },
  { id: "spoiler_00", label: "Street Wing", price: 900, model: "Spoiler_00", stats: { engine: 0, handling: 8, speed: 2 } },
  { id: "spoiler_01", label: "GT Wing", price: 1400, model: "Spoiler_01", stats: { engine: 0, handling: 12, speed: 4 } },
  { id: "spoiler_02", label: "Track Wing", price: 2200, model: "Spoiler_02", stats: { engine: 0, handling: 16, speed: 6 } }
];

export const WHEELS = [
  { id: "wheel_stock", label: "Stock", price: 0, model: null, stats: { engine: 0, handling: 0, speed: 0 } },
  { id: "wheel_01", label: "Street", price: 650, model: "Wheel_01", stats: { engine: 0, handling: 5, speed: 2 } },
  { id: "wheel_02", label: "Sport", price: 950, model: "Wheel_02", stats: { engine: 0, handling: 8, speed: 3 } },
  { id: "wheel_03", label: "Race", price: 1400, model: "Wheel_03", stats: { engine: 0, handling: 11, speed: 4 } }
];

export const PAINT_COLORS = {
  none: { label: "Stock", hex: null, price: 0 },
  Orange: { label: "Orange", hex: "#ff7a1a", price: 450 },
  Red: { label: "Red", hex: "#d83232", price: 450 },
  Blue: { label: "Blue", hex: "#2478db", price: 450 },
  Green: { label: "Green", hex: "#42b66b", price: 450 },
  Yellow: { label: "Yellow", hex: "#e9c83e", price: 450 },
  White: { label: "White", hex: "#f2f3ef", price: 450 },
  Black: { label: "Black", hex: "#12151a", price: 450 },
  Purple: { label: "Purple", hex: "#7e55c7", price: 450 },
  Silver: { label: "Silver", hex: "#aeb7bd", price: 450 }
};

export const DECAL_LOCATIONS = ["front", "back", "left", "right"];
export const DECALS = [
  { id: "decal_1", label: "Stripe 1", texture: "Realistic Car Controller Pro/Textures/Decals/1.png", price: 550 },
  { id: "decal_2", label: "Stripe 2", texture: "Realistic Car Controller Pro/Textures/Decals/2.png", price: 550 },
  { id: "decal_4", label: "Number 4", texture: "Realistic Car Controller Pro/Textures/Decals/4.png", price: 650 },
  { id: "decal_5", label: "Number 5", texture: "Realistic Car Controller Pro/Textures/Decals/5.png", price: 650 },
  { id: "decal_6", label: "Number 6", texture: "Realistic Car Controller Pro/Textures/Decals/6.png", price: 650 },
  { id: "decal_7", label: "Number 7", texture: "Realistic Car Controller Pro/Textures/Decals/7.png", price: 650 },
  { id: "decal_8", label: "Number 8", texture: "Realistic Car Controller Pro/Textures/Decals/8.png", price: 650 },
  { id: "decal_9", label: "Number 9", texture: "Realistic Car Controller Pro/Textures/Decals/9.png", price: 650 }
];

export const NEON_PROJECTOR = { texture: "Textures/CCDS_Neon.tga", icon: "Realistic Car Controller Pro/Textures/Upgrades/Logo_Neon.png" };
export const NEONS = [
  { id: "neon_blue", label: "Blue", color: "#2e8bff", price: 900 },
  { id: "neon_green", label: "Green", color: "#39ff88", price: 900 },
  { id: "neon_orange", label: "Orange", color: "#ff8a22", price: 900 },
  { id: "neon_pink", label: "Pink", color: "#ff4fc4", price: 900 }
];

export const UPGRADE_TIERS = 3;
export const UPGRADE_PRICE_PER_TIER = 1500;
export const UPGRADE_STAT_BONUS_PER_TIER = 12;

export const upgradeNextPrice = (level = 0) => Math.round(UPGRADE_PRICE_PER_TIER * (level + 1) * 1.35);

export function getDefaultVehicleSetup() {
  return {
    spoiler: "spoiler_none",
    wheel: "wheel_stock",
    paintColor: "none",
    upgrades: { engine: 0, handling: 0, speed: 0 },
    decal: null,
    decalLocation: "left",
    decals: {},
    neon: null,
    mechanic: {
      frontCamber: 0,
      rearCamber: 0,
      frontSpringForce: 1,
      rearSpringForce: 1,
      frontSuspension: 1,
      rearSuspension: 1,
      frontSpringDamp: 1,
      rearSpringDamp: 1
    }
  };
}

export function mergeVehicleSetup(setup = {}) {
  const base = getDefaultVehicleSetup();
  return {
    ...base,
    ...setup,
    upgrades: { ...base.upgrades, ...(setup?.upgrades || {}) },
    decals: { ...base.decals, ...(setup?.decals || {}) },
    mechanic: { ...base.mechanic, ...(setup?.mechanic || {}) }
  };
}

export function buildVehicleCatalog(data) {
  const source = Array.isArray(data?.vehicles) ? data.vehicles : [];
  return source.map((vehicle, index) => {
    const stats = vehicle.stats || {};
    const dynamicScale = 1 + index * 0.08;
    return {
      id: vehicle.id || `vehicle_${index}`,
      label: vehicle.label || vehicle.name || `Vehicle ${index + 1}`,
      color: vehicle.color || ["#d34b31", "#2688d9", "#d09b30", "#5fd1c7"][index % 4],
      price: vehicle.price ?? (index === 0 ? 0 : 18000 + index * 12000),
      stats: {
        engine: stats.engine ?? 115 + index * 18,
        handling: stats.handling ?? 120 + index * 10,
        speed: stats.speed ?? 125 + index * 20
      },
      raw: {
        ...vehicle,
        dynamics: {
          ...DEFAULT_DYNAMICS,
          ...vehicle.dynamics,
          engineTorque: (vehicle.dynamics?.engineTorque ?? DEFAULT_DYNAMICS.engineTorque) * dynamicScale,
          maxSpeedKmh: vehicle.dynamics?.maxSpeedKmh ?? 175 + index * 18,
          wheels: vehicle.dynamics?.wheels || DEFAULT_WHEELS.map((wheel) => ({ ...wheel, position: { ...wheel.position } }))
        }
      }
    };
  });
}

export function getVehicleLayout(vehicle) {
  return vehicle?.raw?.layout || {
    bodyScale: new THREE.Vector3(1.72, 0.72, 3.86),
    bodyOffset: new THREE.Vector3(0, 0.02, 0),
    cabinScale: new THREE.Vector3(1.18, 0.54, 1.34),
    cabinOffset: new THREE.Vector3(0, 0.58, -0.34),
    wheelScale: 1,
    wheels: DEFAULT_WHEELS
  };
}

export function buildWheelAnchors(layout, helpers = {}) {
  const vectorFromData = helpers.vectorFromData || ((v) => new THREE.Vector3(v?.x || 0, v?.y || 0, v?.z || 0));
  const wheels = layout?.wheels || DEFAULT_WHEELS;
  return wheels.map((wheel, index) => ({
    ...wheel,
    index,
    localPosition: vectorFromData(wheel.position),
    radius: wheel.radius ?? 0.38,
    suspensionDistance: wheel.suspensionDistance ?? 0.34,
    isFront: Boolean(wheel.isFront ?? index < 2),
    side: wheel.side ?? (index % 2 === 0 ? -1 : 1),
    compression: 0,
    grounded: false,
    spin: 0,
    steerAngle: 0
  }));
}

export function resolveVehicleStats(vehicle, setup = {}) {
  const merged = mergeVehicleSetup(setup);
  const spoiler = SPOILERS.find((item) => item.id === merged.spoiler) || SPOILERS[0];
  const wheel = WHEELS.find((item) => item.id === merged.wheel) || WHEELS[0];
  const upgrade = (key) => (merged.upgrades?.[key] || 0) * UPGRADE_STAT_BONUS_PER_TIER;
  return {
    engine: (vehicle?.stats?.engine || 100) + spoiler.stats.engine + wheel.stats.engine + upgrade("engine"),
    handling: (vehicle?.stats?.handling || 100) + spoiler.stats.handling + wheel.stats.handling + upgrade("handling"),
    speed: (vehicle?.stats?.speed || 100) + spoiler.stats.speed + wheel.stats.speed + upgrade("speed")
  };
}
