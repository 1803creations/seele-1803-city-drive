// Gameplay HUD + header text + menu-mode stats cards.
//
// Ported from the inline HUD section of main.js. The HUD reads a handful
// of gameplay accessors via DI — only `formatCash` and
// `updateGameplayCamera` still need DI because they live in main.js.
// Selectors (currentMission/currentScene/currentVehicle/statsFor) and
// `getRacePosition` are imported directly from their modules.

import * as THREE from "three";
import {
  GAME_STATES,
  MISSIONS,
  MENU_META,
  MAIN_MENU_UI,
  MENU_ROUTES,
  FREE_DRIVE_PAYOUT_DISTANCE_METERS
} from "../core/config.js";
import { ui, gameplayHud, state, save, audioState, physics } from "../core/state.js";
import { world } from "../scene/World.js";
import { rootAssetUrl } from "../core/utils.js";
import { applyUnityGameplayLayout, syncMainMenuPanels } from "./UnityLayoutMapper.js";
import {
  pick,
  currentMission,
  currentScene,
  currentVehicle,
  statsFor
} from "../core/selectors.js";
import { getRacePosition, cleanupMissionVisuals } from "../missions/MissionRuntime.js";
import { setPoliceSiren } from "../effects/VehicleEffects.js";

// --- Injected dependencies (main.js still owns these) ---------------------

