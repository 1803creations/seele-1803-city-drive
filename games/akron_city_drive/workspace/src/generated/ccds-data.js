// Reconstructed fallback: Seele's workspace preview truncated the generated
// Unity export, so this keeps the local app loadable with the fields it uses.
export const ccdsData = {
  settings: {
    mainMenuSceneIndex: 0,
    defaultMoney: 15000,
    defaultPlayerName: "New Player",
    defaultSelectedVehicleIndex: 0,
    defaultAudioVolume: 1,
    defaultMusicVolume: 0.5,
    startEngineAtStart: true,
    showArrowIndicator: true,
    showMinimapIcons: true,
    showEngineSmoke: true,
    showHealthBar: true,
    defaultMissionGuid: "215686337aa42db44a9118191aae7166"
  },
  scenes: [
    { buildIndex: 0, name: "CCDS_MainMenu_City", label: "MainMenu City", kind: "MainMenu" },
    { buildIndex: 1, name: "CCDS_Gameplay_City_1", label: "Gameplay City 1", kind: "Gameplay" },
    { buildIndex: 2, name: "CCDS_Gameplay_City_2", label: "Gameplay City 2", kind: "Gameplay" }
  ],
  presentationScenes: {
    mainMenu: {
      spawnPoint: {
        position: { x: -2773.45, y: 100.9, z: -843.8 },
        rotation: { x: 0, y: 0.42261827, z: 0, w: 0.9063079 },
        euler: { x: 0, y: 50, z: 0 }
      },
      camera: {
        fieldOfView: 34,
        transform: {
          position: { x: -2780.6296, y: 102.02491, z: -845.52625 },
          rotation: { x: 0.069612205, y: 0.61703914, z: -0.054933295, w: 0.7819202 }
        }
      },
      directionalLight: {
        intensity: 1.25,
        color: { r: 1, g: 1, b: 1, a: 1 },
        transform: { rotation: { x: 0.51899153, y: -0.21828574, z: 0.13906334, w: 0.81465364 } }
      }
    }
  },
  mainMenuUi: {
    canvasScaler: { referenceResolution: { x: 1920, y: 1080 }, matchWidthOrHeight: 0 },
    panels: {},
    unresolvedSprites: []
  },
  gameplayUi: {
    canvasScaler: { referenceResolution: { x: 1920, y: 1080 }, matchWidthOrHeight: 0 },
    panels: {}
  },
  gameStates: ["Stopped", "Started", "Countdown", "Paused", "Completed"],
  missions: [
    { id: "free", label: "Free Drive", script: "FreeDrive", missionStartInfo: "Cruise the open city and earn cash for distance.", reward: 20, rewardPlayer: true, timeLimited: false, time: -1, startMissionInstantly: true },
    { id: "checkpoint", label: "Checkpoint", script: "Checkpoint", missionStartInfo: "Reach the checkpoints before time runs out.", reward: 1200, rewardPlayer: true, timeLimited: true, time: 90, startMissionInstantly: false },
    { id: "trailblazer", label: "Trailblazer", script: "Trailblazer", missionStartInfo: "Follow the route through the city.", reward: 1500, rewardPlayer: true, timeLimited: true, time: 120, startMissionInstantly: false },
    { id: "race", label: "Race", script: "Race", missionStartInfo: "Beat the clock across a short city course.", reward: 2000, rewardPlayer: true, timeLimited: true, time: 75, startMissionInstantly: false },
    { id: "pursuit", label: "Pursuit", script: "Pursuit", missionStartInfo: "Stay ahead of police pressure.", reward: 2500, rewardPlayer: true, timeLimited: true, time: 100, startMissionInstantly: false }
  ],
  vehicles: [
    { id: "coupe", label: "Coupe", color: "#d34b31", price: 0, stats: { engine: 118, handling: 132, speed: 124 } },
    { id: "sport", label: "Sport", color: "#2688d9", price: 28000, stats: { engine: 148, handling: 142, speed: 162 } },
    { id: "muscle", label: "Muscle", color: "#d09b30", price: 36000, stats: { engine: 170, handling: 106, speed: 152 } },
    { id: "super", label: "Super", color: "#5fd1c7", price: 72000, stats: { engine: 190, handling: 168, speed: 196 } }
  ],
  sceneMissionLayouts: {}
};
