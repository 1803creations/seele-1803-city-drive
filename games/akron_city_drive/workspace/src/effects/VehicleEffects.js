// Vehicle damage / audio / skidmark effects.
//
// Ported from the inline effects section of main.js. Reads/writes into
// the shared `state`, `assets`, `physics`, `audioState`, and `world`
// singletons. Imports `currentVehicle` directly from core/selectors
// for body-color lookup during damage tinting.

import * as THREE from "three";
import { state, assets, physics, audioState } from "../core/state.js";
import { world } from "../scene/World.js";
import { currentVehicle, currentSetup } from "../core/selectors.js";
import { PAINT_COLORS } from "../vehicle/VehicleConfig.js";
import { isVehicleBodyPart } from "../vehicle/VehicleAssembly.js";

// --- Eager init: call at game start to avoid first-frame stutter ----------
// The tire smoke and exhaust systems create BufferGeometry + Canvas texture +
// GPU upload lazily on first use. Doing this during gameplay (e.g. first
// brake causing skid) blocks the main thread and freezes the screen.

export function warmUpParticleSystems() {
  getSmokeTexture();
  ensureTireSmoke();
  ensureExhaustSmoke();
  ensureExhaustFlameLight();
}

// --- Impact audio ---------------------------------------------------------

export function playImpactSound(force) {
  if (!audioState.impact.length) return;
  const audio = audioState.impact[audioState.impactIndex % audioState.impact.length];
  audioState.impactIndex += 1;
  audio.volume = THREE.MathUtils.clamp(force / 2200, 0.18, 0.9);
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {}
}

// --- Damage tint + smoke --------------------------------------------------

// Resolve the base body color that damage darkening should blend against.
// Must stay in sync with what the Customization tab applied via
// VehicleVisualController.applyVisuals — otherwise the damage pass
// overwrites the player's paint selection back to the vehicle default.
// `currentSetup()` already dispatches to state.draft during customize /
// savedSetup() during gameplay, so it's the single source of truth.
function currentBodyBaseColor() {
  const setup = currentSetup();
  const paintSwatch = setup?.paintColor ? PAINT_COLORS[setup.paintColor] : null;
  return paintSwatch?.hex || currentVehicle().color;
}

// Pre-allocated objects to avoid per-frame GC pressure
const _dmgTintColor = new THREE.Color();
const _dmgBaseColor = new THREE.Color();
const _dmgDarkTarget = new THREE.Color(0x2b2b2b);
const _dmgSmokeVec = new THREE.Vector3();
let _prevDamageRatio = -1;
let _prevBaseColorHex = null;

export function updateDamageEffects() {
  if (!assets.car) return;
  const damageRatio = THREE.MathUtils.clamp(state.game.damage / 100, 0, 1);
  const baseColorHex = currentBodyBaseColor();

  // Only traverse + update materials when damage or base color actually changed
  const damageChanged = Math.abs(damageRatio - _prevDamageRatio) > 0.001 || baseColorHex !== _prevBaseColorHex;
  if (damageChanged) {
    _prevDamageRatio = damageRatio;
    _prevBaseColorHex = baseColorHex;
    _dmgBaseColor.set(baseColorHex);
    _dmgTintColor.copy(_dmgBaseColor).lerp(_dmgDarkTarget, damageRatio * 0.45);
    const targetRoughness = THREE.MathUtils.lerp(0.12, 0.78, damageRatio);
    const targetMetalness = THREE.MathUtils.lerp(0.72, 0.28, damageRatio);

    assets.car.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        if (!isVehicleBodyPart(material.name, child.name)) return;
        material.color.copy(_dmgTintColor);
        if ("roughness" in material) material.roughness = targetRoughness;
        if ("metalness" in material) material.metalness = targetMetalness;
        // NOTE: do NOT set material.needsUpdate here — color/roughness/metalness
        // are uniform values, not shader-recompile triggers. needsUpdate = true
        // forces a full shader recompile every frame, killing performance.
      });
    });
  }

  if (physics.smoke) {
    if (damageRatio > 0.45) {
      physics.smoke.material.opacity = THREE.MathUtils.lerp(0.08, 0.72, (damageRatio - 0.45) / 0.55);
      _dmgSmokeVec.set(0, 1.4, -0.3).applyQuaternion(world.carPivot.quaternion);
      physics.smoke.position.copy(world.carPivot.position).add(_dmgSmokeVec);
    } else {
      physics.smoke.material.opacity = 0;
    }
  }
}