let _formatCash = (value) => `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
let _updateGameplayCamera = () => {};
let _navigate = () => {};
let _startMissionFromFreeDrive = () => {};
let _persist = () => {};

export function configureHud({
  formatCash,
  updateGameplayCamera,
  navigate,
  startMissionFromFreeDrive,
  persist
} = {}) {
  if (formatCash) _formatCash = formatCash;
  if (updateGameplayCamera) _updateGameplayCamera = updateGameplayCamera;
  if (navigate) _navigate = navigate;
  if (startMissionFromFreeDrive) _startMissionFromFreeDrive = startMissionFromFreeDrive;
  if (persist) _persist = persist;
}

function _missionProgressLabel(runtime) {
  if (!runtime) return null;
  if (runtime.type === "checkpoint") {
    return `CHECKPOINT ${Math.min(runtime.currentIndex, runtime.targets.length)}/${runtime.targets.length}`;
  }
  if (runtime.type === "trailblazer") {
    return `CONES ${Math.min(runtime.currentIndex, runtime.targets.length)}/${runtime.targets.length}`;
  }
  if (runtime.type === "race") {
    return `POSITION ${getRacePosition(runtime)}/${runtime.opponents.length + 1}`;
  }
  if (runtime.type === "pursuit") {
    return `DAMAGE ${Math.round(runtime.damage)}%`;
  }
  return null;
}

// --- Gameplay HUD lifecycle -----------------------------------------------

export function ensureGameplayHud() {
  if (gameplayHud.root?.isConnected) return gameplayHud.root;

  ui.hud.replaceChildren();
  ui.hud.classList.add("is-gameplay");
  ui.hud.innerHTML = `
    <div class="gameplay-hud unity-gameplay-hud">
      <div class="unity-gameplay-canvas">
        <div class="unity-gauge-panel">
          <div class="unity-gauge">
            <div class="unity-gauge-face">
              <div class="unity-gauge-needle" data-role="rpm-needle"></div>
              <div class="unity-gauge-center"></div>
              <div class="unity-gauge-readout">
                <strong data-role="speed-value">0</strong>
                <span class="unity-gauge-kmh">KM/H</span>
              </div>
              <div class="unity-gauge-gear" data-role="gear-display">1</div>
              <div class="unity-indicator-icon unity-indicator-l" data-role="indicator-l"></div>
              <div class="unity-indicator-icon unity-indicator-r" data-role="indicator-r"></div>
              <div class="unity-gauge-icon unity-icon-abs" data-role="icon-abs"></div>
              <div class="unity-gauge-icon unity-icon-esp" data-role="icon-esp"></div>
              <div class="unity-gauge-icon unity-icon-tcs" data-role="icon-tcs"></div>
              <div class="unity-gauge-icon unity-icon-headlights" data-role="icon-headlights"></div>
            </div>
          </div>
          <div class="unity-nos-panel">
            <div class="unity-nos-track">
              <i class="unity-nos-fill" data-role="nos-fill"></i>
            </div>
          </div>
        </div>

        <div class="unity-felony-panel">
          <div class="unity-felony-slider">
            <i data-role="felony-fill"></i>
            <span class="unity-felony-vignette"></span>
            <span class="unity-felony-text">FELONY</span>
          </div>
        </div>

        <div class="unity-minimap-panel">
          <div class="unity-minimap">
            <img data-role="minimap-image" alt="Minimap" />
            <span class="unity-minimap-player"></span>
          </div>
          <span class="unity-minimap-label" data-role="minimap-label">CITY</span>
        </div>

        <div class="unity-stats-bg"></div>

        <div class="unity-health-panel">
          <div class="unity-health-slider">
            <i data-role="health-fill"></i>
            <span class="unity-health-vignette"></span>
            <span class="unity-health-value" data-role="health-value">100%</span>
          </div>
          <div class="unity-health-caption">HEALTH</div>
        </div>

        <div class="unity-stats-buttons">
          <button type="button" class="unity-stats-btn unity-stats-btn--pause" data-role="pause-btn" aria-label="Pause"></button>
          <button type="button" class="unity-stats-btn unity-stats-btn--camera" data-role="camera-btn" aria-label="Change Camera"></button>
        </div>

        <div class="unity-wrecked-overlay" data-role="wrecked-overlay" style="display:none;position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.65);display:none;align-items:center;justify-content:center;flex-direction:column;pointer-events:auto;">
          <div style="text-align:center;color:#fff;font-family:inherit;">
            <div style="font-size:3rem;font-weight:bold;color:#ff4444;text-shadow:0 0 20px rgba(255,68,68,0.6);margin-bottom:0.5rem;">VEHICLE WRECKED</div>
            <div style="font-size:1.1rem;opacity:0.8;margin-bottom:1.5rem;">Health reached 0%. Return to the drive menu to continue.</div>
            <button type="button" data-role="wrecked-menu-btn" style="padding:0.7rem 2.5rem;font-size:1.1rem;font-weight:bold;background:#ff4444;color:#fff;border:none;border-radius:6px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;">Back to Menu</button>
          </div>
        </div>

        <div class="unity-busted-overlay" data-role="busted-overlay" style="display:none;position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;flex-direction:column;pointer-events:auto;">
          <div style="text-align:center;color:#fff;font-family:inherit;">
            <div style="font-size:3rem;font-weight:bold;color:#ff3333;text-shadow:0 0 24px rgba(255,50,50,0.7);margin-bottom:0.3rem;">BUSTED</div>
            <div data-role="busted-fine-text" style="font-size:1.3rem;margin-bottom:1.8rem;color:#ffcc00;text-shadow:0 0 8px rgba(255,204,0,0.4);"></div>
            <div style="display:flex;gap:1rem;justify-content:center;">
              <button type="button" data-role="busted-pay-btn" style="padding:0.7rem 2.5rem;font-size:1.1rem;font-weight:bold;background:#22aa44;color:#fff;border:none;border-radius:6px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;">Pay Fine</button>
              <button type="button" data-role="busted-end-btn" style="padding:0.7rem 2.5rem;font-size:1.1rem;font-weight:bold;background:#ff4444;color:#fff;border:none;border-radius:6px;cursor:pointer;text-transform:uppercase;letter-spacing:1px;">End Game</button>
            </div>
          </div>
        </div>

        <div class="unity-stats-money">
          <div class="unity-money-strip">
            <span class="unity-money-icon" aria-hidden="true"></span>
            <div class="unity-money-copy">
              <strong data-role="cash-value">$0</strong>
              <span data-role="cash-meta">LIVE</span>
            </div>
          </div>

          <div class="unity-countdown-strip">
            <span class="unity-countdown-icon" aria-hidden="true"></span>
            <div class="unity-countdown-copy">
              <span data-role="state-text">STARTED</span>
              <strong data-role="time-text">FREE DRIVE</strong>
            </div>
          </div>
        </div>

        <div class="unity-countdown-overlay" data-role="countdown-overlay" style="display:none;">
          <span data-role="countdown-number">3</span>
        </div>

        <div class="unity-points-panel" data-role="points-panel">
          <div class="unity-points-item"><span>DRIFT</span><strong data-role="drift-points">0</strong></div>
          <div class="unity-points-item"><span>STUNT</span><strong data-role="stunt-points">0</strong></div>
          <div class="unity-points-item"><span>SPEED</span><strong data-role="speed-points">0</strong></div>
        </div>

        <div class="unity-busting-panel" data-role="busting-panel">
          <div class="unity-busting-fill" data-role="busting-fill"></div>
        </div>

        <div class="unity-chase-alert" data-role="chase-alert">
          <span class="unity-chase-alert-light red"></span>
          <span class="unity-chase-alert-text">POLICE</span>
          <span class="unity-chase-alert-light blue"></span>
        </div>

        <div class="unity-informer-panel" data-role="informer-panel" style="display:none;">
          <div class="unity-informer-body">
            <div class="unity-informer-title" data-role="informer-title"></div>
            <div class="unity-informer-desc" data-role="informer-desc"></div>
            <div class="unity-informer-meta" data-role="informer-meta"></div>
            <button type="button" class="unity-informer-start" data-role="informer-start">START</button>
          </div>
        </div>

        <div class="unity-pause-overlay" data-role="pause-overlay">
          <div class="unity-pause-title">PAUSED</div>
          <div class="unity-pause-actions">
            <button type="button" data-role="pause-resume-btn">RESUME</button>
            <button type="button" data-role="pause-menu-btn">MAIN MENU</button>
          </div>
        </div>
      </div>
    </div>
  `;
  applyUnityGameplayLayout();

  gameplayHud.root = ui.hud.querySelector(".gameplay-hud");
  gameplayHud.rpmNeedle = ui.hud.querySelector('[data-role="rpm-needle"]');
  gameplayHud.speedValue = ui.hud.querySelector('[data-role="speed-value"]');
  gameplayHud.cashValue = ui.hud.querySelector('[data-role="cash-value"]');
  gameplayHud.cashMeta = ui.hud.querySelector('[data-role="cash-meta"]');
  gameplayHud.missionKicker = null;
  gameplayHud.missionTitle = null;
  gameplayHud.missionCopy = null;
  gameplayHud.missionMeta = null;
  gameplayHud.healthFill = ui.hud.querySelector('[data-role="health-fill"]');
  gameplayHud.healthValue = ui.hud.querySelector('[data-role="health-value"]');
  gameplayHud.felonyFill = ui.hud.querySelector('[data-role="felony-fill"]');
  gameplayHud.minimapImage = ui.hud.querySelector('[data-role="minimap-image"]');
  gameplayHud.minimapLabel = ui.hud.querySelector('[data-role="minimap-label"]');
  gameplayHud.stateText = ui.hud.querySelector('[data-role="state-text"]');
  gameplayHud.timeText = ui.hud.querySelector('[data-role="time-text"]');
  gameplayHud.cameraBtn = ui.hud.querySelector('[data-role="camera-btn"]');
  gameplayHud.pauseBtn = ui.hud.querySelector('[data-role="pause-btn"]');
  gameplayHud.menuBtn = null;
  gameplayHud.gearDisplay = ui.hud.querySelector('[data-role="gear-display"]');
  gameplayHud.nosFill = ui.hud.querySelector('[data-role="nos-fill"]');
  gameplayHud.minimapPlayer = ui.hud.querySelector('.unity-minimap-player');
  gameplayHud.wreckedOverlay = ui.hud.querySelector('[data-role="wrecked-overlay"]');
  gameplayHud.bustedOverlay = ui.hud.querySelector('[data-role="busted-overlay"]');
  gameplayHud.bustedFineText = ui.hud.querySelector('[data-role="busted-fine-text"]');
  gameplayHud.indicatorL = ui.hud.querySelector('[data-role="indicator-l"]');
  gameplayHud.indicatorR = ui.hud.querySelector('[data-role="indicator-r"]');
  gameplayHud.absIcon = ui.hud.querySelector('[data-role="icon-abs"]');
  gameplayHud.espIcon = ui.hud.querySelector('[data-role="icon-esp"]');
  gameplayHud.tcsIcon = ui.hud.querySelector('[data-role="icon-tcs"]');
  gameplayHud.headlightsIcon = ui.hud.querySelector('[data-role="icon-headlights"]');
  gameplayHud.countdownOverlay = ui.hud.querySelector('[data-role="countdown-overlay"]');
  gameplayHud.countdownNumber = ui.hud.querySelector('[data-role="countdown-number"]');
  gameplayHud.pointsPanel = ui.hud.querySelector('[data-role="points-panel"]');
  gameplayHud.driftPoints = ui.hud.querySelector('[data-role="drift-points"]');
  gameplayHud.stuntPoints = ui.hud.querySelector('[data-role="stunt-points"]');
  gameplayHud.speedPoints = ui.hud.querySelector('[data-role="speed-points"]');
  gameplayHud.bustingPanel = ui.hud.querySelector('[data-role="busting-panel"]');
  gameplayHud.bustingFill = ui.hud.querySelector('[data-role="busting-fill"]');
  gameplayHud.chaseAlert = ui.hud.querySelector('[data-role="chase-alert"]');
  gameplayHud.informerPanel = ui.hud.querySelector('[data-role="informer-panel"]');
  gameplayHud.informerTitle = ui.hud.querySelector('[data-role="informer-title"]');
  gameplayHud.informerDesc = ui.hud.querySelector('[data-role="informer-desc"]');
  gameplayHud.informerMeta = ui.hud.querySelector('[data-role="informer-meta"]');
  gameplayHud.informerStart = ui.hud.querySelector('[data-role="informer-start"]');
  gameplayHud.pauseOverlay = ui.hud.querySelector('[data-role="pause-overlay"]');

  gameplayHud.cameraBtn?.addEventListener("click", () => {
    state.gameCameraMode = state.gameCameraMode === "follow" ? "close" : "follow";
    _updateGameplayCamera(true);
    updateHud();
  });
  gameplayHud.pauseBtn?.addEventListener("click", () => {
    state.game.state = state.game.state === GAME_STATES.PAUSED ? GAME_STATES.STARTED : GAME_STATES.PAUSED;
    updateHud();
  });
  const wreckedMenuBtn = ui.hud.querySelector('[data-role="wrecked-menu-btn"]');
  wreckedMenuBtn?.addEventListener("click", () => _navigate("mission"));
  const bustedPayBtn = ui.hud.querySelector('[data-role="busted-pay-btn"]');
  bustedPayBtn?.addEventListener("click", () => {
    const fine = state.game.policeFineMoney || 0;
    save.playerMoney = Math.max(0, save.playerMoney - fine);
    state.game.felony = 0;
    state.game.busting = 0;
    state.game.busted = false;
    state.game.policeFineMoney = 0;
    state.game.inPursue = false;
    state.game.state = GAME_STATES.STARTED;
    _persist();
    updateHud();
  });
  const bustedEndBtn = ui.hud.querySelector('[data-role="busted-end-btn"]');
  bustedEndBtn?.addEventListener("click", () => _navigate("mission"));
  gameplayHud.informerStart?.addEventListener("click", () => {
    if (state.game.nearMission) _startMissionFromFreeDrive(state.game.nearMission);
  });
  const pauseResumeBtn = ui.hud.querySelector('[data-role="pause-resume-btn"]');
  pauseResumeBtn?.addEventListener("click", () => {
    state.game.state = GAME_STATES.STARTED;
    updateHud();
  });
  const pauseMenuBtn = ui.hud.querySelector('[data-role="pause-menu-btn"]');
  pauseMenuBtn?.addEventListener("click", () => _navigate("mission"));

  return gameplayHud.root;
}

export function clearGameplayPresentation() {
  ui.hud.classList.remove("is-gameplay");
  ui.hud.replaceChildren();
  gameplayHud.root = null;
  gameplayHud.rpmNeedle = null;
  gameplayHud.speedValue = null;
  gameplayHud.cashValue = null;
  gameplayHud.cashMeta = null;
  gameplayHud.missionKicker = null;
  gameplayHud.missionTitle = null;
  gameplayHud.missionCopy = null;
  gameplayHud.missionMeta = null;
  gameplayHud.healthFill = null;
  gameplayHud.healthValue = null;
  gameplayHud.felonyFill = null;
  gameplayHud.minimapImage = null;
  gameplayHud.minimapLabel = null;
  gameplayHud.stateText = null;
  gameplayHud.timeText = null;
  gameplayHud.cameraBtn = null;
  gameplayHud.pauseBtn = null;
  gameplayHud.menuBtn = null;
  gameplayHud.gearDisplay = null;
  gameplayHud.nosFill = null;
  gameplayHud.minimapPlayer = null;
  gameplayHud.wreckedOverlay = null;
  gameplayHud.bustedOverlay = null;
  gameplayHud.bustedFineText = null;
  gameplayHud.indicatorL = null;
  gameplayHud.indicatorR = null;
  gameplayHud.absIcon = null;
  gameplayHud.espIcon = null;
  gameplayHud.tcsIcon = null;
  gameplayHud.headlightsIcon = null;
  gameplayHud.countdownOverlay = null;
  gameplayHud.countdownNumber = null;
  gameplayHud.pointsPanel = null;
  gameplayHud.driftPoints = null;
  gameplayHud.stuntPoints = null;
  gameplayHud.speedPoints = null;
  gameplayHud.bustingPanel = null;
  gameplayHud.bustingFill = null;
  gameplayHud.chaseAlert = null;
  gameplayHud.informerPanel = null;
  gameplayHud.informerTitle = null;
  gameplayHud.informerDesc = null;
  gameplayHud.informerMeta = null;
  gameplayHud.informerStart = null;
  gameplayHud.pauseOverlay = null;

  [audioState.engineIdle, audioState.engineLow, audioState.engineMed, audioState.engineHigh,
   audioState.skid, audioState.turboSpool, audioState.nos, audioState.brakes, audioState.wind
  ].forEach((audio) => {
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0;
  });
  setPoliceSiren(false);

  // Clean up all mission visual objects (indicators, race opponents, pursuit car)
  cleanupMissionVisuals(state.game.runtime);

  if (physics.sparks) {
    physics.sparks.material.opacity = 0;
  }
  if (physics.smoke) {
    physics.smoke.material.opacity = 0;
  }
}

// --- Header + HUD update --------------------------------------------------

export function updateHeader() {
  ui.cash.textContent = _formatCash(save.playerMoney).replace(/\s+/g, "");
  ui.vehicle.textContent = currentVehicle().label;
  ui.route.textContent = state.route === "game" ? "Gameplay" : MENU_META[state.route].menuName;
  const menuTitle = state.route === "main"
    ? (MAIN_MENU_UI.topBar?.titleText || MENU_META.main.menuName.replace("Menu_", "").replace("_", " "))
    : (MENU_ROUTES.includes(state.route) ? (MENU_META[state.route]?.label || MENU_META.main.label) : MENU_META.main.label);
  ui.mainMenuMode.textContent = menuTitle.toUpperCase();
  ui.mainCash.textContent = _formatCash(save.playerMoney);
  ui.playerName.textContent = save.playerName.toUpperCase();
  if (ui.profileNameInput && document.activeElement !== ui.profileNameInput) {
    ui.profileNameInput.value = save.playerName;
  }
  ui.utilityControlsBtn?.setAttribute("data-state", "OPEN");
  ui.utilityImageFxBtn?.setAttribute("data-state", save.imageEffects ? "ON" : "OFF");
  ui.utilityShadowsBtn?.setAttribute("data-state", save.shadows ? "ON" : "OFF");
  ui.utilityImageFxBtn?.classList.toggle("is-active", save.imageEffects);
  ui.utilityShadowsBtn?.classList.toggle("is-active", save.shadows);
  syncMainMenuPanels();
}

export function updateHud() {
  if (state.route === "game") {
    ensureGameplayHud();
    const speed = Math.max(0, Math.round(state.game.speed));
    const rpm = state.game.engineRPM || 0;
    // Gauge face shows 0–10 (×1000 RPM). Needle starts at lower-left (−130°)
    // and sweeps 260° clockwise to lower-right at 10000 RPM.
    const gaugeMaxRPM = 10000;
    const rpmRotation = -130 + Math.min(260, (rpm / gaugeMaxRPM) * 260);
    const mission = currentMission();
    const isFreeDrive = mission.id === "free";
    const health = Math.max(0, Math.round(100 - state.game.damage));
    const felony = state.game.felony || 0;
    const distanceToNextPayout = Math.max(0, FREE_DRIVE_PAYOUT_DISTANCE_METERS - (state.game.freeDriveRewardDistance || 0));
    const missionTime = state.game.state === GAME_STATES.COUNTDOWN
      ? `START IN ${Math.ceil(state.game.countdownRemaining)}`
      : (isFreeDrive
        ? `NEXT PAY ${Math.ceil(distanceToNextPayout)}M`
        : (state.game.missionTimeRemaining >= 0
        ? `TIME ${Math.ceil(state.game.missionTimeRemaining)}S`
        : mission.name.toUpperCase()));
    const mapTexture = /city[_\s]?2/i.test(currentScene()?.name || "") ? "Textures/UI/CCDS_Map_City2.png" : "Textures/UI/CCDS_Map_City1.PNG";
    const sceneLabel = (currentScene()?.shortLabel || "City").replace(/\s+/g, " ").toUpperCase();
    const cashMeta = isFreeDrive
      ? `${_formatCash(state.game.freeDriveSessionMoney || 0)} THIS DRIVE`
      : (mission.rewardPlayer ? `MISSION ${_formatCash(mission.reward)}` : `SCENE ${sceneLabel}`);
    const statusLabel = state.game.state === GAME_STATES.COUNTDOWN
      ? "GET READY"
      : (isFreeDrive ? "LIVE EARNING" : _missionProgressLabel(state.game.runtime) || state.game.state.toUpperCase());

    gameplayHud.root.classList.toggle("is-free-drive", isFreeDrive);
    gameplayHud.root.classList.toggle("has-felony", felony > 0);

    // Single gauge needle — RPM-driven (matches Unity)
    if (gameplayHud.rpmNeedle) {
      gameplayHud.rpmNeedle.style.transform = `translate(-50%, -92%) rotate(${rpmRotation}deg)`;
    }
    gameplayHud.speedValue.textContent = String(speed);
    gameplayHud.cashValue.textContent = _formatCash(save.playerMoney);
    gameplayHud.cashMeta.textContent = cashMeta;
    gameplayHud.healthFill.style.setProperty('--health-clip-top', `${100 - health}%`);
    gameplayHud.healthValue.textContent = `${health}%`;
    gameplayHud.felonyFill.style.height = `${felony}%`;
    gameplayHud.minimapImage.src = rootAssetUrl(mapTexture);
    gameplayHud.minimapLabel.textContent = sceneLabel;
    gameplayHud.stateText.textContent = statusLabel;
    gameplayHud.timeText.textContent = missionTime;
    gameplayHud.pauseBtn.dataset.state = state.game.state === GAME_STATES.PAUSED ? "resume" : "pause";
    gameplayHud.cameraBtn.dataset.mode = state.gameCameraMode === "follow" ? "CAM 1" : "CAM 2";
    if (gameplayHud.pauseOverlay) {
      gameplayHud.pauseOverlay.classList.toggle("is-visible", state.game.state === GAME_STATES.PAUSED);
    }

    // Gear indicator (inside gauge)
    if (gameplayHud.gearDisplay) {
      const gear = state.game.currentGear;
      const shifting = state.game.isShifting;
      let gearText;
      if (gear == null) gearText = "N";
      else if (gear < 0) gearText = "R";
      else gearText = String(gear + 1);
      gameplayHud.gearDisplay.textContent = gearText;
      gameplayHud.gearDisplay.classList.toggle("is-shifting", !!shifting);
    }

    // NOS bar (horizontal fill — width, not height)
    if (gameplayHud.nosFill) {
      const nosPercent = ((state.game.nosRemaining ?? 1) * 100);
      gameplayHud.nosFill.style.width = `${nosPercent}%`;
      gameplayHud.nosFill.classList.toggle("is-active", !!state.game.nosActive);
    }

    // Minimap player tracking
    if (gameplayHud.minimapPlayer && physics.sceneBounds) {
      const bounds = physics.sceneBounds;
      const pos = world.carPivot.position;
      const rangeX = bounds.max.x - bounds.min.x;
      const rangeZ = bounds.max.z - bounds.min.z;
      if (rangeX > 1 && rangeZ > 1) {
        const u = THREE.MathUtils.clamp((pos.x - bounds.min.x) / rangeX, 0, 1);
        const v = THREE.MathUtils.clamp((pos.z - bounds.min.z) / rangeZ, 0, 1);
        gameplayHud.minimapPlayer.style.left = `${u * 100}%`;
        gameplayHud.minimapPlayer.style.top = `${(1 - v) * 100}%`;
      }
    }

    // Show/hide wrecked overlay when health reaches 0
    if (gameplayHud.wreckedOverlay) {
      const isWrecked = state.game.damage >= 100;
      gameplayHud.wreckedOverlay.style.display = isWrecked ? "flex" : "none";
    }

    // Show/hide busted overlay when player is busted by police
    if (gameplayHud.bustedOverlay) {
      const isBusted = !!state.game.busted;
      gameplayHud.bustedOverlay.style.display = isBusted ? "flex" : "none";
      if (isBusted && gameplayHud.bustedFineText) {
        const fine = state.game.policeFineMoney || 0;
        gameplayHud.bustedFineText.textContent = `Pay $${fine.toLocaleString()} To Be Free!`;
      }
    }

    // Countdown overlay — large centered number (Unity: fontSize 128, bold italic)
    if (gameplayHud.countdownOverlay) {
      const isCountdown = state.game.state === GAME_STATES.COUNTDOWN;
      gameplayHud.countdownOverlay.style.display = isCountdown ? "flex" : "none";
      if (isCountdown && gameplayHud.countdownNumber) {
        gameplayHud.countdownNumber.textContent = String(Math.ceil(state.game.countdownRemaining));
      }
    }

    // Busting bar (active during police chase)
    if (gameplayHud.bustingPanel) {
      gameplayHud.bustingPanel.style.display = felony > 0 ? "flex" : "none";
    }
    if (gameplayHud.bustingFill) {
      gameplayHud.bustingFill.style.width = `${state.game.busting || 0}%`;
    }

    // Police chase alert (flashing red/blue POLICE banner)
    if (gameplayHud.chaseAlert) {
      gameplayHud.chaseAlert.style.display = state.game.inPursue ? "flex" : "none";
    }

    // Points panel (drift / stunt / speed scores)
    if (gameplayHud.driftPoints) {
      gameplayHud.driftPoints.textContent = String(Math.floor(state.game.scoreDrift || 0));
    }
    if (gameplayHud.stuntPoints) {
      gameplayHud.stuntPoints.textContent = String(Math.floor(state.game.scoreStunt || 0));
    }
    if (gameplayHud.speedPoints) {
      gameplayHud.speedPoints.textContent = String(Math.floor(state.game.scoreSpeed || 0));
    }

    // Informer panel — mission start popup when near a beacon
    if (gameplayHud.informerPanel) {
      const nearId = state.game.nearMission;
      if (nearId) {
        const nearMission = pick(MISSIONS, nearId);
        gameplayHud.informerPanel.style.display = "flex";
        gameplayHud.informerTitle.textContent = nearMission.name.toUpperCase();
        gameplayHud.informerDesc.textContent = nearMission.desc;
        const metaParts = [];
        if (nearMission.rewardPlayer) metaParts.push(`REWARD: $${nearMission.reward}`);
        if (nearMission.timeLimited) metaParts.push(`TIME: ${nearMission.time}S`);
        gameplayHud.informerMeta.textContent = metaParts.join("  \u2022  ");
      } else {
        gameplayHud.informerPanel.style.display = "none";
      }
    }

    return;
  }

  clearGameplayPresentation();
  const add = (title, value) => {
    const card = document.createElement("div");
    card.className = "hud-card";
    card.innerHTML = `<span class="hud-subtext">${title}</span><strong>${value}</strong>`;
    ui.hud.appendChild(card);
  };

  if (state.route === "game") {
    const runtime = state.game.runtime;
    add("Level", state.levelType);
    add("Scene", currentScene()?.shortLabel || "Unknown");
    add("Mission", currentMission().name);
    add("State", state.game.state);
    add("Speed", `${state.game.speed.toFixed(0)} km/h`);
    add("Distance", `${world.marker.position.distanceTo(world.carPivot.position).toFixed(1)} m`);
    if (runtime?.type === "checkpoint") add("Checkpoints", `${Math.min(runtime.currentIndex, runtime.targets.length)}/${runtime.targets.length}`);
    if (runtime?.type === "trailblazer") add("Cones", `${Math.min(runtime.currentIndex, runtime.targets.length)}/${runtime.targets.length}`);
    if (runtime?.type === "race") add("Position", `${getRacePosition(runtime)}/${runtime.opponents.length + 1}`);
    if (runtime?.type === "pursuit") add("Target Damage", `${runtime.damage.toFixed(0)}%`);
    if (state.game.state === GAME_STATES.COUNTDOWN) add("Countdown", `${Math.ceil(state.game.countdownRemaining)}`);
    else if (state.game.missionTimeRemaining >= 0) add("Time Left", `${state.game.missionTimeRemaining.toFixed(1)} s`);
    else add("Controls", "WASD / Arrow Keys");
    return;
  }

  const stats = statsFor();
  add("Level", state.levelType);
  add("Scene", currentScene()?.shortLabel || "Unknown");
  add("Handling", stats.handling);
  add("Speed", stats.speed);
  add("Engine", stats.engine);
}
