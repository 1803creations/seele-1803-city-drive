// Traffic system: 1:1 port of Unity Realistic Traffic Controller (RTC).
//
// Implements RTC_CarController navigation + steering + throttle + brake,
// RTC_Waypoint targetSpeed with angle-based speed reduction,
// RTC_TrafficSpawner spawning (radius 300, closeRadius 150, max 20),
// vehicle lights (headlights, brake lights, indicators),
// obstacle detection via distance checks, and stuck recovery.
//
// Loads TrafficVehicles.FBX, extracts vehicle child meshes, spawns clones
// along road-walking waypoint paths that follow actual road surfaces.
// Rapier kinematic bodies + colliders enable player-NPC collision,
// forward + side raycasts keep vehicles on roads and away from walls.

import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { loadRootCandidate } from "../scene/CityLoader.js";
import { normalizeModel } from "../core/utils.js";
import { CITY_WORLD_SCALE } from "../core/config.js";
import { state, save, physics, assets } from "../core/state.js";
import { world } from "../scene/World.js";
import { GROUP_NPC, GROUPS_NPC } from "../physics/World.js";
import { RTC_LANES } from "./RtcLaneData.js";

// --- Constants from Unity RTC sources ----------------------------------------

const TRAFFIC_ASSET_PATH =
  "Realistic Traffic Controller/Models/Traffic Vehicles/TrafficVehicles.FBX";

// Unity .meta globalScale: City = 0.8, TrafficVehicles = 2.3.
// Three.js FBXLoader doesn't apply Unity's globalScale, so we
// derive the traffic scale from the city scale and the ratio.
const VEHICLE_SCALE = CITY_WORLD_SCALE * (2.3 / 0.8);
const GROUND_OFFSET = 0.02;

// RTC_TrafficSpawner.prefab
const SPAWN_RADIUS = 300;            // radius: 300
const CLOSE_RADIUS = 150;            // closeRadius: 150
const MAX_ACTIVE_VEHICLES = 20;      // maximumActiveVehicles: 20
const MIN_SPAWN_SEPARATION = 15;     // CheckTraffic: no other vehicle within 15m
const INITIAL_VELOCITY_MS = 5;       // ActivateVehicle: 5 m/s VelocityChange

// RTC_CarController defaults
const MAXIMUM_SPEED = 160;           // km/h
const STEER_DIVISOR = 35;            // steerInputRaw = angleDiff / 35
const LOOK_AHEAD = 0.125;            // lookAhead: 0.125
const BOUNDS_FRONT = 2.5;            // bounds.front: 2.5
const RAYCAST_DISTANCE_ORG = 3;      // raycastDistanceOrg: 3
const RAYCAST_DISTANCE_RATE = 20;    // raycastDistanceRate: 20
const STEER_ANGLE = 40;              // steerAngle: 40 degrees

// RTC_Waypoint defaults
const WAYPOINT_TARGET_SPEED = 80;    // targetSpeed: 80 km/h
const WAYPOINT_RADIUS = 1.5;         // radius: 1.5

// Input smoothing (RTC_CarController.Inputs: MoveTowards)
const THROTTLE_SMOOTH_RATE = 5;      // deltaTime * 5
const BRAKE_SMOOTH_RATE = 10;        // deltaTime * 10
const STEER_SMOOTH_RATE = 10;        // deltaTime * 10

// Stuck detection (RTC_CarController.Reverse coroutine)
const STUCK_SPEED_THRESHOLD = 5;     // km/h
const STUCK_TIME_BEFORE_REVERSE = 2; // seconds
const REVERSE_DURATION = 1;          // seconds

// Spawn/waypoint validation — used to detect positions inside buildings
const ROAD_CHECK_DIRS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 0.707, y: 0, z: 0.707 },
  { x: -0.707, y: 0, z: 0.707 },
  { x: 0.707, y: 0, z: -0.707 },
  { x: -0.707, y: 0, z: -0.707 }
];
const ROAD_CHECK_DISTANCE = 3;       // metres — horizontal wall proximity
const MAX_SPAWN_ATTEMPTS = 12;       // max waypoints to try before giving up

// CCDS_AI_Cop police chase constants
const POLICE_DETECTOR_RADIUS = 150;  // detectorRadius: increased for better re-acquisition
const FELONY_CHASE_THRESHOLD = 25;   // GetClosestEnemy: felony >= 25 to chase
const BUST_DISTANCE = 15;            // busting proximity: < 15m
const BUST_SPEED_THRESHOLD = 20;     // bust only if target speed <= 20 km/h
const BUSTING_MP = 20;               // bustingMP: busting rate multiplier
const CHASE_STEER_MP = 3.5;          // navigatorInput multiplier
const CHASE_SPEED_BRAKE = 30;        // km/h — above this, reduce throttle on sharp turns
const CHASE_STUCK_REVERSE_TIME = 2;  // seconds stuck before reverse
const CHASE_STUCK_FORWARD_TIME = 4;  // seconds before re-attempting forward
const MIN_POLICE_COUNT = 2;          // guarantee at least 2 police vehicles

// Pre-allocated scratch vectors — eliminates ~384 new THREE.Vector3() per frame.
// Methods are called sequentially (not re-entrant), so safe to share pool.
const _tv = [];
for (let i = 0; i < 10; i++) _tv.push(new THREE.Vector3());

// --- RTC_Waypoint equivalent -------------------------------------------------

class RTCWaypoint {
  constructor(position, targetSpeed = WAYPOINT_TARGET_SPEED) {
    this.position = position.clone();
    this.targetSpeed = targetSpeed;
    this.radius = WAYPOINT_RADIUS;
    this.nextWaypoint = null;
    this.previousWaypoint = null;
    this.distanceToNext = 0;
    this.angleToNext = 0;
    this.desiredSpeedForNext = targetSpeed;
  }

  // RTC_Waypoint.UpdateWaypoint()
  update() {
    if (!this.nextWaypoint) return;
    const toNext = new THREE.Vector3().subVectors(
      this.nextWaypoint.position, this.position
    );
    this.distanceToNext = toNext.length();
    if (this.previousWaypoint) {
      const fromPrev = new THREE.Vector3().subVectors(
        this.position, this.previousWaypoint.position
      ).normalize();
      const toNextDir = toNext.clone().normalize();
      const dot = THREE.MathUtils.clamp(fromPrev.dot(toNextDir), -1, 1);
      this.angleToNext = Math.acos(dot) * (180 / Math.PI);
    } else {
      this.angleToNext = 0;
    }
    // Unity: desiredSpeedForNextWaypoint = targetSpeed * (1 - InverseLerp(0, 180, angle))
    const angleFactor = 1 - THREE.MathUtils.clamp(this.angleToNext / 180, 0, 1);
    this.desiredSpeedForNext = this.targetSpeed * angleFactor;
  }
}

// --- RTCVehicle (1:1 port of RTC_CarController state) ------------------------

class RTCVehicle {
  constructor(mesh, waypoints, startIndex) {
    this.mesh = mesh;

    // Waypoint navigation state
    this.currentWaypoint = waypoints[startIndex] || waypoints[0];
    this.nextWaypoint = this.currentWaypoint?.nextWaypoint || null;
    this.pastWaypoint = this.currentWaypoint?.previousWaypoint || null;
    this.laneIndex = -1; // index into TrafficSystem._lanes

    // Smoothed inputs (RTC_CarController: throttleInput, brakeInput, steerInput)
    this.throttleInput = 0;
    this.brakeInput = 0;
    this.steerInput = 0;

    // Raw inputs (RTC_CarController: throttleInputRaw, brakeInputRaw, steerInputRaw)
    this.throttleInputRaw = 0;
    this.brakeInputRaw = 0;
    this.steerInputRaw = 0;

    // Speed / movement
    this.currentSpeed = INITIAL_VELOCITY_MS * 3.6; // km/h
    this.desiredSpeed = WAYPOINT_TARGET_SPEED;
    this.maximumSpeed = MAXIMUM_SPEED;
    this.direction = 1;
    this.stopNow = false;
    this.waitingAtWaypoint = 0;

    // Raycasts
    this.raycastDistance = RAYCAST_DISTANCE_ORG;
    this.raycastHitDistance = 0;

    // Stuck detection
    this.stuckTime = 0;
    this.reversingNow = false;
    this.reverseTimer = 0;
    this.insideBuildingTime = 0;  // tracks how long vehicle is inside a building
    this.wallPushX = 0;           // lateral wall avoidance push
    this.wallPushZ = 0;

    // Turn signals (RTC_CarController: willTurnLeft, willTurnRight)
    this.willTurnLeft = false;
    this.willTurnRight = false;
    this.indicatorTimer = 0;

    // Lights (emissive plane overlays)
    this.headlights = [];
    this.brakeLights = [];
    this.indicatorL = null;
    this.indicatorR = null;

    // Emissive model materials (cloned per vehicle for independent control)
    this.meshBrakes = [];       // materials named *Brakelight*
    this.meshHeadlights = [];   // materials named *Headlight*
    this.meshIndicators = [];   // materials named *Indicator*

    // Rapier kinematic physics body
    this.rigidBody = null;
    this.collider = null;
    this.colliderHandle = -1;
    this.colliderHalfY = 0;          // stored half-height for correct body positioning

    // Police chase (CCDS_AI_Cop)
    this.isPolice = false;
    this.chaseTarget = null;         // non-null = currently chasing player
    this.sirenActive = false;
    this.chaseLostTime = 0;          // seconds since player escaped detector radius

    this.active = true;
  }
}

// --- Helper: Mathf.DeltaAngle ------------------------------------------------

function deltaAngle(a, b) {
  let diff = b - a;
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  return diff;
}

// --- Helper: MoveTowards -----------------------------------------------------