export function deformVehicleAtImpact(worldPoint, force) {
  if (!assets.car) return;
  // Skip deformation once the vehicle is wrecked — further dents serve no
  // visual purpose and accumulated vertex corruption can crash the renderer.
  if (state.game.damage >= 100) return;
  const dentRadius = THREE.MathUtils.clamp(force / 2000, 0.25, 1.0);
  const dentStrength = THREE.MathUtils.clamp(force / 6000, 0.03, 0.4);
  assets.car.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position || !child.userData.basePositions) return;
    if (!isVehicleBodyPart(child.material?.name, child.name)) return;
    const positions = child.geometry.attributes.position;
    const basePos = child.userData.basePositions;
    const localHit = child.worldToLocal(worldPoint.clone());
    // Compute mesh center for inward-push direction
    child.geometry.computeBoundingBox();
    const meshCenter = child.geometry.boundingBox.getCenter(new THREE.Vector3());
    let changed = false;
    for (let i = 0; i < positions.count; i += 1) {
      const vx = positions.getX(i);
      const vy = positions.getY(i);
      const vz = positions.getZ(i);
      const distance = Math.hypot(vx - localHit.x, vy - localHit.y, vz - localHit.z);
      if (distance > dentRadius) continue;
      const falloff = 1 - distance / dentRadius;
      // Push vertices inward toward mesh center (realistic crush)
      const toCenter_x = meshCenter.x - vx;
      const toCenter_y = meshCenter.y - vy;
      const toCenter_z = meshCenter.z - vz;
      const len = Math.hypot(toCenter_x, toCenter_y, toCenter_z) || 1;
      let nx = vx + (toCenter_x / len) * dentStrength * falloff;
      let ny = vy + (toCenter_y / len) * dentStrength * falloff * 0.6;
      let nz = vz + (toCenter_z / len) * dentStrength * falloff;
      // Clamp total deformation from original position to prevent runaway
      const bx = basePos[i * 3], by = basePos[i * 3 + 1], bz = basePos[i * 3 + 2];
      const maxDeform = 1.2;
      nx = THREE.MathUtils.clamp(nx, bx - maxDeform, bx + maxDeform);
      ny = THREE.MathUtils.clamp(ny, by - maxDeform, by + maxDeform);
      nz = THREE.MathUtils.clamp(nz, bz - maxDeform, bz + maxDeform);
      if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
        positions.setXYZ(i, nx, ny, nz);
        changed = true;
      }
    }
    if (changed) {
      positions.needsUpdate = true;
      // NOTE: DO NOT call computeVertexNormals() here. Accumulated dents can
      // collapse triangles to zero area → cross-product produces zero-vector →
      // normalize() yields NaN normals → NaN uploaded to GPU → Windows/ANGLE
      // driver crash → WebGL context loss → permanent screen freeze.
      // The original normals remain valid enough for small dent lighting.
    }
  });
}

// --- Engine + skid audio --------------------------------------------------

function ensureLoopPlayback(audio) {
  if (!audio) return;
  if (!audio.paused) return;
  void audio.play().catch(() => {});
}

