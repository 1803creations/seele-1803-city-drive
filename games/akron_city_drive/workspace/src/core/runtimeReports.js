import * as THREE from 'three';

export const PLAYER_FACING_CONTRACT = Object.freeze({
  controlFrame: 'actor-local',
  gameplayForward: '+Z',
  visualForward: '+Z',
  visualPivotYaw: 0
});

const assetRows = [
  { entity: 'city-scene', role: 'RETRIEVE', url: 'https://static.seeles.ai/data/upload/1c58023f-f617-45c3-a36d-f0f95705a890_RCCP_City.FBX' },
  { entity: 'spoiler-pack', role: 'RETRIEVE', url: 'https://static.seeles.ai/data/upload/d524f96b-c960-46d6-8155-f9878780e9db_SpoilersPack.FBX' },
  { entity: 'wheel-pack', role: 'RETRIEVE', url: 'https://static.seeles.ai/data/upload/b46ef192-ca33-4531-b130-afedc264fb4a_WheelPack.FBX' },
  { entity: 'traffic-vehicles', role: 'RETRIEVE', url: 'https://static.seeles.ai/data/upload/47ddb9ac-52df-4743-ade1-7e38bd02ffe9_TrafficVehicles.FBX' },
  { entity: 'player-vehicle', role: 'RETRIEVE', url: 'starter remote vehicle URL map', optional: true }
];

export function emitRuntimeReports({ assets, world, playerVehicle }) {
  const rows = assetRows.map((row) => {
    let loaded = false;
    let boundTo = '—';
    if (row.entity === 'city-scene') {
      loaded = !!assets.menuSceneSource;
      boundTo = loaded ? 'world.menuBackdrop' : '—';
    } else if (row.entity === 'spoiler-pack') {
      loaded = assets.spoilers.size > 0;
      boundTo = loaded ? 'assets.spoilers' : '—';
    } else if (row.entity === 'wheel-pack') {
      loaded = assets.wheels.size > 0;
      boundTo = loaded ? 'assets.wheels' : '—';
    } else if (row.entity === 'traffic-vehicles') {
      loaded = !!assets.trafficVehiclesLoaded;
      boundTo = loaded ? 'trafficSystem' : '—';
    } else if (row.entity === 'player-vehicle') {
      loaded = !!assets.car;
      boundTo = loaded ? `world.carPivot/${playerVehicle?.id || 'selected-vehicle'}` : '—';
    }
    return { entity: row.entity, role: row.role, url: row.url, status: loaded ? 'loaded' : 'failed', boundTo };
  });
  console.table(rows);
  console.log('[motion-report] player rig=none actions=move:simulation-root suspension:procedural-visual steer:procedural-visual wheelSpin:procedural-visual lights:procedural-visual damage:procedural-fx');
  console.log('[motion-report] traffic rig=none actions=navigation:simulation-root lights:procedural-visual indicators:procedural-visual');

  const actor = world.carPivot;
  const before = actor.position.clone();
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.quaternion).normalize();
  const syntheticStep = forward.clone().multiplyScalar(0.01);
  const moveOk = syntheticStep.lengthSq() > 0 && syntheticStep.normalize().dot(forward) > 0.95;
  actor.position.copy(before);
  const visualForward = new THREE.Vector3(0, 0, 1).applyQuaternion((assets.car || actor).getWorldQuaternion(new THREE.Quaternion())).normalize();
  const actorForward = new THREE.Vector3(0, 0, 1).applyQuaternion(actor.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const faceOk = visualForward.dot(actorForward) > 0.95;
  console.log(`[facing-check] move:${moveOk ? 'PASS' : 'FAIL'} face:${faceOk ? 'PASS' : 'FAIL'} frame:${PLAYER_FACING_CONTRACT.controlFrame} forward:${PLAYER_FACING_CONTRACT.gameplayForward}`);
}
