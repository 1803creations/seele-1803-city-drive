import * as THREE from "three";

const _forward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const PLAYER_TOP_SPEED_KMH = 128.75;

export class RCCPCarController {
  constructor({ getCurrentDynamics = () => null, onImpact = () => {}, onTurboBlowOff = () => {} } = {}) {
    this.getCurrentDynamics = getCurrentDynamics;
    this.onImpact = onImpact;
    this.onTurboBlowOff = onTurboBlowOff;
    this.speedKmh = 0;
    this.gear = 1;
  }

  reset(gameState = {}) {
    this.speedKmh = 0;
    this.gear = 1;
    gameState.driveSpeed = 0;
    gameState.engineRPM = 900;
    gameState.isShifting = false;
    gameState.currentGear = 0;
    gameState.brakeSmoothed = 0;
  }

  step({ dt, throttleInput, steerInput, handbrakeInput, nosInput, gameState, worldCarPivot, physics, stats }) {
    const dynamics = this.getCurrentDynamics() || {};
    const tunedMaxSpeed = dynamics.maxSpeedKmh || Math.max(120, stats?.speed || 160);
    const maxSpeed = Math.min(PLAYER_TOP_SPEED_KMH, tunedMaxSpeed);
    const accel = (dynamics.engineTorque || 900) / 12;
    const wantsReverse = throttleInput < -0.05;
    const movingForward = this.speedKmh > 1;
    const brake = wantsReverse && movingForward ? Math.abs(throttleInput) * (dynamics.brakeForce || 26) : 0;
    const driveInput = wantsReverse && movingForward ? 0 : throttleInput;
    const drag = 0.9975 - Math.min(0.004, Math.abs(this.speedKmh) / 32000);
    const nosBoost = nosInput ? 1.35 : 1;

    this.speedKmh += driveInput * accel * nosBoost * dt;
    this.speedKmh -= Math.sign(this.speedKmh) * brake * dt * 10;
    if (handbrakeInput) this.speedKmh *= Math.pow(0.88, dt * 60);
    this.speedKmh *= Math.pow(drag, dt * 60);
    this.speedKmh = THREE.MathUtils.clamp(this.speedKmh, -45, maxSpeed);

    const steerLimit = Math.max(0.95, dynamics.steerAngle || 0.58);
    const steer = THREE.MathUtils.clamp(steerInput, -1, 1) * steerLimit;
    const turnFactor = THREE.MathUtils.clamp(Math.abs(this.speedKmh) / 55, 0.34, 1);
    const yawDelta = steer * turnFactor * dt * 1.45 * Math.sign(this.speedKmh || 1);

    if (worldCarPivot) {
      worldCarPivot.rotateY(yawDelta);
      gameState.heading = worldCarPivot.rotation.y;
      _forward.set(0, 0, -1).applyQuaternion(worldCarPivot.quaternion);
      worldCarPivot.position.addScaledVector(_forward, (this.speedKmh / 3.6) * dt);
      if (physics?.carBody) {
        physics.carBody.setTranslation(
          { x: worldCarPivot.position.x, y: worldCarPivot.position.y, z: worldCarPivot.position.z },
          true
        );
        physics.carBody.setRotation(worldCarPivot.quaternion, true);
        physics.carBody.setLinvel({ x: _forward.x * (this.speedKmh / 3.6), y: 0, z: _forward.z * (this.speedKmh / 3.6) }, true);
      }
    }

    const absSpeed = Math.abs(this.speedKmh);
    const targetGear = Math.max(1, Math.min(6, Math.floor(absSpeed / 32) + 1));
    gameState.isShifting = targetGear !== this.gear;
    if (gameState.isShifting) this.gear = targetGear;
    gameState.currentGear = this.speedKmh < -1 ? -1 : Math.max(0, this.gear - 1);
    gameState.gear = this.speedKmh < -1 ? "R" : this.gear;
    gameState.driveSpeed = absSpeed;
    gameState.engineRPM = 900 + (absSpeed % 32) / 32 * 5900;
    gameState.brakeSmoothed = THREE.MathUtils.lerp(gameState.brakeSmoothed || 0, brake > 0 || handbrakeInput ? 1 : 0, 0.16);
    gameState.handbrakeActive = Boolean(handbrakeInput);
    gameState.nosActive = Boolean(nosInput);

    const maxSkidAmount = THREE.MathUtils.clamp((Math.abs(steerInput) * absSpeed) / 180 + (handbrakeInput ? 0.55 : 0), 0, 1);
    return { speedKmh: absSpeed, maxSkidAmount };
  }
}