export function updateVehicleAudio(speedRatio, skidAmount, isShifting, brakeAmount) {
  ensureLoopPlayback(audioState.engineIdle);
  ensureLoopPlayback(audioState.engineLow);
  ensureLoopPlayback(audioState.engineMed);
  ensureLoopPlayback(audioState.engineHigh);
  ensureLoopPlayback(audioState.skid);
  ensureLoopPlayback(audioState.turboSpool);
  ensureLoopPlayback(audioState.nos);
  ensureLoopPlayback(audioState.brakes);
  ensureLoopPlayback(audioState.wind);

  // 4-layer engine crossfade
  if (audioState.engineIdle) audioState.engineIdle.volume = THREE.MathUtils.clamp(0.28 - speedRatio * 0.18, 0.05, 0.28);
  if (audioState.engineLow) audioState.engineLow.volume = THREE.MathUtils.clamp(0.42 - Math.abs(speedRatio - 0.35), 0, 0.34);
  if (audioState.engineMed) audioState.engineMed.volume = THREE.MathUtils.clamp(speedRatio - 0.32, 0, 0.48);
  if (audioState.engineHigh) audioState.engineHigh.volume = THREE.MathUtils.clamp(speedRatio - 0.65, 0, 0.42);

  if (audioState.skid) audioState.skid.volume = THREE.MathUtils.clamp(skidAmount * 0.45, 0, 0.45);

  // Gear shift sound — play on shift start transition
  if (isShifting && !audioState._lastShiftState) {
    playGearShiftSound();
  }
  audioState._lastShiftState = isShifting;

  // Detect downshift for exhaust pop
  const currentGear = state.game.currentGear ?? 0;
  if (currentGear < audioState._lastGear && currentGear >= 0 && audioState._lastGear >= 0) {
    playExhaustPop();
  }
  audioState._lastGear = currentGear;

  // Brake sound — proportional to brakeAmount × speed
  const brakeVol = (brakeAmount ?? 0) * speedRatio * 0.5;
  if (audioState.brakes) audioState.brakes.volume = THREE.MathUtils.clamp(brakeVol, 0, 0.4);

  // Turbo spool — volume proportional to turboBoostPsi / maxTurboChargePsi
  const maxPsi = state.game.maxTurboChargePsi || 0;
  const curPsi = state.game.turboBoostPsi || 0;
  if (audioState.turboSpool) {
    audioState.turboSpool.volume = maxPsi > 0 ? THREE.MathUtils.clamp(curPsi / maxPsi * 0.35, 0, 0.35) : 0;
  }

  // NOS loop — audible when active
  if (audioState.nos) {
    audioState.nos.volume = state.game.nosActive ? 0.4 : 0;
  }

  // Wind — speed-dependent ambient
  if (audioState.wind) audioState.wind.volume = THREE.MathUtils.clamp(speedRatio * 0.25, 0, 0.25);
}

// --- Gear shift sound (round-robin) -----------------------------------------

function playGearShiftSound() {
  if (!audioState.gearShift.length) return;
  const audio = audioState.gearShift[audioState.gearShiftIndex % audioState.gearShift.length];
  audioState.gearShiftIndex += 1;
  audio.volume = 0.35;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {}
}

// --- Exhaust pop on downshift -----------------------------------------------

function playExhaustPop() {
  if (!audioState.exhaustFire.length) return;
  const audio = audioState.exhaustFire[Math.floor(Math.random() * audioState.exhaustFire.length)];
  audio.volume = THREE.MathUtils.clamp(0.15 + Math.random() * 0.15, 0.15, 0.3);
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {}
}

// --- Turbo blow-off ---------------------------------------------------------

export function playTurboBlowOff() {
  if (!audioState.turboBlow.length) return;
  const audio = audioState.turboBlow[Math.floor(Math.random() * audioState.turboBlow.length)];
  audio.volume = 0.3;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {}
}

// --- Cash sound -------------------------------------------------------------

export function playCashSound() {
  if (!audioState.cash) return;
  audioState.cash.volume = 0.45;
  try {
    audioState.cash.currentTime = 0;
    void audioState.cash.play().catch(() => {});
  } catch {}
}

// --- UI click sound ---------------------------------------------------------

export function playUiClickSound() {
  if (!audioState.uiClick) return;
  audioState.uiClick.volume = 0.3;
  try {
    audioState.uiClick.currentTime = 0;
    void audioState.uiClick.play().catch(() => {});
  } catch {}
}

// --- Police siren -----------------------------------------------------------

export function setPoliceSiren(active) {
  if (!audioState.policeSiren) return;
  if (active) {
    audioState.policeSiren.volume = 0.35;
    ensureLoopPlayback(audioState.policeSiren);
  } else {
    audioState.policeSiren.volume = 0;
    try { audioState.policeSiren.pause(); } catch {}
  }
}

// --- Background music -------------------------------------------------------

let _activeMusicTrack = -1;

export function startMusic(trackIndex = 0) {
  const track = audioState.music[trackIndex];
  if (!track) return;
  // Fade out any other track
  audioState.music.forEach((t, i) => {
    if (i !== trackIndex && t) { t.volume = 0; try { t.pause(); } catch {} }
  });
  _activeMusicTrack = trackIndex;
  const savedVol = typeof state?.game !== "undefined" ? 1 : 1;
  track.volume = Math.min(0.18, savedVol);
  ensureLoopPlayback(track);
}