function moveTowards(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

// --- TrafficSystem -----------------------------------------------------------

export class TrafficSystem {
  constructor() {
    this._templates = [];          // source meshes from FBX
    this._policeTemplate = null;   // police car template
    this._vehicles = [];           // Array<RTCVehicle>
    this._waypointPaths = [];      // Array<Array<RTCWaypoint>>
    this._lanes = [];              // Array<{ waypoints, connectsTo, startPos, endPos, endHeading }>
    this._group = new THREE.Group();
    this._group.name = "TrafficGroup";
    this._loaded = false;
    this._effectiveSpawnRadius = SPAWN_RADIUS;
    // Rapier handle registries — exposed so RCCPCarController can exclude
    // NPC bodies from wheel raycasts.
    this.npcBodyHandles = new Set();
    this.npcColliderHandles = new Set();
  }

  get loaded() {
    return this._loaded;
  }

  // --- Asset loading ---------------------------------------------------------

  async loadVehicleMeshes() {
    try {
      const source = await loadRootCandidate(TRAFFIC_ASSET_PATH);
      normalizeModel(source);

      // FBX from Unity: top-level children are vehicle groups (Object3D/Group),
      // each containing sub-meshes (body, wheels, windows, etc.).
      const topChildren = [...source.children];
      for (const child of topChildren) {
        let hasMesh = false;
        child.traverse((c) => { if (c.isMesh) hasMesh = true; });
        if (hasMesh) {
          const group = child.clone(true);
          const box = new THREE.Box3().setFromObject(group);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          group.traverse((c) => {
            if (c.isMesh) {
              c.castShadow = true;
              c.receiveShadow = true;
            }
          });

          // Wrap in a pivot so we can correct orientation without
          // altering the child hierarchy.  The FBX vehicles may face
          // along X instead of Z; detect and rotate so +Z = forward.
          const wrapper = new THREE.Group();
          wrapper.name = child.name || "trafficVehicle";
          // Offset so the pivot is at the bottom-center
          group.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));

          // If the model is longer in X than Z it faces sideways — rotate
          // 90° so the longest XZ axis aligns with +Z (forward).
          if (size.x > size.z * 1.2) {
            group.rotation.y = -Math.PI / 2;
          }

          wrapper.add(group);
          this._templates.push(wrapper);
          // eslint-disable-next-line no-console
          console.log(`[Traffic] template "${child.name}" size=(${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)}) worldLen=${(Math.max(size.x, size.z) * VEHICLE_SCALE).toFixed(2)}`);
        }
      }

      // Fallback: if no groups found, collect individual meshes
      if (this._templates.length === 0) {
        source.traverse((c) => {
          if (!c.isMesh) return;
          this._templates.push(c.clone());
        });
      }

      if (this._templates.length === 0) {
        // eslint-disable-next-line no-console
        console.warn("[Traffic] No meshes found in TrafficVehicles.FBX");
        this._loaded = true;
        assets.trafficVehiclesLoaded = true;
        return;
      }

      // Identify police car template by name/material containing "Police"
      for (const tmpl of this._templates) {
        let isPolice = false;
        const checkName = (n) => /police/i.test(n || "");
        if (checkName(tmpl.name)) { isPolice = true; }
        else {
          tmpl.traverse((c) => {
            if (checkName(c.name)) isPolice = true;
            if (c.isMesh) {
              const mats = Array.isArray(c.material) ? c.material : [c.material];
              for (const m of mats) { if (checkName(m?.name)) isPolice = true; }
            }
          });
        }
        if (isPolice) {
          this._policeTemplate = tmpl;
          break;
        }
      }

      // eslint-disable-next-line no-console
      console.log(`[Traffic] Loaded ${this._templates.length} traffic vehicle templates${this._policeTemplate ? " (police car found)" : ""}`, source);
      this._loaded = true;
      assets.trafficVehiclesLoaded = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[Traffic] Failed to load TrafficVehicles.FBX:", err);
      this._loaded = true;
      assets.trafficVehiclesLoaded = true;
    }
  }

  // --- Waypoint generation from Unity RTC lane data ---------------------------
  // Uses real lane waypoint positions extracted from CCDS_Gameplay_City_1.unity.
  // Each lane is an open path (not a closed loop). When a vehicle reaches the
  // end of a lane, it transitions to a connected lane or finds a nearby one.

  generateWaypoints(bounds, spawnCenter) {
    if (!bounds && !spawnCenter) return;

    const cx = spawnCenter ? spawnCenter.x : (bounds.min.x + bounds.max.x) / 2;
    const cz = spawnCenter ? spawnCenter.z : (bounds.min.z + bounds.max.z) / 2;
    const fallbackY = spawnCenter ? spawnCenter.y : (bounds.min.y + bounds.max.y) / 2;

    // eslint-disable-next-line no-console
    console.log(`[Traffic] generateWaypoints center=(${cx.toFixed(1)}, ${cz.toFixed(1)}) fallbackY=${fallbackY.toFixed(1)}`);

    // Build open waypoint paths from Unity RTC lane data
    this._lanes = [];
    this._waypointPaths = [];

    for (let li = 0; li < RTC_LANES.length; li++) {
      const laneData = RTC_LANES[li];
      if (!laneData.w || laneData.w.length < 2) {
        this._lanes.push(null); // placeholder to keep index alignment
        continue;
      }
      const path = this._buildOpenLanePath(laneData, fallbackY);
      if (!path || path.length < 2) {
        this._lanes.push(null);
        continue;
      }

      // Compute end heading for lane-switching direction matching
      const last = path[path.length - 1].position;
      const prev = path[path.length - 2].position;
      const endHeading = Math.atan2(last.x - prev.x, last.z - prev.z);

      this._lanes.push({
        waypoints: path,
        connectsTo: laneData.c,
        startPos: path[0].position,
        endPos: last,
        endHeading
      });
      this._waypointPaths.push(path);
    }

    // Compute effective spawn radius
    this._effectiveSpawnRadius = SPAWN_RADIUS;
    if (this._waypointPaths.length > 0) {
      let minDist = Infinity;
      for (const path of this._waypointPaths) {
        for (const wp of path) {
          const dx = wp.position.x - cx;
          const dz = wp.position.z - cz;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < minDist) minDist = d;
        }
      }
      if (minDist > SPAWN_RADIUS) {
        this._effectiveSpawnRadius = minDist + 100;
        // eslint-disable-next-line no-console
        console.warn(`[Traffic] Nearest waypoint is ${minDist.toFixed(0)}m from center, expanding spawn radius to ${this._effectiveSpawnRadius.toFixed(0)}m`);
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[Traffic] Generated ${this._waypointPaths.length} lanes (of ${RTC_LANES.length} total), ` +
      `total waypoints: ${this._waypointPaths.reduce((s, p) => s + p.length, 0)}`);
  }

  _buildOpenLanePath(laneData, fallbackY = 0) {
    const rawWps = laneData.w;
    const speeds = laneData.s;
    const candidates = [];
    const MAX_SEG = 15; // subdivide long segments for smoother steering

    for (let i = 0; i < rawWps.length; i++) {
      const ax = rawWps[i][0], ay = rawWps[i][1], az = rawWps[i][2];
      const speed = Array.isArray(speeds) ? (speeds[i] || WAYPOINT_TARGET_SPEED) : (speeds || WAYPOINT_TARGET_SPEED);

      if (i < rawWps.length - 1) {
        const bx = rawWps[i + 1][0], by = rawWps[i + 1][1], bz = rawWps[i + 1][2];
        const dist = Math.hypot(bx - ax, bz - az);
        const segs = Math.max(1, Math.ceil(dist / MAX_SEG));
        for (let s = 0; s < segs; s++) {
          const t = s / segs;
          const pos = new THREE.Vector3(
            ax + (bx - ax) * t,
            ay + (by - ay) * t,
            az + (bz - az) * t
          );
          pos.copy(this._snapToRoadSurface(pos, fallbackY));
          candidates.push(new RTCWaypoint(pos, speed));
        }
      } else {
        // Last waypoint in the lane
        const pos = new THREE.Vector3(ax, ay, az);
        pos.copy(this._snapToRoadSurface(pos, fallbackY));
        candidates.push(new RTCWaypoint(pos, speed));
      }
    }

    // Validate: skip waypoints inside buildings, skip blocked segments
    const waypoints = [];
    for (let i = 0; i < candidates.length; i++) {
      const wp = candidates[i];
      if (!this._isPositionOnRoad(wp.position)) continue;
      if (waypoints.length > 0) {
        const prev = waypoints[waypoints.length - 1];
        if (!this._isSegmentClear(prev.position, wp.position)) continue;
      }
      waypoints.push(wp);
    }

    if (waypoints.length < 2) return null;

    // Link sequentially (OPEN path — last wp has nextWaypoint = null)
    for (let i = 0; i < waypoints.length - 1; i++) {
      waypoints[i].nextWaypoint = waypoints[i + 1];
      waypoints[i + 1].previousWaypoint = waypoints[i];
    }
    for (const wp of waypoints) wp.update();

    return waypoints;
  }

  // --- Spawn vehicles (RTC_TrafficSpawner) -----------------------------------

  spawn(count, bounds) {
    if (!this._loaded || this._waypointPaths.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("[Traffic] spawn skipped: loaded=", this._loaded, "paths=", this._waypointPaths.length);
      return;
    }
    world.root.add(this._group);
    const targetCount = Math.min(count, MAX_ACTIVE_VEHICLES);
    for (let i = 0; i < targetCount; i++) this._spawnOne(i);

    // Guarantee minimum police count — replace last non-police vehicles
    if (this._policeTemplate) {
      let policeCount = this._vehicles.filter(v => v.isPolice).length;
      for (let i = this._vehicles.length - 1; i >= 0 && policeCount < MIN_POLICE_COUNT; i--) {
        const v = this._vehicles[i];
        if (v.isPolice) continue;
        // Remove old vehicle mesh, spawn police in its place
        this._destroyPhysicsBody(v);
        this._disposeLightMaterials(v);
        this._group.remove(v.mesh);

        const mesh = this._policeTemplate.clone(true);
        mesh.scale.setScalar(VEHICLE_SCALE);
        mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        mesh.rotation.set(0, 0, 0);
        const path = v.currentWaypoint
          ? this._collectPathWaypoints(v.currentWaypoint)
          : this._waypointPaths[i % this._waypointPaths.length];
        const wpIdx = 0;
        const replacement = new RTCVehicle(mesh, Array.isArray(path) ? path : [v.currentWaypoint], wpIdx);
        replacement.laneIndex = v.laneIndex;
        replacement.isPolice = true;
        this._bindLightMeshes(replacement);
        this._addLights(replacement);
        this._addSirenLights(replacement.mesh);
        replacement.mesh.position.copy(v.mesh.position);
        this._faceNextWaypoint(replacement);
        this._createPhysicsBody(replacement);
        this._group.add(mesh);
        this._vehicles[i] = replacement;
        policeCount++;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`[Traffic] Spawned ${this._vehicles.length} vehicles (${this._vehicles.filter(v => v.isPolice).length} police). Group parent:`, this._group.parent?.name);
  }

  _spawnOne(index) {
    const template = this._templates[index % this._templates.length];
    const mesh = template.clone(true);
    mesh.scale.setScalar(VEHICLE_SCALE);
    mesh.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });

    const pathIdx = index % this._waypointPaths.length;
    const path = this._waypointPaths[pathIdx];

    // Find the corresponding lane index for this path
    let laneIdx = -1;
    for (let i = 0; i < this._lanes.length; i++) {
      if (this._lanes[i] && this._lanes[i].waypoints === path) { laneIdx = i; break; }
    }

    // Start near the beginning of the lane for natural traffic flow
    let wpIdx = Math.min(Math.floor(Math.random() * 3), path.length - 1);
    let attempts = 0;
    while (attempts < MAX_SPAWN_ATTEMPTS) {
      if (this._isPositionOnRoad(path[wpIdx].position)) break;
      wpIdx = (wpIdx + 1) % path.length;
      attempts++;
    }

    // Clear any inherited X/Z rotation from FBX model so vehicles stay level
    mesh.rotation.set(0, 0, 0);

    const vehicle = new RTCVehicle(mesh, path, wpIdx);
    vehicle.laneIndex = laneIdx;
    vehicle.isPolice = (template === this._policeTemplate);
    this._bindLightMeshes(vehicle);
    this._addLights(vehicle);
    if (vehicle.isPolice) this._addSirenLights(vehicle.mesh);
    vehicle.mesh.position.copy(this._snapToRoadSurface(vehicle.currentWaypoint.position, vehicle.currentWaypoint.position.y));
    this._faceNextWaypoint(vehicle);
    this._createPhysicsBody(vehicle);

    this._group.add(mesh);
    this._vehicles.push(vehicle);
  }

  // --- Rapier kinematic physics body for NPC-player collision ----------------

  _createPhysicsBody(vehicle) {
    if (!physics.ready || !physics.world) return;
    // Compute half-extents from the scaled mesh bounding box
    const box = new THREE.Box3().setFromObject(vehicle.mesh);
    const size = box.getSize(_tv[0]);
    // Slightly shrink for forgiving collisions (0.45× full bounds)
    const hx = Math.max(0.3, size.x * 0.45);
    const hy = Math.max(0.3, size.y * 0.45);
    const hz = Math.max(0.5, size.z * 0.45);

    const p = vehicle.mesh.position;
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(p.x, p.y + hy, p.z)
      .setCanSleep(false);
    vehicle.rigidBody = physics.world.createRigidBody(bodyDesc);

    vehicle.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setCollisionGroups(GROUPS_NPC)
        .setSolverGroups(GROUPS_NPC)
        .setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS |
          RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS
        )
        .setContactForceEventThreshold(300)
        .setFriction(0.6)
        .setRestitution(0.3),
      vehicle.rigidBody
    );
    vehicle.colliderHandle = vehicle.collider.handle;
    vehicle.colliderHalfY = hy;
    this.npcBodyHandles.add(vehicle.rigidBody.handle);
    this.npcColliderHandles.add(vehicle.colliderHandle);
    physics.npcBodyHandles.add(vehicle.rigidBody.handle);
  }

  _destroyPhysicsBody(vehicle) {
    if (vehicle.collider && physics.world) {
      this.npcColliderHandles.delete(vehicle.colliderHandle);
      physics.world.removeCollider(vehicle.collider, true);
    }
    if (vehicle.rigidBody && physics.world) {
      this.npcBodyHandles.delete(vehicle.rigidBody.handle);
      physics.npcBodyHandles.delete(vehicle.rigidBody.handle);
      physics.world.removeRigidBody(vehicle.rigidBody);
    }
    vehicle.collider = null;
    vehicle.rigidBody = null;
    vehicle.colliderHandle = -1;
  }

  isNpcCollider(handle) {
    return this.npcColliderHandles.has(handle);
  }

  // --- Position validation — detect positions inside buildings ---------------
  // Two-layer check:
  //  1. Downward ray from altitude — cast from 80m above the position. On a
  //     road, the first hit is the road surface near ground level. Over a
  //     building, the first hit is the building roof well above ground.
  //     This is the most reliable single test because it directly answers
  //     "is there a building at this XZ coordinate?"
  //  2. Horizontal rays — 8 directions (cardinal + diagonal). If 3+ of 8
  //     hit static geometry within ROAD_CHECK_DISTANCE, the position is
  //     enclosed by walls. Catches edge cases the vertical ray may miss.

  _isPositionOnRoad(pos) {
    if (!physics.ready || !physics.world) return true; // no physics = assume valid

    const _filter = this._trafficRayFilter;

    // 1. Downward ray from altitude — detects building roofs
    const SKY_HEIGHT = 80;
    const downRay = new RAPIER.Ray(
      { x: pos.x, y: pos.y + SKY_HEIGHT, z: pos.z },
      { x: 0, y: -1, z: 0 }
    );
    const downHit = physics.world.castRay(
      downRay, SKY_HEIGHT + 10, true,
      undefined, undefined, undefined, undefined, _filter
    );
    if (downHit) {
      const hitY = (pos.y + SKY_HEIGHT) - downHit.timeOfImpact;
      // If the top surface is >2.5m above the expected ground → building roof
      if (hitY > pos.y + 2.5) return false;
    }

    // 2. Horizontal 8-direction check
    let wallHits = 0;
    for (const dir of ROAD_CHECK_DIRS) {
      const ray = new RAPIER.Ray(
        { x: pos.x, y: pos.y + 0.5, z: pos.z },
        dir
      );
      const hit = physics.world.castRay(
        ray, ROAD_CHECK_DISTANCE, true,
        undefined, undefined, undefined, undefined, _filter
      );
      if (hit && hit.timeOfImpact < ROAD_CHECK_DISTANCE) {
        wallHits++;
      }
    }
    // 3+ of 8 directions blocked within 3m = inside / too close to building
    return wallHits < 3;
  }

  _isSegmentClear(from, to) {
    if (!physics.ready || !physics.world) return true;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.1) return true;

    const _filter = this._trafficRayFilter;

    // Horizontal raycast from→to
    const dir = { x: dx / dist, y: 0, z: dz / dist };
    const ray = new RAPIER.Ray(
      { x: from.x, y: from.y + 0.5, z: from.z },
      dir
    );
    const hit = physics.world.castRay(
      ray, dist, true,
      undefined, undefined, undefined, undefined, _filter
    );
    if (hit && hit.timeOfImpact < dist * 0.9) return false;

    // Downward ray at midpoint — catches paths crossing through buildings
    // even when the horizontal ray doesn't hit (e.g. entering through gaps)
    const mx = (from.x + to.x) * 0.5;
    const mz = (from.z + to.z) * 0.5;
    const my = (from.y + to.y) * 0.5;
    const SKY_HEIGHT = 80;
    const downRay = new RAPIER.Ray(
      { x: mx, y: my + SKY_HEIGHT, z: mz },
      { x: 0, y: -1, z: 0 }
    );
    const downHit = physics.world.castRay(
      downRay, SKY_HEIGHT + 10, true,
      undefined, undefined, undefined, undefined, _filter
    );
    if (downHit) {
      const hitY = (my + SKY_HEIGHT) - downHit.timeOfImpact;
      if (hitY > my + 2.5) return false; // midpoint is under a building roof
    }

    return true;
  }

  // --- Bind emissive materials on FBX light meshes (Unity _EmissionColor) ----

  _bindLightMeshes(vehicle) {
    vehicle.mesh.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (let i = 0; i < mats.length; i++) {
        const name = (mats[i]?.name || "").toLowerCase();
        let bucket = null;
        if (name.includes("brakelight")) bucket = vehicle.meshBrakes;
        else if (name.includes("headlight")) bucket = vehicle.meshHeadlights;
        else if (name.includes("indicator")) bucket = vehicle.meshIndicators;
        if (!bucket) continue;
        // Clone material so per-vehicle emissive is independent
        // (template.clone(true) shares material instances)
        const cloned = mats[i].clone();
        cloned.emissive = new THREE.Color(0x000000);
        cloned.emissiveIntensity = 0;
        if (Array.isArray(child.material)) child.material[i] = cloned;
        else child.material = cloned;
        bucket.push(cloned);
      }
    });
  }

  _disposeLightMaterials(vehicle) {
    for (const mat of vehicle.meshBrakes) mat.dispose();
    for (const mat of vehicle.meshHeadlights) mat.dispose();
    for (const mat of vehicle.meshIndicators) mat.dispose();
    vehicle.meshBrakes.length = 0;
    vehicle.meshHeadlights.length = 0;
    vehicle.meshIndicators.length = 0;
  }

  _addLights(vehicle) {
    const lg = new THREE.Group();
    lg.name = "trafficLights";

    // Use small emissive meshes instead of PointLights. Real PointLights
    // change the scene's active light count when vehicles are added/removed
    // from the scene graph, forcing Three.js to recompile every shader
    // (~3 seconds per recompile on Windows/ANGLE). Emissive meshes look
    // identical for small decorative lights but have zero impact on shaders.
    const _makeLight = (color, size = 0.12) => {
      const geo = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const m = new THREE.Mesh(geo, mat);
      // Expose .intensity API matching PointLight so _updateLights works unchanged
      Object.defineProperty(m, "intensity", {
        get() { return this.material.opacity; },
        set(v) { this.material.opacity = Math.min(1, v); }
      });
      return m;
    };

    // RTC_CarController.Lights — headlights, brake lights, indicators
    const hlL = _makeLight(0xffeedd, 0.15);
    hlL.position.set(-0.4, 0.6, 1.2);
    const hlR = _makeLight(0xffeedd, 0.15);
    hlR.position.set(0.4, 0.6, 1.2);
    vehicle.headlights = [hlL, hlR];

    const blL = _makeLight(0xff0000, 0.12);
    blL.position.set(-0.35, 0.5, -1.2);
    const blR = _makeLight(0xff0000, 0.12);
    blR.position.set(0.35, 0.5, -1.2);
    vehicle.brakeLights = [blL, blR];

    vehicle.indicatorL = _makeLight(0xff8800, 0.1);
    vehicle.indicatorL.position.set(-0.5, 0.5, 1.0);
    vehicle.indicatorR = _makeLight(0xff8800, 0.1);
    vehicle.indicatorR.position.set(0.5, 0.5, 1.0);

    lg.add(hlL, hlR, blL, blR, vehicle.indicatorL, vehicle.indicatorR);
    vehicle.mesh.add(lg);
  }

  // --- Add siren light bar to a police vehicle mesh --------------------------

  _addSirenLights(mesh) {
    const sirenGroup = new THREE.Group();
    sirenGroup.name = "CCDS_Police_Siren";
    sirenGroup.position.set(0, 1.5, 0);

    const redPositions = [
      { x: 0.465, y: 0.08, z: 0 },
      { x: 0.152, y: 0.08, z: 0 },
      { x: -0.147, y: 0.08, z: 0 },
      { x: -0.458, y: 0.08, z: 0 }
    ];
    const bluePositions = [
      { x: 0.621, y: 0.08, z: 0 },
      { x: 0.308, y: 0.08, z: 0 },
      { x: -0.302, y: 0.08, z: 0 },
      { x: -0.621, y: 0.08, z: 0 }
    ];

    const _makeSiren = (color) => {
      const geo = new THREE.PlaneGeometry(0.1, 0.06);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false
      });
      const m = new THREE.Mesh(geo, mat);
      Object.defineProperty(m, "intensity", {
        get() { return this.material.opacity; },
        set(v) { this.material.opacity = Math.min(1, v); }
      });
      return m;
    };

    const redLights = [];
    const blueLights = [];

    for (const pos of redPositions) {
      const l = _makeSiren(0xff0000);
      l.position.set(pos.x, pos.y, pos.z);
      l.name = "redFlash";
      sirenGroup.add(l);
      redLights.push(l);
    }
    for (const pos of bluePositions) {
      const l = _makeSiren(new THREE.Color(0, 0.197, 1));
      l.position.set(pos.x, pos.y, pos.z);
      l.name = "blueFlash";
      sirenGroup.add(l);
      blueLights.push(l);
    }

    mesh.add(sirenGroup);
    mesh.userData.redLights = redLights;
    mesh.userData.blueLights = blueLights;
  }

  // --- Per-frame update (RTC_CarController.Update + FixedUpdate) -------------

  update(dt, playerPos) {
    if (!this._loaded || this._vehicles.length === 0) return;

    const intensity = save.trafficIntensity ?? 0.62;
    const desiredCount = Math.round(intensity * MAX_ACTIVE_VEHICLES);

    // Adjust active count (RTC_TrafficSpawner.Check)
    while (this._vehicles.length > desiredCount && this._vehicles.length > 0) {
      const removed = this._vehicles.pop();
      this._destroyPhysicsBody(removed);
      this._disposeLightMaterials(removed);
      this._group.remove(removed.mesh);
    }
    while (this._vehicles.length < desiredCount && this._vehicles.length < MAX_ACTIVE_VEHICLES) {
      this._spawnOne(this._vehicles.length);
    }

    for (const vehicle of this._vehicles) {
      if (!vehicle.active) continue;

      // RTC_TrafficSpawner: disable beyond radius
      const spawnR = this._effectiveSpawnRadius || SPAWN_RADIUS;
      const dist = playerPos ? vehicle.mesh.position.distanceTo(playerPos) : 0;
      if (dist > spawnR && playerPos) {
        // Don't recycle police during active chase — reposition closer instead
        if (vehicle.isPolice && vehicle.chaseTarget) {
          this._repositionChasingCop(vehicle, playerPos);
          continue;
        }
        this._recycleVehicle(vehicle, playerPos);
        continue;
      }

      // --- Police chase logic (CCDS_AI_Cop) ---
      let chaseHandled = false;
      if (vehicle.isPolice) {
        // Activate chase when felony >= 25 and within detector radius.
        // At high felony (>=60), all police activate regardless of distance.
        const felonyHigh = state.game.felony >= 60;
        if (state.game.felony >= FELONY_CHASE_THRESHOLD
            && (dist <= POLICE_DETECTOR_RADIUS || felonyHigh) && !vehicle.chaseTarget) {
          vehicle.chaseTarget = true;
          vehicle.sirenActive = true;
        }
        // Drop chase when felony drops below threshold (e.g. after paying fine)
        if (vehicle.chaseTarget && state.game.felony < FELONY_CHASE_THRESHOLD) {
          vehicle.chaseTarget = null;
          vehicle.sirenActive = false;
        }
        // Run chase navigation if active
        if (vehicle.chaseTarget && playerPos) {
          chaseHandled = this._updatePoliceChase(
            vehicle, dt, playerPos, state.game.speed || 0
          );
        }
      }

      if (!chaseHandled) {
        // --- Normal RTC_CarController.Navigation (Update) ---
        this._navigation(vehicle);
        // --- RTC_CarController.Steering (FixedUpdate) ---
        this._steering(vehicle);
      }

      // --- RTC_CarController.Raycasts (FixedUpdate) ---
      this._raycasts(vehicle, dt);

      // --- RTC_CarController.Throttle + Brake (FixedUpdate) ---
      // Skip for chasing cops — _updatePoliceChase already set these inputs.
      if (!chaseHandled) {
        this._throttle(vehicle);
        this._brake(vehicle);
      }

      // --- RTC_CarController.Inputs (Update) — smooth inputs ---
      this._smoothInputs(vehicle, dt);

      // --- Stuck detection (RTC_CarController.Reverse coroutine) ---
      if (!chaseHandled) this._checkStuck(vehicle, dt);

      // --- Inside-building detection: continuously check if vehicle is
      // enclosed by walls/roof and relocate quickly ---
      if (!this._isPositionOnRoad(vehicle.mesh.position)) {
        vehicle.insideBuildingTime += dt;
        if (vehicle.insideBuildingTime > 0.5) {
          // Vehicle confirmed inside building — relocate immediately
          this._relocateToValidWaypoint(vehicle, playerPos);
          vehicle.insideBuildingTime = 0;
          continue;
        }
      } else {
        vehicle.insideBuildingTime = 0;
      }

      // --- Apply kinematic movement ---
      this._applyMovement(vehicle, dt);

      // --- RTC_CarController.VehicleLights (Update) ---
      this._updateLights(vehicle, dt);

      // --- Police siren lights (RCCP_PoliceLights) ---
      if (vehicle.isPolice && vehicle.mesh.userData.redLights) {
        updatePoliceLights(vehicle.mesh, dt, vehicle.sirenActive);
      }
    }

    // --- Update policeNearby / inPursue state flags ---
    if (playerPos) {
      let nearCop = false;
      let pursuing = false;
      for (const v of this._vehicles) {
        if (!v.isPolice || !v.active) continue;
        if (v.mesh.position.distanceTo(playerPos) <= POLICE_DETECTOR_RADIUS) nearCop = true;
        if (v.chaseTarget) pursuing = true;
      }
      state.game.policeNearby = nearCop;
      state.game.inPursue = pursuing;
    }
  }

  // --- RTC_CarController.Navigation ------------------------------------------

  _navigation(vehicle) {
    const cur = vehicle.currentWaypoint;
    const next = vehicle.nextWaypoint;
    if (!cur || !next) return;

    // Waiting at waypoint
    if (vehicle.waitingAtWaypoint > 0) {
      vehicle.stopNow = true;
      return;
    }
    vehicle.stopNow = false;

    // desiredSpeed = currentWaypoint.desiredSpeedForNextWaypoint
    vehicle.desiredSpeed = cur.desiredSpeedForNext;

    // RTC_CarController line 1773: if distance > 60, desiredSpeed = maximumSpeed
    // Otherwise: desiredSpeed *= Lerp(0.75, 1.25, InverseLerp(0, 60, distance))
    const distToWp = vehicle.mesh.position.distanceTo(cur.position);
    if (distToWp > 60) {
      vehicle.desiredSpeed = vehicle.maximumSpeed;
    } else if (vehicle.desiredSpeed !== 0) {
      vehicle.desiredSpeed *= THREE.MathUtils.lerp(
        0.75, 1.25, THREE.MathUtils.clamp(distToWp / 60, 0, 1)
      );
    }

    // Check if passed next waypoint (RTC_CarController line 1750 + 1758)
    const curToNext = _tv[0].subVectors(next.position, cur.position);
    const posToNext = _tv[1].subVectors(next.position, vehicle.mesh.position);
    const distToNext = posToNext.length();

    if (curToNext.lengthSq() > 0.001) {
      const dot = curToNext.normalize().dot(posToNext.normalize());
      if (dot < 0 || distToNext < next.radius) {
        this._passWaypoint(vehicle);
      }
    } else if (distToNext < next.radius) {
      this._passWaypoint(vehicle);
    }

    // RTC_CarController line 1758: if within 10m and waypoint is behind, pass
    if (cur && vehicle.mesh.position.distanceTo(cur.position) <= 10) {
      const forward = _tv[2].set(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
      const toCur = _tv[3].subVectors(cur.position, vehicle.mesh.position);
      if (toCur.dot(forward) < 0) {
        this._passWaypoint(vehicle);
      }
    }

    // Turn signals (RTC_CarController line 1785-1817)
    if (vehicle.nextWaypoint && vehicle.pastWaypoint) {
      const inDir = _tv[4].subVectors(
        vehicle.currentWaypoint.position, vehicle.pastWaypoint.position
      ).normalize();
      const outDir = _tv[5].subVectors(
        vehicle.nextWaypoint.position, vehicle.currentWaypoint.position
      ).normalize();
      const cross = _tv[6].crossVectors(inDir, outDir);
      // RTC_CarController: AngleDir >= 0.5 → right, <= -0.5 → left
      vehicle.willTurnRight = cross.y >= 0.5;
      vehicle.willTurnLeft = cross.y <= -0.5;
    } else {
      vehicle.willTurnRight = false;
      vehicle.willTurnLeft = false;
    }

    // Turn signals off when far from waypoint (line 1812: >= 40m)
    if (cur && vehicle.mesh.position.distanceTo(cur.position) >= 40) {
      vehicle.willTurnRight = false;
      vehicle.willTurnLeft = false;
    }
  }

  // RTC_CarController.PassWaypoint
  _passWaypoint(vehicle) {
    if (vehicle.currentWaypoint && vehicle.currentWaypoint.wait > 0) {
      vehicle.waitingAtWaypoint = vehicle.currentWaypoint.wait;
    }
    vehicle.pastWaypoint = vehicle.currentWaypoint;
    vehicle.currentWaypoint = vehicle.nextWaypoint;
    if (vehicle.currentWaypoint && vehicle.currentWaypoint.nextWaypoint) {
      vehicle.nextWaypoint = vehicle.currentWaypoint.nextWaypoint;
    } else if (vehicle.currentWaypoint) {
      // Reached end of lane — try to transition to next lane
      vehicle.nextWaypoint = null;
      this._transitionToNextLane(vehicle);
    }
  }

  // When a vehicle reaches the end of its current lane, find the next lane.
  _transitionToNextLane(vehicle) {
    const currentLane = vehicle.laneIndex >= 0 ? this._lanes[vehicle.laneIndex] : null;

    // 1. Follow explicit connection from Unity RTC data
    if (currentLane && currentLane.connectsTo != null) {
      const nextLane = this._lanes[currentLane.connectsTo];
      if (nextLane && nextLane.waypoints.length >= 2) {
        vehicle.laneIndex = currentLane.connectsTo;
        vehicle.currentWaypoint = nextLane.waypoints[0];
        vehicle.nextWaypoint = nextLane.waypoints[1];
        return;
      }
    }

    // 2. Find nearest lane whose start is close and heading is compatible
    const pos = vehicle.mesh.position;
    const forward = _tv[0].set(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
    const heading = Math.atan2(forward.x, forward.z);

    let bestLane = -1;
    let bestDist = 200; // max search range

    for (let i = 0; i < this._lanes.length; i++) {
      const lane = this._lanes[i];
      if (!lane || lane.waypoints.length < 2) continue;
      if (i === vehicle.laneIndex) continue; // don't re-enter same lane

      const start = lane.startPos;
      const dx = start.x - pos.x;
      const dz = start.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= bestDist) continue;

      // Check direction compatibility: lane's start→second waypoint heading
      // should be roughly aligned with vehicle's current heading
      const wp0 = lane.waypoints[0].position;
      const wp1 = lane.waypoints[1].position;
      const laneHeading = Math.atan2(wp1.x - wp0.x, wp1.z - wp0.z);
      let angleDiff = laneHeading - heading;
      angleDiff = ((angleDiff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      if (Math.abs(angleDiff) > Math.PI * 0.6) continue; // reject > ~108° turns

      bestDist = dist;
      bestLane = i;
    }

    if (bestLane >= 0) {
      const lane = this._lanes[bestLane];
      vehicle.laneIndex = bestLane;
      vehicle.currentWaypoint = lane.waypoints[0];
      vehicle.nextWaypoint = lane.waypoints[1] || null;
    }
    // If no lane found, vehicle will have nextWaypoint=null and will stop/get stuck,
    // then get recycled by the stuck detection or recycle logic.
  }

  // --- RTC_CarController.Steering (FixedUpdate) lines 1395-1424 --------------
  // Unity code:
  //   forwardA = transform.rotation * Vector3.forward
  //   forwardB = navigator.rotation * Vector3.forward
  //   angleA = Atan2(forwardA.x, forwardA.z) * Rad2Deg
  //   angleB = Atan2(forwardB.x, forwardB.z) * Rad2Deg
  //   angleDiff = DeltaAngle(angleA, angleB)
  //   steerInputRaw = angleDiff / 35

  _steering(vehicle) {
    const cur = vehicle.currentWaypoint;
    const next = vehicle.nextWaypoint;
    if (!cur || !next) { vehicle.steerInputRaw = 0; return; }

    // Navigator looks at navigatorPoint (line 1728-1744)
    // navigatorPoint = NearestPointOnLine + lookAhead * direction
    let targetPoint;

    if (vehicle.pastWaypoint) {
      // NearestPointOnLine(pastWP.pos, pastWP.pos → currentWP.pos, vehiclePos)
      // Unity: NearestPointOnLine(currentWP.pos, direction, vehiclePos)
      // direction = currentWP.pos - pastWP.pos; origin = pastWP.pos
      const lineDir = _tv[0].subVectors(
        cur.position, vehicle.pastWaypoint.position
      );
      const lineLen = lineDir.length();
      if (lineLen > 0.001) {
        lineDir.normalize();  // lineDir is now lineDirN
        // Project vehicle position onto the line from pastWP → currentWP
        const toPos = _tv[1].subVectors(
          vehicle.mesh.position, vehicle.pastWaypoint.position
        );
        const proj = THREE.MathUtils.clamp(toPos.dot(lineDir), 0, lineLen);
        // nearest = pastWaypoint.position + lineDirN * proj
        const nearest = _tv[2].copy(vehicle.pastWaypoint.position).addScaledVector(lineDir, proj);

        // lookAhead offset: (currentSpeed + 10) * lookAhead
        const aheadDist = (vehicle.currentSpeed + 10) * LOOK_AHEAD;
        targetPoint = nearest.addScaledVector(lineDir, aheadDist);
      } else {
        targetPoint = cur.position;
      }
    } else {
      targetPoint = cur.position;
    }

    // Car forward (forwardA)
    const forwardA = _tv[3].set(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);

    // Navigator forward = direction from navigator position to targetPoint
    // Navigator is at front of car (bounds.front is already in world meters)
    const navigatorPos = _tv[4].copy(vehicle.mesh.position).addScaledVector(
      forwardA, BOUNDS_FRONT
    );
    const forwardB = _tv[5].subVectors(targetPoint, navigatorPos);
    forwardB.y = 0;
    if (forwardB.lengthSq() < 0.0001) { vehicle.steerInputRaw = 0; return; }
    forwardB.normalize();

    // Angle computation (exact Unity formula)
    const angleA = Math.atan2(forwardA.x, forwardA.z) * (180 / Math.PI);
    const angleB = Math.atan2(forwardB.x, forwardB.z) * (180 / Math.PI);
    const angleDiff = deltaAngle(angleA, angleB);

    // steerInputRaw = angleDiff / 35 (line 1413)
    if (Math.abs(angleDiff) > 0.01) {
      vehicle.steerInputRaw = THREE.MathUtils.clamp(
        angleDiff / STEER_DIVISOR, -1, 1
      );
    } else {
      vehicle.steerInputRaw = 0;
    }
  }

  // --- Obstacle detection (RTC_CarController.Raycasts) -----------------------
  // Unity: raycastDistance = Lerp(rd, rdOrg * (speed/100) * rdRate, fixedDt * 5)
  // Simplified: use distance checks against other vehicles + player

  _raycasts(vehicle, dt) {
    // RTC_CarController line 1077:
    // raycastDistance = Lerp(raycastDistance, raycastDistanceOrg * (currentSpeed / 100) * raycastDistanceRate, fixedDt * 5)
    const targetRd = Math.max(
      RAYCAST_DISTANCE_ORG,
      RAYCAST_DISTANCE_ORG * (vehicle.currentSpeed / 100) * RAYCAST_DISTANCE_RATE
    );
    vehicle.raycastDistance = THREE.MathUtils.lerp(vehicle.raycastDistance, targetRd, dt * 5);
    if (vehicle.raycastDistance < RAYCAST_DISTANCE_ORG) {
      vehicle.raycastDistance = RAYCAST_DISTANCE_ORG;
    }

    vehicle.raycastHitDistance = 0;
    const forward = _tv[0].set(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);

    // Check distance to other traffic vehicles
    for (const other of this._vehicles) {
      if (other === vehicle || !other.active) continue;
      const toOther = _tv[1].subVectors(
        other.mesh.position, vehicle.mesh.position
      );
      const dist = toOther.length();
      if (dist > vehicle.raycastDistance) continue;

      // Check if other is ahead (dot with forward > 0.3)
      if (toOther.normalize().dot(forward) > 0.3) {
        if (vehicle.raycastHitDistance === 0 || dist < vehicle.raycastHitDistance) {
          vehicle.raycastHitDistance = dist;
        }
      }
    }

    // Also check distance to player vehicle
    if (world.carPivot && state.route === "game") {
      const toPlayer = _tv[1].subVectors(
        world.carPivot.position, vehicle.mesh.position
      );
      const playerDist = toPlayer.length();
      if (playerDist < vehicle.raycastDistance && toPlayer.normalize().dot(forward) > 0.3) {
        if (vehicle.raycastHitDistance === 0 || playerDist < vehicle.raycastHitDistance) {
          vehicle.raycastHitDistance = playerDist;
        }
      }
    }

    // Wall detection via Rapier raycast fan — prevents driving through
    // buildings/walls. Casts rays in forward + ±30° directions against
    // static scene geometry. The fan catches walls during turns that a
    // single center ray would miss.
    if (physics.ready && physics.world) {
      const pos = vehicle.mesh.position;
      const rayOrigin = { x: pos.x, y: pos.y + 0.5, z: pos.z };
      const fwd = { x: forward.x, y: 0, z: forward.z };
      const fwdLen = Math.hypot(fwd.x, fwd.z);

      const _wallFilter = (collider) => {
        const parentHandle = collider.parent()?.handle;
        if (parentHandle === physics.carBody?.handle) return false;
        if (physics.npcBodyHandles.has(parentHandle)) return false;
        return true;
      };

      if (fwdLen > 0.001) {
        fwd.x /= fwdLen;
        fwd.z /= fwdLen;

        // Center + ±30° fan rays
        const fanDirs = [
          { x: fwd.x, z: fwd.z },  // center
          { x: fwd.x * 0.866 + fwd.z * 0.5, z: -fwd.x * 0.5 + fwd.z * 0.866 },   // +30° (right)
          { x: fwd.x * 0.866 - fwd.z * 0.5, z: fwd.x * 0.5 + fwd.z * 0.866 }      // -30° (left)
        ];

        let rightFanDist = Infinity;
        let leftFanDist = Infinity;
        for (let fi = 0; fi < fanDirs.length; fi++) {
          const dir = fanDirs[fi];
          const ray = new RAPIER.Ray(rayOrigin, dir);
          const hit = physics.world.castRay(
            ray, vehicle.raycastDistance, true,
            undefined, undefined, undefined, undefined, _wallFilter
          );
          if (hit) {
            const wallDist = hit.timeOfImpact;
            if (vehicle.raycastHitDistance === 0 || wallDist < vehicle.raycastHitDistance) {
              vehicle.raycastHitDistance = wallDist;
            }
            if (fi === 1) rightFanDist = wallDist; // +30° right
            if (fi === 2) leftFanDist = wallDist;  // -30° left
          }
        }
        // Fan ray steering: if one side detects a wall closer, steer away.
        // This makes vehicles actively avoid walls instead of just braking.
        if (rightFanDist < vehicle.raycastDistance * 0.7 || leftFanDist < vehicle.raycastDistance * 0.7) {
          const steerAvoid = (leftFanDist - rightFanDist) / vehicle.raycastDistance;
          vehicle.steerInputRaw += THREE.MathUtils.clamp(steerAvoid * 0.6, -0.4, 0.4);
          vehicle.steerInputRaw = THREE.MathUtils.clamp(vehicle.steerInputRaw, -1, 1);
        }
      }

      // Side raycasts — lateral wall avoidance. Detects walls to the left
      // and right of the vehicle and generates a push vector away from them.
      const SIDE_DIST = 3.5;
      vehicle.wallPushX = 0;
      vehicle.wallPushZ = 0;

      // Right side
      const right = _tv[2].set(1, 0, 0).applyQuaternion(vehicle.mesh.quaternion);
      right.y = 0;
      const rLen = right.length();
      if (rLen > 0.001) {
        right.divideScalar(rLen);
        const rRay = new RAPIER.Ray(rayOrigin, { x: right.x, y: 0, z: right.z });
        const rHit = physics.world.castRay(rRay, SIDE_DIST, true,
          undefined, undefined, undefined, undefined, _wallFilter);
        if (rHit && rHit.timeOfImpact < SIDE_DIST) {
          const push = 1 - (rHit.timeOfImpact / SIDE_DIST);
          vehicle.wallPushX -= right.x * push;
          vehicle.wallPushZ -= right.z * push;
        }
      }

      // Left side
      const left = _tv[3].set(-1, 0, 0).applyQuaternion(vehicle.mesh.quaternion);
      left.y = 0;
      const lLen = left.length();
      if (lLen > 0.001) {
        left.divideScalar(lLen);
        const lRay = new RAPIER.Ray(rayOrigin, { x: left.x, y: 0, z: left.z });
        const lHit = physics.world.castRay(lRay, SIDE_DIST, true,
          undefined, undefined, undefined, undefined, _wallFilter);
        if (lHit && lHit.timeOfImpact < SIDE_DIST) {
          const push = 1 - (lHit.timeOfImpact / SIDE_DIST);
          vehicle.wallPushX -= left.x * push;
          vehicle.wallPushZ -= left.z * push;
        }
      }
    }
  }

  // --- RTC_CarController.Throttle (FixedUpdate) lines 1323-1356 ---------------
  // Unity code:
  //   throttleInputRaw = 1 - InverseLerp(0, desiredSpeed, currentSpeed)
  //   throttleInputRaw -= abs(steerInput) / 5
  //   if speed < 15 && throttle < 0.1: throttle = 0.1
  //   if speed > desiredSpeed: throttle = 0
  //   if brakeInputRaw > 0.05: throttle = 0
  //   if raycastHitDistance != 0: throttle -= (1 - InverseLerp(0, raycastDistance, raycastHitDistance))

  _throttle(vehicle) {
    vehicle.throttleInputRaw = 0;
    if (!vehicle.currentWaypoint) return;
    if (vehicle.stopNow) return;

    // Base throttle from speed vs desired
    vehicle.throttleInputRaw = 1 - THREE.MathUtils.clamp(
      vehicle.currentSpeed / Math.max(1, vehicle.desiredSpeed), 0, 1
    );

    // Decrease throttle related to steer input
    vehicle.throttleInputRaw -= Math.abs(vehicle.steerInput) / 5;

    // Minimum throttle at low speed
    if (vehicle.currentSpeed < 15 && vehicle.throttleInputRaw < 0.1) {
      vehicle.throttleInputRaw = 0.1;
    }

    // If above desired speed, no throttle
    if (vehicle.currentSpeed > vehicle.desiredSpeed) {
      vehicle.throttleInputRaw = 0;
    }

    // If braking, no throttle
    if (vehicle.brakeInputRaw > 0.05) {
      vehicle.throttleInputRaw = 0;
    }

    // Raycast hit reduces throttle
    if (vehicle.raycastHitDistance !== 0) {
      vehicle.throttleInputRaw -= (1 - THREE.MathUtils.clamp(
        vehicle.raycastHitDistance / Math.max(1, vehicle.raycastDistance), 0, 1
      ));
    }

    vehicle.throttleInputRaw = THREE.MathUtils.clamp(vehicle.throttleInputRaw, 0, 1);
  }

  // --- RTC_CarController.Brake (FixedUpdate) lines 1361-1388 ------------------
  // Unity code:
  //   brakeInputRaw = 0
  //   if speed > desiredSpeed: brake = 1
  //   brake += abs(steerInput) / 5
  //   if speed < 15 && brake != 0: brake = 0
  //   if raycastHitDistance != 0: brake = 1 - InverseLerp(0, raycastDistance, raycastHitDistance)

  _brake(vehicle) {
    vehicle.brakeInputRaw = 0;
    if (!vehicle.currentWaypoint) { vehicle.brakeInputRaw = 1; return; }
    if (vehicle.stopNow) { vehicle.brakeInputRaw = 1; return; }

    // Brake when above desired speed
    if (vehicle.currentSpeed > vehicle.desiredSpeed) {
      vehicle.brakeInputRaw = 1;
    }

    // Increase brake related to steer input
    vehicle.brakeInputRaw += Math.abs(vehicle.steerInput) / 5;

    // No brake at low speed
    if (vehicle.currentSpeed < 15 && vehicle.brakeInputRaw !== 0) {
      vehicle.brakeInputRaw = 0;
    }

    // Raycast hit: brake proportional to proximity
    if (vehicle.raycastHitDistance !== 0) {
      vehicle.brakeInputRaw = 1 - THREE.MathUtils.clamp(
        vehicle.raycastHitDistance / Math.max(1, vehicle.raycastDistance), 0, 1
      );
    }

    vehicle.brakeInputRaw = THREE.MathUtils.clamp(vehicle.brakeInputRaw, 0, 1);
  }

  // --- RTC_CarController.Inputs — smoothing (Update) lines 1018-1030 ---------
  // Unity: MoveTowards(input, inputRaw, deltaTime * rate)

  _smoothInputs(vehicle, dt) {
    vehicle.throttleInput = moveTowards(vehicle.throttleInput, vehicle.throttleInputRaw, dt * THROTTLE_SMOOTH_RATE);
    vehicle.brakeInput = moveTowards(vehicle.brakeInput, vehicle.brakeInputRaw, dt * BRAKE_SMOOTH_RATE);
    // Exponential smoothing for steering (lerp) instead of linear moveTowards
    // to damp oscillation. Factor ~5*dt gives ~0.08 at 60fps — soft but responsive.
    vehicle.steerInput = THREE.MathUtils.lerp(
      vehicle.steerInput, vehicle.steerInputRaw,
      Math.min(1, dt * STEER_SMOOTH_RATE * 0.5)
    );

    // Clamp (line 1045-1055)
    vehicle.throttleInput = THREE.MathUtils.clamp(vehicle.throttleInput, 0, 1);
    vehicle.brakeInput = THREE.MathUtils.clamp(vehicle.brakeInput, 0, 1);
    vehicle.steerInput = THREE.MathUtils.clamp(vehicle.steerInput, -1, 1);

    // waitingAtWaypoint countdown
    if (vehicle.waitingAtWaypoint > 0) {
      vehicle.waitingAtWaypoint -= dt;
      if (vehicle.waitingAtWaypoint < 0) vehicle.waitingAtWaypoint = 0;
    }
  }

  // --- Stuck detection (RTC_CarController.Reverse coroutine) -----------------

  _checkStuck(vehicle, dt) {
    if (vehicle.reversingNow) {
      vehicle.reverseTimer += dt;
      if (vehicle.reverseTimer >= REVERSE_DURATION || vehicle.currentSpeed >= 25) {
        vehicle.reversingNow = false;
        vehicle.reverseTimer = 0;
        vehicle.stuckTime = 0;
        vehicle.direction = 1;
      }
      return;
    }

    if (vehicle.currentSpeed <= STUCK_SPEED_THRESHOLD && vehicle.throttleInput > 0.1) {
      vehicle.stuckTime += dt;
      if (vehicle.stuckTime >= STUCK_TIME_BEFORE_REVERSE) {
        vehicle.reversingNow = true;
        vehicle.reverseTimer = 0;
        vehicle.direction = -1;
      }
    } else {
      vehicle.stuckTime = 0;
    }
  }

  // --- Kinematic movement (simulates WheelCollider physics) ------------------

  _applyMovement(vehicle, dt) {
    let speedMs = vehicle.currentSpeed / 3.6;

    if (vehicle.reversingNow) {
      // RTC_CarController.Reverse: direction = -1, throttle = 1, steer = 1
      // direction is already -1 and multiplied into movement below,
      // so use positive speed here to avoid double negation.
      speedMs = 3; // reverse at ~3 m/s (direction flips it)
    } else {
      // Acceleration from throttle, deceleration from brake
      // engineTorque 200 NM on ~1350 kg → ~0.148 m/s² per NM → simplified
      const accel = vehicle.throttleInput * 6;
      const decel = vehicle.brakeInput * 12;
      const drag = 0.3;

      speedMs += accel * dt;
      speedMs -= decel * dt;
      if (speedMs > 0) speedMs -= drag * dt;
      speedMs = THREE.MathUtils.clamp(speedMs, 0, vehicle.maximumSpeed / 3.6);
    }

    vehicle.currentSpeed = Math.abs(speedMs) * 3.6;

    // Steering via bicycle model
    // steerAngle = 40°, wheelBase ≈ 2.8m
    // Reduce effective steer angle at higher speeds to prevent oscillation.
    // At low speed, full 40° is fine; at ~80 km/h, limit to ~15°.
    if (Math.abs(speedMs) > 0.1) {
      const speedFactor = THREE.MathUtils.clamp(Math.abs(speedMs) / 22, 0, 1); // 22 m/s ≈ 80 km/h
      const effectiveAngle = THREE.MathUtils.lerp(STEER_ANGLE, 15, speedFactor);
      const maxSteerRad = effectiveAngle * (Math.PI / 180);
      const steer = vehicle.steerInput * maxSteerRad;
      const wheelBase = 2.8;
      const yawRate = speedMs * Math.tan(steer) / wheelBase;
      vehicle.mesh.rotation.y -= yawRate * dt;
    }

    // Forward movement — flatten to XZ plane to prevent flying
    const forward = _tv[0].set(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion);
    forward.y = 0;

    const _moveFilter = (collider) => {
      const parentHandle = collider.parent()?.handle;
      if (parentHandle === physics.carBody?.handle) return false;
      if (physics.npcBodyHandles.has(parentHandle)) return false;
      return true;
    };

    // Position guard — prevent moving into buildings. Two checks:
    // 1. Downward ray at destination: detects building roofs overhead
    // 2. Forward sweep ray: detects walls between current and destination
    const moveX = forward.x * speedMs * vehicle.direction * dt;
    const moveZ = forward.z * speedMs * vehicle.direction * dt;
    let blocked = false;
    if (physics.ready && physics.world && Math.abs(speedMs) > 0.5) {
      const candX = vehicle.mesh.position.x + moveX;
      const candZ = vehicle.mesh.position.z + moveZ;

      // Check 1: Downward ray at destination (building roof)
      const SKY = 80;
      const checkRay = new RAPIER.Ray(
        { x: candX, y: vehicle.mesh.position.y + SKY, z: candZ },
        { x: 0, y: -1, z: 0 }
      );
      const checkHit = physics.world.castRay(
        checkRay, SKY + 10, true,
        undefined, undefined, undefined, undefined, _moveFilter
      );
      if (checkHit) {
        const hitY = (vehicle.mesh.position.y + SKY) - checkHit.timeOfImpact;
        if (hitY > vehicle.mesh.position.y + 2.5) blocked = true;
      }

      // Check 2: Forward sweep rays (wall between current and destination)
      // Use 3 rays: center + left/right offset by vehicle half-width (~1.0m)
      // to catch walls that a single center ray misses at the corners.
      if (!blocked) {
        const moveDist = Math.hypot(moveX, moveZ);
        if (moveDist > 0.01) {
          const moveDir = { x: moveX / moveDist, y: 0, z: moveZ / moveDist };
          // Perpendicular direction (rotate 90° in XZ)
          const perpX = -moveDir.z;
          const perpZ = moveDir.x;
          const HALF_WIDTH = 1.0; // vehicle half-width
          const offsets = [
            { x: 0, z: 0 },                              // center
            { x: perpX * HALF_WIDTH, z: perpZ * HALF_WIDTH },   // right
            { x: -perpX * HALF_WIDTH, z: -perpZ * HALF_WIDTH }  // left
          ];
          for (const off of offsets) {
            const sweepRay = new RAPIER.Ray(
              { x: vehicle.mesh.position.x + off.x, y: vehicle.mesh.position.y + 0.5, z: vehicle.mesh.position.z + off.z },
              moveDir
            );
            const sweepHit = physics.world.castRay(
              sweepRay, moveDist + 0.5, true,
              undefined, undefined, undefined, undefined, _moveFilter
            );
            if (sweepHit && sweepHit.timeOfImpact < moveDist + 0.3) { blocked = true; break; }
          }
        }
      }
    }

    if (!blocked) {
      vehicle.mesh.position.x += moveX;
      vehicle.mesh.position.z += moveZ;
    } else {
      // Would enter building — hard brake
      vehicle.currentSpeed = 0;
      speedMs = 0;
    }

    // Lateral wall avoidance push — prevents clipping into building walls.
    // Stronger force (12) and validated against walls before applying.
    if (vehicle.wallPushX !== 0 || vehicle.wallPushZ !== 0) {
      const WALL_PUSH_FORCE = 12;
      const pushDx = vehicle.wallPushX * WALL_PUSH_FORCE * dt;
      const pushDz = vehicle.wallPushZ * WALL_PUSH_FORCE * dt;

      // Validate push doesn't move INTO another wall
      let pushBlocked = false;
      if (physics.ready && physics.world) {
        const pushDist = Math.hypot(pushDx, pushDz);
        if (pushDist > 0.001) {
          const pushDir = { x: pushDx / pushDist, y: 0, z: pushDz / pushDist };
          const pushRay = new RAPIER.Ray(
            { x: vehicle.mesh.position.x, y: vehicle.mesh.position.y + 0.5, z: vehicle.mesh.position.z },
            pushDir
          );
          const pushHit = physics.world.castRay(
            pushRay, pushDist + 0.3, true,
            undefined, undefined, undefined, undefined, _moveFilter
          );
          if (pushHit && pushHit.timeOfImpact < pushDist + 0.2) pushBlocked = true;
        }
      }
      if (!pushBlocked) {
        vehicle.mesh.position.x += pushDx;
        vehicle.mesh.position.z += pushDz;
      }
    }

    // Ground clamping via downward raycast — finds actual ground height
    // at current XZ position. Prevents floating when the vehicle is
    // pushed laterally to a position where the ground is lower.
    let groundFound = false;
    if (physics.ready && physics.world) {
      const gRay = new RAPIER.Ray(
        { x: vehicle.mesh.position.x, y: vehicle.mesh.position.y + 5, z: vehicle.mesh.position.z },
        { x: 0, y: -1, z: 0 }
      );
      const gHit = physics.world.castRay(
        gRay, 10, true,
        undefined, undefined, undefined, undefined, _moveFilter
      );
      if (gHit) {
        const groundY = (vehicle.mesh.position.y + 5) - gHit.timeOfImpact;
        vehicle.mesh.position.y = groundY + GROUND_OFFSET;
        groundFound = true;
      }
    }
    if (!groundFound && vehicle.currentWaypoint) {
      vehicle.mesh.position.y = vehicle.currentWaypoint.position.y;
    }

    // Sync Rapier kinematic body to mesh position/rotation
    // Body center must be at mesh.y + colliderHalfY so the collider bottom
    // aligns with the ground. Without the offset, the collider is half-buried
    // underground and the player chassis passes over it.
    if (vehicle.rigidBody) {
      const p = vehicle.mesh.position;
      const bodyY = p.y + vehicle.colliderHalfY;
      vehicle.rigidBody.setNextKinematicTranslation({ x: p.x, y: bodyY, z: p.z });
      const halfY = vehicle.mesh.rotation.y * 0.5;
      vehicle.rigidBody.setNextKinematicRotation({
        x: 0, y: Math.sin(halfY), z: 0, w: Math.cos(halfY)
      });
    }
  }

  // --- CCDS_AI_Cop police chase navigation -----------------------------------

  _updatePoliceChase(vehicle, dt, playerPos, playerSpeed) {
    const dist = vehicle.mesh.position.distanceTo(playerPos);

    // CCDS_AI_Cop.CheckTargets: lose target if > detectorRadius for 3 seconds
    if (dist > POLICE_DETECTOR_RADIUS) {
      vehicle.chaseLostTime += dt;
      if (vehicle.chaseLostTime > 3) {
        vehicle.chaseTarget = null;
        vehicle.sirenActive = false;
        return false; // caller should fall back to normal waypoint nav
      }
    } else {
      vehicle.chaseLostTime = 0;
    }

    // CCDS_AI_Cop.Navigation: close + slow → stop (prepare busting)
    if (dist < BUST_DISTANCE && Math.abs(playerSpeed) <= BUST_SPEED_THRESHOLD) {
      vehicle.throttleInputRaw = 0;
      vehicle.brakeInputRaw = 1;
      // Busting: increment player busting timer
      state.game.busting = Math.min(100,
        (state.game.busting || 0) + dt * BUSTING_MP);
      return true;
    }

    // --- Steering: direct pursuit with lead prediction ---
    // CCDS_AI_Cop: navigatorInput = InverseTransformDirection(desiredVelocity).x * 3.5
    const toTarget = _tv[0].subVectors(playerPos, vehicle.mesh.position);
    toTarget.y = 0;
    if (toTarget.lengthSq() < 0.01) return true;
    toTarget.normalize();

    // Local X component = dot with vehicle's right vector
    const right = _tv[1].set(1, 0, 0).applyQuaternion(vehicle.mesh.quaternion);
    const navigatorInput = THREE.MathUtils.clamp(
      toTarget.dot(right) * CHASE_STEER_MP, -1, 1
    );

    vehicle.steerInputRaw = navigatorInput * vehicle.direction;

    // Throttle: CCDS_AI_Cop — full throttle, reducing as speed → maxSpeed
    vehicle.throttleInputRaw = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(10, 0,
        Math.abs(vehicle.currentSpeed) / vehicle.maximumSpeed),
      0, 1
    );

    // At speed > 30: reduce throttle + add brake on sharp turns
    if (vehicle.currentSpeed > CHASE_SPEED_BRAKE) {
      vehicle.throttleInputRaw -= Math.abs(navigatorInput) / 3;
      vehicle.brakeInputRaw = Math.abs(navigatorInput) / 3;
    } else {
      vehicle.brakeInputRaw = 0;
    }

    // Hard brake kills throttle
    if (vehicle.brakeInputRaw > 0.25) vehicle.throttleInputRaw = 0;
    vehicle.throttleInputRaw = THREE.MathUtils.clamp(vehicle.throttleInputRaw, 0, 1);
    vehicle.brakeInputRaw = THREE.MathUtils.clamp(vehicle.brakeInputRaw, 0, 1);

    // Override desired speed to maximum during chase
    vehicle.desiredSpeed = vehicle.maximumSpeed;

    // Stuck recovery (CCDS_AI_Cop.CheckReset)
    if (Math.abs(vehicle.currentSpeed) <= 5) {
      vehicle.stuckTime += dt;
      if (vehicle.stuckTime >= CHASE_STUCK_REVERSE_TIME) {
        vehicle.reversingNow = true;
      }
      if (vehicle.stuckTime >= CHASE_STUCK_FORWARD_TIME) {
        vehicle.reversingNow = false;
        vehicle.stuckTime = 0;
        // Cumulative stuck tracking — reposition after ~12s total stuck
        vehicle.chaseTotalStuckTime = (vehicle.chaseTotalStuckTime || 0) + CHASE_STUCK_FORWARD_TIME;
        if (vehicle.chaseTotalStuckTime >= 12) {
          this._repositionChasingCop(vehicle, playerPos);
          vehicle.chaseTotalStuckTime = 0;
          vehicle.stuckTime = 0;
          vehicle.reversingNow = false;
          return true;
        }
      }
    } else if (Math.abs(vehicle.currentSpeed) >= 25) {
      vehicle.reversingNow = false;
      vehicle.stuckTime = 0;
      vehicle.chaseTotalStuckTime = 0;
    }

    // When reversing, override inputs
    if (vehicle.reversingNow) {
      vehicle.throttleInputRaw = 0;
      vehicle.brakeInputRaw = 1;
      vehicle.direction = -1;
    } else {
      vehicle.direction = 1;
    }

    return true; // chase handled
  }

  // --- RTC_CarController.VehicleLights (Update) lines 1977-2080 --------------

  _updateLights(vehicle, dt) {
    // Headlights: isNight mode (always on for now)
    const hlIntensity = 0.8;
    for (const hl of vehicle.headlights) hl.intensity = hlIntensity;

    // Brake lights: RTC line 2034-2046
    // Night + braking: full intensity; night no brake: 0.2; day braking: full; day no brake: 0
    const braking = vehicle.brakeInput > 0.25;
    const blIntensity = braking ? 1.5 : 0.2;
    for (const bl of vehicle.brakeLights) bl.intensity = blIntensity;

    // Indicators: blink at ~1.5 Hz
    vehicle.indicatorTimer += dt;
    const blinkOn = Math.floor(vehicle.indicatorTimer * 3) % 2 === 0;
    if (vehicle.indicatorL) {
      vehicle.indicatorL.intensity = (vehicle.willTurnLeft && blinkOn) ? 1.5 : 0;
    }
    if (vehicle.indicatorR) {
      vehicle.indicatorR.intensity = (vehicle.willTurnRight && blinkOn) ? 1.5 : 0;
    }

    // --- Emissive on actual FBX model meshes (Unity _EmissionColor) ----------
    // Brake light mesh glow
    const brakeEmissive = braking ? 1.2 : 0.15;
    for (const mat of vehicle.meshBrakes) {
      mat.emissive.setHex(0xff0000);
      mat.emissiveIntensity = brakeEmissive;
    }
    // Headlight mesh glow
    for (const mat of vehicle.meshHeadlights) {
      mat.emissive.setHex(0xffeedd);
      mat.emissiveIntensity = hlIntensity;
    }
    // Indicator mesh glow
    const indOn = vehicle.willTurnLeft || vehicle.willTurnRight;
    for (const mat of vehicle.meshIndicators) {
      mat.emissive.setHex(0xff8800);
      mat.emissiveIntensity = indOn && blinkOn ? 1.0 : 0;
    }
  }

  // --- Face next waypoint (initial orientation) ------------------------------

  _faceNextWaypoint(vehicle) {
    if (!vehicle.nextWaypoint) return;
    const dir = _tv[0].subVectors(
      vehicle.nextWaypoint.position, vehicle.mesh.position
    );
    if (dir.lengthSq() > 0.001) {
      vehicle.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
  }

  // --- Relocate vehicle stuck inside a building to a valid waypoint ---------

  _relocateToValidWaypoint(vehicle, playerPos) {
    // Try waypoints along the current path first
    const allWps = vehicle.currentWaypoint ? this._collectPathWaypoints(vehicle.currentWaypoint) : [];
    for (const wp of allWps) {
      if (this._isPositionOnRoad(wp.position)) {
        // Check no other vehicle within 15m
        let tooClose = false;
        for (const other of this._vehicles) {
          if (other === vehicle || !other.active) continue;
          if (other.mesh.position.distanceTo(wp.position) < MIN_SPAWN_SEPARATION) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        vehicle.currentWaypoint = wp;
        vehicle.nextWaypoint = wp.nextWaypoint;
        vehicle.pastWaypoint = wp.previousWaypoint;
        vehicle.currentSpeed = INITIAL_VELOCITY_MS * 3.6;
        vehicle.stuckTime = 0;
        vehicle.reversingNow = false;
        vehicle.direction = 1;
        vehicle.mesh.position.copy(this._snapToRoadSurface(wp.position, wp.position.y));
        vehicle.mesh.rotation.set(0, 0, 0);
        this._faceNextWaypoint(vehicle);
        if (vehicle.rigidBody) {
          const p = vehicle.mesh.position;
          vehicle.rigidBody.setTranslation({ x: p.x, y: p.y + vehicle.colliderHalfY, z: p.z }, true);
          const halfY = vehicle.mesh.rotation.y * 0.5;
          vehicle.rigidBody.setRotation(
            { x: 0, y: Math.sin(halfY), z: 0, w: Math.cos(halfY) },
            true
          );
        }
        return;
      }
    }
    // Fallback: try random waypoints from all paths
    if (playerPos) {
      this._recycleVehicle(vehicle, playerPos);
    }
  }

  // --- Vehicle recycling (RTC_TrafficSpawner.Check) --------------------------

  _recycleVehicle(vehicle, playerPos) {
    // Find a lane whose start is within the spawn donut ring
    const spawnR = this._effectiveSpawnRadius || SPAWN_RADIUS;

    // Collect candidate lanes — start waypoint within donut ring and on road
    const candidates = [];
    for (let i = 0; i < this._lanes.length; i++) {
      const lane = this._lanes[i];
      if (!lane || lane.waypoints.length < 2) continue;
      const startWp = lane.waypoints[0];
      const d = startWp.position.distanceTo(playerPos);
      if (d < CLOSE_RADIUS || d > spawnR) continue;
      if (!this._isPositionOnRoad(startWp.position)) continue;
      candidates.push({ laneIdx: i, wp: startWp, dist: d });
    }

    // Sort by proximity to ideal spawn ring edge
    candidates.sort((a, b) => Math.abs(a.dist - CLOSE_RADIUS) - Math.abs(b.dist - CLOSE_RADIUS));

    let bestWp = null;
    let bestLaneIdx = -1;

    // Check separation from other vehicles
    for (const c of candidates) {
      let tooClose = false;
      for (const other of this._vehicles) {
        if (other === vehicle || !other.active) continue;
        if (other.mesh.position.distanceTo(c.wp.position) < MIN_SPAWN_SEPARATION) { tooClose = true; break; }
      }
      if (!tooClose) { bestWp = c.wp; bestLaneIdx = c.laneIdx; break; }
    }

    // Fallback: try random waypoints from any path
    if (!bestWp) {
      for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
        const rndPath = this._waypointPaths[Math.floor(Math.random() * this._waypointPaths.length)];
        if (!rndPath) continue;
        const wp = rndPath[Math.floor(Math.random() * rndPath.length)];
        const d = wp.position.distanceTo(playerPos);
        if (d < CLOSE_RADIUS || d > spawnR) continue;
        if (!this._isPositionOnRoad(wp.position)) continue;
        // Find its lane index
        for (let i = 0; i < this._lanes.length; i++) {
          if (this._lanes[i] && this._lanes[i].waypoints.includes(wp)) { bestLaneIdx = i; break; }
        }
        bestWp = wp;
        break;
      }
    }
    if (!bestWp) return;

    vehicle.currentWaypoint = bestWp;
    vehicle.nextWaypoint = bestWp.nextWaypoint;
    vehicle.pastWaypoint = bestWp.previousWaypoint;
    vehicle.laneIndex = bestLaneIdx;
    vehicle.currentSpeed = INITIAL_VELOCITY_MS * 3.6;
    vehicle.stuckTime = 0;
    vehicle.reversingNow = false;
    vehicle.direction = 1;
    // Reset police chase state so cop can re-engage cleanly after recycling
    if (vehicle.isPolice) {
      vehicle.chaseTarget = null;
      vehicle.sirenActive = false;
      vehicle.chaseLostTime = 0;
    }
    vehicle.mesh.position.copy(this._snapToRoadSurface(bestWp.position, bestWp.position.y));
    vehicle.mesh.rotation.set(0, 0, 0); // Reset pitch/roll before facing waypoint
    this._faceNextWaypoint(vehicle);

    // Teleport the kinematic body to the new position
    if (vehicle.rigidBody) {
      const p = vehicle.mesh.position;
      vehicle.rigidBody.setTranslation({ x: p.x, y: p.y + vehicle.colliderHalfY, z: p.z }, true);
      const halfY = vehicle.mesh.rotation.y * 0.5;
      vehicle.rigidBody.setRotation(
        { x: 0, y: Math.sin(halfY), z: 0, w: Math.cos(halfY) },
        true
      );
    }
  }

  _collectPathWaypoints(startWp) {
    const result = [];
    let wp = startWp;
    const visited = new Set();
    while (wp && !visited.has(wp)) {
      visited.add(wp);
      result.push(wp);
      wp = wp.nextWaypoint;
    }
    return result;
  }

  // --- Reposition chasing cop (CCDS_AI_Cop persistence) ----------------------
  // When a pursuing cop exceeds SPAWN_RADIUS, teleport behind the player
  // instead of recycling. Maintains chase continuity.

  _repositionChasingCop(vehicle, playerPos) {
    // Place 60-80m behind the player (opposite of heading direction)
    const heading = state.game.heading || 0;
    const behindDist = 60 + Math.random() * 20;
    const candidateX = playerPos.x - Math.sin(heading) * behindDist;
    const candidateZ = playerPos.z - Math.cos(heading) * behindDist;
    const candidatePos = _tv[0].set(candidateX, playerPos.y, candidateZ);

    // Validate — if position is inside a building, try sides instead
    let finalPos = candidatePos;
    if (!this._isPositionOnRoad(candidatePos)) {
      // Try left side
      const leftX = playerPos.x + Math.cos(heading) * behindDist * 0.7;
      const leftZ = playerPos.z - Math.sin(heading) * behindDist * 0.7;
      const leftPos = _tv[1].set(leftX, playerPos.y, leftZ);
      if (this._isPositionOnRoad(leftPos)) {
        finalPos = leftPos;
      } else {
        // Try right side
        const rightX = playerPos.x - Math.cos(heading) * behindDist * 0.7;
        const rightZ = playerPos.z + Math.sin(heading) * behindDist * 0.7;
        const rightPos = _tv[2].set(rightX, playerPos.y, rightZ);
        if (this._isPositionOnRoad(rightPos)) {
          finalPos = rightPos;
        } else {
          // Can't find valid position — just let the cop stay where it is
          return;
        }
      }
    }

    vehicle.mesh.position.copy(this._snapToRoadSurface(finalPos, finalPos.y));
    vehicle.mesh.rotation.set(0, heading + Math.PI, 0); // face toward player
    vehicle.currentSpeed = Math.max(60, state.game.speed || 0); // match player speed

    // Sync Rapier body
    if (vehicle.rigidBody) {
      const p = vehicle.mesh.position;
      vehicle.rigidBody.setTranslation(
        { x: p.x, y: p.y + vehicle.colliderHalfY, z: p.z }, true
      );
      const halfY = vehicle.mesh.rotation.y * 0.5;
      vehicle.rigidBody.setRotation(
        { x: 0, y: Math.sin(halfY), z: 0, w: Math.cos(halfY) }, true
      );
    }
  }

  // --- Intensity control -----------------------------------------------------

  setIntensity(value) {
    // Handled dynamically in update() via save.trafficIntensity
  }

  // Check if a collider handle belongs to a police vehicle (for felony on collision)
  isPoliceCollider(handle) {
    for (const v of this._vehicles) {
      if (v.isPolice && v.colliderHandle === handle) return true;
    }
    return false;
  }

  // --- Re-center waypoints on a new position (e.g. gameplay spawn) ----------
  // Called when the game starts so vehicles drive near the player, not near
  // the menu spawn which can be hundreds of units away.

  recenterWaypoints(center) {
    if (!center || !this._loaded) return;
    // Dispose existing vehicles
    for (const vehicle of this._vehicles) {
      this._destroyPhysicsBody(vehicle);
      this._group.remove(vehicle.mesh);
    }
    this._vehicles.length = 0;
    this._waypointPaths.length = 0;
    this._lanes.length = 0;

    // Regenerate paths around the new center
    this.generateWaypoints(null, center);

    // Re-spawn vehicles (spawn() handles police count guarantee)
    if (this._waypointPaths.length > 0) {
      const count = Math.round((save.trafficIntensity ?? 0.62) * MAX_ACTIVE_VEHICLES);
      this.spawn(count, null);
      // eslint-disable-next-line no-console
      console.log(`[Traffic] Recentered on (${center.x.toFixed(0)}, ${center.y.toFixed(0)}, ${center.z.toFixed(0)}), ${this._vehicles.length} vehicles, ${this._waypointPaths.length} paths`);
    }
  }

  // --- Police car for pursuit missions (CCDS_Police_Siren.prefab) ------------

  createPoliceCar() {
    const template = this._policeTemplate || this._templates[0];
    if (!template) return null;
    const car = template.clone(true);
    car.scale.setScalar(VEHICLE_SCALE);
    car.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });

    this._addSirenLights(car);
    return car;
  }

  createNPCCar(index = 0) {
    const template = this._templates[index % this._templates.length];
    if (!template) return null;
    const car = template.clone(true);
    car.scale.setScalar(VEHICLE_SCALE);
    car.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    return car;
  }

  get loaded() { return this._loaded; }

  // --- Shared Rapier query helpers -----------------------------------------

  _trafficRayFilter = (collider) => {
    const parentHandle = collider.parent()?.handle;
    if (parentHandle === physics.carBody?.handle) return false;
    if (physics.npcBodyHandles.has(parentHandle)) return false;
    return true;
  };

  _snapToRoadSurface(position, fallbackY = 0) {
    const snapped = _tv[7].copy(position);
    if (!physics.ready || !physics.world) {
      snapped.y = (Number.isFinite(snapped.y) ? snapped.y : fallbackY) + GROUND_OFFSET;
      return snapped;
    }

    const guessY = Number.isFinite(snapped.y) ? snapped.y : fallbackY;
    const startY = guessY + 120;
    const ray = new RAPIER.Ray(
      { x: snapped.x, y: startY, z: snapped.z },
      { x: 0, y: -1, z: 0 }
    );
    const hit = physics.world.castRay(
      ray, 260, true,
      undefined, undefined, undefined, undefined, this._trafficRayFilter
    );

    snapped.y = hit ? (startY - hit.timeOfImpact + GROUND_OFFSET) : (fallbackY + GROUND_OFFSET);
    return snapped;
  }

  // --- Cleanup ---------------------------------------------------------------

  dispose() {
    for (const vehicle of this._vehicles) {
      this._destroyPhysicsBody(vehicle);
      this._disposeLightMaterials(vehicle);
      this._group.remove(vehicle.mesh);
    }
    this._vehicles.length = 0;
    if (this._group.parent) this._group.parent.remove(this._group);
  }
}

// --- RCCP_PoliceLights.Update flash pattern (exported for MissionRuntime) ----
// Unity source (RCCP_PoliceLights.cs lines 37-82):
//   On mode:
//     if ((int)(Time.time) % 2 == 0 && (int)(Time.time * 20) % 3 == 0)
//       → red lights Lerp to 1
//     else
//       → red lights Lerp to 0
//       if ((int)(Time.time * 20) % 3 == 0)
//         → blue lights Lerp to 1
//       else
//         → blue lights Lerp to 0
//   Off mode: all Lerp to 0

export function updatePoliceLights(policeMesh, dt, sirenOn) {
  if (!policeMesh) return;
  const reds = policeMesh.userData.redLights;
  const blues = policeMesh.userData.blueLights;
  if (!reds || !blues) return;

  if (!sirenOn) {
    // RCCP_PoliceLights SirenMode.Off: Lerp to 0 at deltaTime * 50
    for (const l of reds) l.intensity = THREE.MathUtils.lerp(l.intensity, 0, dt * 50);
    for (const l of blues) l.intensity = THREE.MathUtils.lerp(l.intensity, 0, dt * 50);
    return;
  }

  // RCCP_PoliceLights SirenMode.On
  const t = performance.now() / 1000;
  const t2 = Math.floor(t) % 2;
  const t20 = Math.floor(t * 20) % 3;

  if (t2 === 0 && t20 === 0) {
    // Red ON
    for (const l of reds) l.intensity = THREE.MathUtils.lerp(l.intensity, 1, dt * 50);
  } else {
    // Red OFF
    for (const l of reds) l.intensity = THREE.MathUtils.lerp(l.intensity, 0, dt * 50);

    if (t20 === 0) {
      // Blue ON
      for (const l of blues) l.intensity = THREE.MathUtils.lerp(l.intensity, 1, dt * 50);
    } else {
      // Blue OFF
      for (const l of blues) l.intensity = THREE.MathUtils.lerp(l.intensity, 0, dt * 50);
    }
  }
}