export function stopMusic() {
  audioState.music.forEach((t) => {
    if (t) { t.volume = 0; try { t.pause(); } catch {} }
  });
  _activeMusicTrack = -1;
}

// --- Skidmarks ------------------------------------------------------------

export function addSkidSegment(from, to) {
  if (!physics.skidMarks) return;
  const positions = physics.skidMarks.geometry.attributes.position.array;
  const base = (physics.skidCursor % 1200) * 6;
  positions[base] = from.x;
  positions[base + 1] = from.y + 0.03;
  positions[base + 2] = from.z;
  positions[base + 3] = to.x;
  positions[base + 4] = to.y + 0.03;
  positions[base + 5] = to.z;
  physics.skidCursor += 1;
  physics.skidMarks.geometry.attributes.position.needsUpdate = true;
  physics.skidMarks.geometry.setDrawRange(0, Math.min(physics.skidCursor, 1200) * 2);
}

// --- Shared soft-circle texture for smoke particles -------------------------
// Unity ParticleSystem uses a radial-gradient circle by default.
// THREE.PointsMaterial renders hard squares without a map texture.
// Generate a 64x64 Canvas radial gradient once, reuse for all smoke systems.

let _smokeTexture = null;

function getSmokeTexture() {
  if (_smokeTexture) return _smokeTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.6)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.15)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  _smokeTexture = new THREE.CanvasTexture(canvas);
  _smokeTexture.needsUpdate = true;
  return _smokeTexture;
}

// --- G1: Tire smoke ---------------------------------------------------------

const SMOKE_COUNT = 24;
let _tireSmokeSystem = null;
const _smokeParticles = [];
// Pre-allocated vectors to avoid GC pressure in hot loop
const _tsVec1 = new THREE.Vector3();
const _tsVec2 = new THREE.Vector3();

function ensureTireSmoke() {
  if (_tireSmokeSystem) return _tireSmokeSystem;
  const positions = new Float32Array(SMOKE_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xcccccc,
    size: 0.6,
    map: getSmokeTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true
  });
  _tireSmokeSystem = new THREE.Points(geometry, material);
  _tireSmokeSystem.frustumCulled = false;
  _tireSmokeSystem.visible = false;
  world.root.add(_tireSmokeSystem);
  for (let i = 0; i < SMOKE_COUNT; i++) {
    _smokeParticles.push({ age: 999, lifetime: 1.0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 });
  }
  return _tireSmokeSystem;
}

let _smokeEmitTimer = 0;

export function updateTireSmoke(skidAmount, dt) {
  const system = ensureTireSmoke();
  const active = skidAmount > 0.3 && state.route === "game" && state.game.active;
  const positions = system.geometry.attributes.position.array;

  if (active) {
    system.visible = true;
    _smokeEmitTimer += dt;
    // Cap accumulator to prevent runaway loops
    _smokeEmitTimer = Math.min(_smokeEmitTimer, 0.15);
    const emitRate = 0.035;  // ~28/sec during heavy skid
    while (_smokeEmitTimer >= emitRate) {
      _smokeEmitTimer -= emitRate;
      // Recycle oldest particle
      let oldest = 0;
      for (let i = 1; i < SMOKE_COUNT; i++) {
        if (_smokeParticles[i].age > _smokeParticles[oldest].age) oldest = i;
      }
      const p = _smokeParticles[oldest];
      // Spawn at rear of car with lateral spread (both rear wheels)
      const side = (Math.random() > 0.5 ? 0.6 : -0.6);
      _tsVec1.set(
        side + (Math.random() - 0.5) * 0.3,
        0.15 + Math.random() * 0.1,
        -1.1
      ).applyQuaternion(world.carPivot.quaternion);
      p.x = world.carPivot.position.x + _tsVec1.x;
      p.y = world.carPivot.position.y + _tsVec1.y;
      p.z = world.carPivot.position.z + _tsVec1.z;
      // Drift upward with random horizontal spread
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vy = 0.5 + Math.random() * 0.4;
      p.vz = (Math.random() - 0.5) * 0.6;
      p.age = 0;
      p.lifetime = 0.8 + Math.random() * 0.6;
    }
  }

  let anyAlive = false;
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const p = _smokeParticles[i];
    p.age += dt;
    if (p.age < p.lifetime) {
      anyAlive = true;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.vz *= 0.96;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    } else {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -1000;
      positions[i * 3 + 2] = 0;
    }
  }

  if (anyAlive || active) {
    const intensity = THREE.MathUtils.clamp((skidAmount - 0.3) * 1.0, 0.1, 0.4);
    system.material.opacity = intensity;
    system.material.size = 0.4 + skidAmount * 0.5;
    system.geometry.attributes.position.needsUpdate = true;
  } else {
    system.material.opacity = Math.max(0, system.material.opacity - dt * 3);
    if (system.material.opacity <= 0.01) system.visible = false;
  }
}

// --- G2: Exhaust — matches Unity RCCP_Exhaust.cs ----------------------------
// Unity behavior:
//   Smoke: only emits when engine running AND speed < 20 km/h
//     emission = clamp(maxEmission * throttle, minEmission, maxEmission)  [5..20]
//     startSize = clamp(maxSize * throttle, minSize, maxSize)            [1..4]
//     startSpeed = clamp(maxSpeed * throttle, minSpeed, maxSpeed)        [0.1..1]
//   Flame: triggers when RPM in [5000..5500] AND throttle <= 0.25 AND flameTime <= 0.5
//     OR when nosInput >= 0.75
//     Flame light intensity = 3.0 * Random(0.25..1)
//     Flame color: red (normal) or blue (NOS)

const EXHAUST_SMOKE_COUNT = 24;
const EXHAUST_MIN_EMISSION = 8;
const EXHAUST_MAX_EMISSION = 22;
const EXHAUST_MIN_SIZE = 0.15;
const EXHAUST_MAX_SIZE = 0.5;
const EXHAUST_MIN_SPEED = 0.1;
const EXHAUST_MAX_SPEED = 0.6;

let _exhaustSmokeSystem = null;
let _exhaustFlameLight = null;
const _exhaustSmokeParticles = [];
let _exhaustFlameTime = 0;
// Pre-allocated vectors to avoid GC pressure in hot loop
const _exVec1 = new THREE.Vector3();
const _exVec2 = new THREE.Vector3();
const _flameVec = new THREE.Vector3();

function ensureExhaustSmoke() {
  if (_exhaustSmokeSystem) return _exhaustSmokeSystem;
  const positions = new Float32Array(EXHAUST_SMOKE_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xbbbbbb,
    size: EXHAUST_MIN_SIZE,
    map: getSmokeTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true
  });
  _exhaustSmokeSystem = new THREE.Points(geometry, material);
  _exhaustSmokeSystem.frustumCulled = false;
  _exhaustSmokeSystem.visible = false;
  world.root.add(_exhaustSmokeSystem);
  for (let i = 0; i < EXHAUST_SMOKE_COUNT; i++) {
    _exhaustSmokeParticles.push({ age: 999, lifetime: 1.0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0 });
  }
  return _exhaustSmokeSystem;
}

function ensureExhaustFlameLight() {
  if (_exhaustFlameLight) return _exhaustFlameLight;
  _exhaustFlameLight = new THREE.PointLight(0xff3300, 0, 6);
  _exhaustFlameLight.name = "exhaustFlame";
  world.root.add(_exhaustFlameLight);
  return _exhaustFlameLight;
}

let _exhaustEmitAccum = 0;
let _exhaustSide = 0; // alternates 0/1 between left and right exhaust pipe

export function updateExhaust(throttleInput, dt, speedKmh, engineRPM, maxRPM, nosActive) {
  const system = ensureExhaustSmoke();
  const flame = ensureExhaustFlameLight();
  const inGame = state.route === "game" && state.game.active;

  // --- Smoke: only below 20 km/h (Unity RCCP_Exhaust lines 216-245) ---
  const smokeActive = inGame && (speedKmh ?? 0) < 20;
  const throttleAbs = Math.abs(throttleInput);

  if (smokeActive) {
    system.visible = true;
    const emissionRate = THREE.MathUtils.clamp(
      EXHAUST_MAX_EMISSION * throttleAbs, EXHAUST_MIN_EMISSION, EXHAUST_MAX_EMISSION
    );
    const particleSpeed = THREE.MathUtils.clamp(
      EXHAUST_MAX_SPEED * throttleAbs, EXHAUST_MIN_SPEED, EXHAUST_MAX_SPEED
    );
    const particleSize = THREE.MathUtils.clamp(
      EXHAUST_MAX_SIZE * throttleAbs, EXHAUST_MIN_SIZE, EXHAUST_MAX_SIZE
    );
    system.material.size = particleSize;

    _exhaustEmitAccum += dt;
    // Cap accumulator to prevent runaway loops
    _exhaustEmitAccum = Math.min(_exhaustEmitAccum, 0.2);
    const emitInterval = 1 / emissionRate;
    while (_exhaustEmitAccum >= emitInterval) {
      _exhaustEmitAccum -= emitInterval;
      let oldest = 0;
      for (let i = 1; i < EXHAUST_SMOKE_COUNT; i++) {
        if (_exhaustSmokeParticles[i].age > _exhaustSmokeParticles[oldest].age) oldest = i;
      }
      const p = _exhaustSmokeParticles[oldest];
      // Alternate between left (-0.35) and right (+0.35) exhaust pipes
      const side = (_exhaustSide++ & 1) ? 0.35 : -0.35;
      _exVec1.set(
        side + (Math.random() - 0.5) * 0.08,
        0.18,
        -1.75
      ).applyQuaternion(world.carPivot.quaternion);
      p.x = world.carPivot.position.x + _exVec1.x;
      p.y = world.carPivot.position.y + _exVec1.y;
      p.z = world.carPivot.position.z + _exVec1.z;
      // Particle drifts upward at particleSpeed
      _exVec2.set(
        (Math.random() - 0.5) * 0.15,
        particleSpeed * 0.6,
        -particleSpeed * 0.4
      ).applyQuaternion(world.carPivot.quaternion);
      p.vx = _exVec2.x; p.vy = _exVec2.y; p.vz = _exVec2.z;
      p.age = 0;
      p.lifetime = 0.8 + Math.random() * 0.5;
    }
  }

  // Update smoke particles
  const positions = system.geometry.attributes.position.array;
  let anyAlive = false;
  for (let i = 0; i < EXHAUST_SMOKE_COUNT; i++) {
    const p = _exhaustSmokeParticles[i];
    p.age += dt;
    if (p.age < p.lifetime) {
      anyAlive = true;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.95; p.vy *= 0.95; p.vz *= 0.95;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    } else {
      positions[i * 3] = 0; positions[i * 3 + 1] = -1000; positions[i * 3 + 2] = 0;
    }
  }
  if (anyAlive || smokeActive) {
    system.material.opacity = THREE.MathUtils.clamp(0.18 + throttleAbs * 0.25, 0.12, 0.42);
    system.geometry.attributes.position.needsUpdate = true;
  } else {
    system.material.opacity = Math.max(0, system.material.opacity - dt * 3);
    if (system.material.opacity <= 0.01) system.visible = false;
  }

  // --- Flame / backfire (Unity RCCP_Exhaust lines 251-309) ---
  const rpm = engineRPM ?? 0;
  const rpmMax = maxRPM ?? 7000;
  const nosOn = nosActive ?? false;
  // Backfire: RPM in [5000..5500] AND throttle <= 0.25 AND flameTime <= 0.5
  const backfireCondition = inGame && rpm >= 5000 && rpm <= 5500 && throttleAbs <= 0.25 && _exhaustFlameTime <= 0.5;
  // NOS flame: nosInput >= 0.75
  const nosFlameCondition = inGame && nosOn;

  if (backfireCondition || nosFlameCondition) {
    _exhaustFlameTime += dt;
    _flameVec.set(0, 0.2, -1.85).applyQuaternion(world.carPivot.quaternion);
    flame.position.copy(world.carPivot.position).add(_flameVec);
    flame.color.set(nosFlameCondition ? 0x0066ff : 0xff3300);
    flame.intensity = 3.0 * (0.25 + Math.random() * 0.75);
  } else {
    _exhaustFlameTime = 0;
    flame.intensity = Math.max(0, flame.intensity - dt * 12);
  }
}
