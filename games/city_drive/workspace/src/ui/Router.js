// Route rendering: main / garage / customize / mission / settings / game.
//
// Ported from the inline route-renderer section of main.js. `render()`
// is the top-level entry point called from navigate/actions/etc. It
// calls into `renderPanel()` which dispatches by `state.route` to the
// appropriate per-route builder. No DI — every dependency is a direct
// import. All action-layer calls go through core/actions.js, and all
// vehicle-visual calls go through vehicle/VehicleOrchestration.js.

import { VEHICLES, MENU_META, MAIN_MENU_UI, MISSIONS, MISSION_LABELS } from "../core/config.js";
import { SPOILERS, WHEELS, DECALS, DECAL_LOCATIONS, PAINT_COLORS, NEONS, NEON_PROJECTOR, UPGRADE_TIERS, UPGRADE_PRICE_PER_TIER, UPGRADE_STAT_BONUS_PER_TIER, upgradeNextPrice } from "../vehicle/VehicleConfig.js";
import { ui, state, save, assets } from "../core/state.js";
import { rootAssetUrl } from "../core/utils.js";
import { world, controls, camera } from "../scene/World.js";
import {
  currentVehicle,
  currentMission,
  currentScene,
  driveSceneOptions,
  isOwnedVehicle,
  currentSetup,
  savedSetup,
  statsFor
} from "../core/selectors.js";
import {
  syncViewportSize,
  applyUnityMenuLayout,
  applyUnityGameplayLayout,
  syncMainMenuPanels
} from "./UnityLayoutMapper.js";
import {
  ensureGameplayHud,
  clearGameplayPresentation,
  updateHeader,
  updateHud
} from "./HUD.js";
import { setPresentationMode } from "../scene/MenuPresentation.js";
import { focusGameplayViewport } from "../input/Keyboard.js";
import { updateMarker } from "../core/gameLoop.js";
import { applyVisuals } from "../vehicle/VehicleOrchestration.js";
import {
  persist,
  navigate,
  setVehicle,
  selectVehicleAndReturnToMain,
  buyVehicle,
  applyPurchase,
  restoreDraft,
  toggleSetting
} from "../core/actions.js";
import {
  setSceneText,
  menuOverlayButton,
  createStatMeter,
  clearMenuPageLayer,
  renderUnityPanelFlat
} from "./domHelpers.js";


function renderMain() {
  setSceneText("Menu_Main", currentVehicle().label, `Selected scene: ${currentScene()?.label || "Unknown"}.`);
  clearMenuPageLayer();
  ui.panel.replaceChildren();
  clearGameplayPresentation();
}

function renderGarage() {
  const vehicle = currentVehicle();
  const owned = isOwnedVehicle(vehicle.id);
  setSceneText("Menu_SelectVehicle", vehicle.label, owned ? "Unity vehicle selection flow." : `Purchase required: $${vehicle.price}`);
  clearMenuPageLayer();
  ui.panel.replaceChildren();

  const prevIndex = (VEHICLES.findIndex((item) => item.id === state.vehicleId) - 1 + VEHICLES.length) % VEHICLES.length;
  const nextIndex = (VEHICLES.findIndex((item) => item.id === state.vehicleId) + 1) % VEHICLES.length;

  // Unity-aligned proof-of-concept: baked Menu_SelectVehicle tree.
  // Button_Purchase and Button_Select sit at the same rect in Unity —
  // one is shown at a time via runtime CanvasGroup toggling. Here we
  // only wire the one matching the current ownership state and drop the
  // other via a dead-interaction (it still renders but is transparent
  // enough that overlap isn't an issue for this proof-of-concept).
  const selectPanel = MAIN_MENU_UI.panels?.selectVehicle;
  if (selectPanel) {
    const root = document.createElement("div");
    root.className = "menu-page menu-page-vehicles unity-panel-root";
    root.style.position = "absolute";
    root.style.inset = "0";
    const interactionMap = {
      Button_Previous: () => void setVehicle(VEHICLES[prevIndex].id),
      Button_Next: () => void setVehicle(VEHICLES[nextIndex].id)
    };
    if (owned) {
      interactionMap.Button_Select = () => void selectVehicleAndReturnToMain(vehicle.id);
    } else {
      interactionMap.Button_Purchase = () => void buyVehicle(vehicle.id);
    }
    // Button_Previous/Next use an RCCP sprite-atlas entry that we can't
    // slice yet — render a glyph fallback so the arrows are functional
    // and visible. Sprite-atlas slicing is a deferred Phase 1d task.
    const selectResolver = (n) => {
      if (n.name === "Button_Previous") {
        return { onClick: interactionMap.Button_Previous, label: "\u2039" };
      }
      if (n.name === "Button_Next") {
        return { onClick: interactionMap.Button_Next, label: "\u203a" };
      }
      if (n.name === "Button_Select" && !owned) return { hidden: true };
      if (n.name === "Button_Purchase" && owned) return { hidden: true };
      if (interactionMap[n.name]) {
        return { onClick: interactionMap[n.name] };
      }
      return null;
    };
    renderUnityPanelFlat(selectPanel, root, selectResolver);

    // Baked Unity Stats_Vehicle meter row (Engine/Handling/Speed) sits at
    // the bottom of the screen. Its Fill sprite is baked at max width in
    // the prefab — we drive it per-stat via a rectOverride widthScale.
    // Walk order is Button[Engine] → its children → Button (1)[Handling]
    // → children → Button (2)[Speed] → children, so a sequential closure
    // tracking the current stat label is enough.
    const statsPanel = MAIN_MENU_UI.panels?.statsVehicle;
    if (statsPanel) {
      const stats = statsFor(vehicle.id);
      const statByLabel = { Engine: stats.engine, Handling: stats.handling, Speed: stats.speed };
      let currentStatValue = 0;
      const statsResolver = (n) => {
        if (/^Button(\s*\(\d+\))?$/.test(n.name) && n.children) {
          const label = findTextInSubtree(n);
          if (statByLabel[label] !== undefined) {
            currentStatValue = statByLabel[label];
          }
          return null;
        }
        if (n.name === "Fill") {
          const scale = Math.min(1, Math.max(0, currentStatValue / 200));
          return { rectOverride: { widthScale: scale } };
        }
        if (n.name === "Fill_Upgraded") {
          // No upgrade tier in this port yet — hide the orange fill.
          return { hidden: true };
        }
        if (n.name === "Back") {
          return { hidden: true };
        }
        return null;
      };
      renderUnityPanelFlat(statsPanel, root, statsResolver);
      const vehicleReadout = document.createElement("div");
      vehicleReadout.className = "unity-selected-vehicle-readout";
      vehicleReadout.innerHTML = `<strong>${vehicle.label}</strong><span>${owned ? "Owned" : `Purchase $${vehicle.price}`}</span>`;
      root.appendChild(vehicleReadout);
      ui.menuPageLayer.appendChild(root);
      return;
    }

    // Legacy fallback if statsVehicle panel data is missing — use the
    // hand-rolled meter row so we don't silently drop stat display.
    const fallbackMeterRow = document.createElement("div");
    fallbackMeterRow.className = "unity-meter-row";
    const fallbackStats = statsFor(vehicle.id);
    fallbackMeterRow.append(
      createStatMeter("ENGINE", fallbackStats.engine),
      createStatMeter("HANDLING", fallbackStats.handling),
      createStatMeter("SPEED", fallbackStats.speed)
    );
    root.appendChild(fallbackMeterRow);

    ui.menuPageLayer.appendChild(root);
    return;
  }

  const root = document.createElement("div");
  root.className = "menu-page menu-page-vehicles";
  root.append(
    menuOverlayButton("<", "unity-arrow unity-arrow-left", () => void setVehicle(VEHICLES[prevIndex].id)),
    menuOverlayButton(">", "unity-arrow unity-arrow-right", () => void setVehicle(VEHICLES[nextIndex].id))
  );

  const vehicleReadout = document.createElement("div");
  vehicleReadout.className = "unity-selected-vehicle-readout";
  vehicleReadout.innerHTML = `<strong>${vehicle.label}</strong><span>${owned ? "Owned" : `Purchase $${vehicle.price}`}</span>`;
  root.appendChild(vehicleReadout);

  const actionRow = document.createElement("div");
  actionRow.className = "unity-center-action";
  actionRow.appendChild(
    menuOverlayButton(
      owned ? "SELECT" : "PURCHASE",
      `unity-big-action${owned ? " is-green" : ""}`,
      () => void (owned ? selectVehicleAndReturnToMain(vehicle.id) : buyVehicle(vehicle.id)),
      owned
    )
  );
  root.appendChild(actionRow);

  const meterRow = document.createElement("div");
  meterRow.className = "unity-meter-row";
  const stats = statsFor(vehicle.id);
  meterRow.append(
    createStatMeter("ENGINE", stats.engine),
    createStatMeter("HANDLING", stats.handling),
    createStatMeter("SPEED", stats.speed)
  );
  root.appendChild(meterRow);
  ui.menuPageLayer.appendChild(root);
}

function renderCustomize() {
  setSceneText("Menu_Customization", currentVehicle().label, "Unity customization screen with bottom category rail and cart.");
  clearMenuPageLayer();
  ui.panel.replaceChildren();

  const setup = currentSetup();

  // Map TMP button labels → internal tab ids used by state.customizeTab.
  const TAB_LABEL_TO_ID = {
    "Paint": "paint",
    "Wheels": "wheel",
    "Mechanic": "mechanic",
    "Upgrades": "upgrades",
    "Spoilers": "spoiler",
    "Decals": "decals",
    "Neons": "neons"
  };
  // Reverse lookup: Panels child name → tab id.
  const PANEL_NAME_TO_ID = TAB_LABEL_TO_ID;

  // Paint swatch keys in prefab draw order (drops "none" — that entry is
  // a non-visual "no paint" placeholder for the cart accounting code).
  // Used to distribute the 9 glossy balls evenly across the customization
  // canvas, replacing the prefab's baked 105-px pitch that overlaps at
  // 86-px ball size.
  const PAINT_KEYS = Object.keys(PAINT_COLORS).filter((k) => k !== "none");

  // Mechanic slider node names → draft.mechanic keys. The Unity prefab
  // has 8 sliders (two copies of camber / spring-force / suspension-travel
  // / spring-damp for front + rear).
  const MECH_SLIDER_KEYS = {
    "Front Camber": "frontCamber",
    "Rear Camber": "rearCamber",
    "Front Suspension Spring Force": "frontSpringForce",
    "Rear Suspension Spring Force": "rearSpringForce",
    "Front Suspensions": "frontSuspension",
    "Rear Suspensions": "rearSuspension",
    "Front Suspension Spring Damp": "frontSpringDamp",
    "Rear Suspension Spring Damp": "rearSpringDamp"
  };

  // Unity-aligned chrome: baked Menu_Customization tab row + cart panel
  // + back button. Interactive content tray (paint/wheel options) stays
  // runtime-driven and sits as an overlay below the tabs.
  const customizePanel = MAIN_MENU_UI.panels?.customization;
  if (customizePanel) {
    const root = document.createElement("div");
    root.className = "menu-page menu-page-customize unity-panel-root";
    root.style.position = "absolute";
    root.style.inset = "0";

    const draft = state.draft;
    const activeTab = state.customizeTab;
    const mechanicPicker = state.mechanicPicker;
    const reRender = () => { applyVisuals(); render(); };

    // Latched when visit() descends into the Cart subtree so its
    // "Background" child can be distinguished from unrelated nodes that
    // happen to share the same name (e.g. Paint > Background).
    let inCartSubtree = false;

    // Runtime-collected data for post-walk overlays.
    const sliderRects = {}; // Mechanic sliders → n.rect
    const upgradeLevelRects = {}; // Upgrade "Level" text nodes → n.rect
    const rgbSliderRects = {}; // ColorPicker Slider_R/G/B → n.rect
    let colorPickerSide = null; // "Smoke"|"Headlight" while walking that subtree
    // RCCP_Sprite.png atlas slicing data. Atlas is 1024×768; Unity uses
    // bottom-left origin so y_css = 768 - y - h.
    const RCCP_ATLAS_SIZE = { w: 1024, h: 768 };
    const RCCP_ATLAS_SLICES = {
      // fileID 60849353 → RCCP_Sprite_17 (steering wheel / handling)
      "60849353": { x: 467, y: 259, w: 230, h: 230 },
      // fileID -500179997 → RCCP_Sprite_1 (speedometer / speed)
      "-500179997": { x: 767, y: 520, w: 257, h: 244 }
    };
    // Track which upgrade button we're currently descending into so we
    // can apply atlas slicing to its Image child.
    let currentUpgradeKey = null;

    // Latched when visit() enters a PAINT_COLORS swatch so the deeper
    // Price text node can be looked up against the real PAINT_COLORS[].price.
    // Walk is depth-first so by the time we visit children the parent has
    // already set this.
    let currentPaintSwatch = null;
    // Tracks the overridden rect of the most recently visited paint
    // swatch so the Price child (walked right after its parent) can be
    // repositioned to sit under the new ball center instead of staying
    // at the prefab's baked 105-px pitch.
    let currentPaintBallLeft = 0;
    let currentPaintBallTop = 0;
    const PAINT_BALL_SIZE = 88;

    // Same latch pattern for the wheel tab: track the most recently
    // visited Wheel tile's overridden rect so its PricePanel/Bg/Price
    // children can follow it instead of staying at the prefab's baked
    // column (which stacks the 7 tiles in the right half of the canvas).
    let currentWheelTileIndex = -1;
    let currentWheelTileLeft = 0;
    let currentWheelTileTop = 0;
    const WHEEL_TILE_WIDTH = 200;
    const WHEEL_TILE_HEIGHT = 150;

    const resolver = (n) => {
      // --- 1. Top-level Panels container -------------------------------
      // Unity keeps the `Panels` container SetActive(false) in the prefab
      // and flips it on at runtime. Force it active so our tab panels can
      // render at all.
      if (n.name === "Panels") return { forceActive: true };

      // --- 2. Each of the 7 tab panels ---------------------------------
      if (PANEL_NAME_TO_ID[n.name] !== undefined) {
        // Mechanic, Spoilers, and Decals tabs are fully custom — hide their
        // Unity panels so we can render our own overlays instead.
        if (n.name === "Mechanic" || n.name === "Spoilers" || n.name === "Decals" || n.name === "Neons") return { hidden: true };
        return PANEL_NAME_TO_ID[n.name] === activeTab
          ? { forceActive: true }
          : { hidden: true };
      }

      // --- 3. Color Picker modals (inside Mechanic panel) -------------
      // Active:false in the prefab. Force-show only when the user has
      // opened one via the Smoke/Headlight color button.
      if (n.name === "Smoke Color Picker") {
        if (activeTab === "mechanic" && mechanicPicker === "smoke") {
          colorPickerSide = "smoke";
          return { forceActive: true };
        }
        return { hidden: true };
      }
      if (n.name === "Headlight Color Picker") {
        if (activeTab === "mechanic" && mechanicPicker === "headlight") {
          colorPickerSide = "headlight";
          return { forceActive: true };
        }
        return { hidden: true };
      }

      // --- 4. Tab row buttons (Buttons container) ----------------------
      // The "Buttons" container holds the tab row and its Vignette
      // background sprite. When a sub-tab is open, hide the entire
      // container so the bottom background bar disappears.
      if (n.name === "Buttons" && n.children) {
        if (activeTab !== null) return { hidden: true };
      }
      // The 7 tab buttons are all named "Button" / "Button (N)" with the
      // tab label in a TMP child. Match by label text. When a sub-tab is
      // already open, hide the whole tab row — the user navigates back to
      // it via the Back button (which becomes two-level while a sub-tab
      // is active).
      if (/^Button(\s*\(\d+\))?$/.test(n.name) && n.children) {
        const label = findTextInSubtree(n);
        const tabId = TAB_LABEL_TO_ID[label];
        if (tabId) {
          if (activeTab !== null) return { hidden: true };
          return {
            onClick: () => {
              state.customizeTab = tabId;
              state.mechanicPicker = null;
              render();
            },
            active: activeTab === tabId
          };
        }
      }

      // --- 5. Chrome buttons -------------------------------------------
      // Cart panel — the Unity prefab has a Background child with a
      // valid rect but no sprite assigned (runtime-themed). Render it
      // with a semi-transparent dark panel style so the cart has a
      // proper frame instead of floating text over the scene.
      // Hide the entire cart on the Mechanic tab (no purchasable items).
      if (n.name === "Cart") {
        if (activeTab === "mechanic") return { hidden: true };
        inCartSubtree = true;
        return null;
      }
      if (inCartSubtree && n.name === "Background") {
        return {
          style: {
            background: "rgba(8, 14, 24, 0.72)",
            border: "1px solid rgba(255, 207, 76, 0.35)",
            borderRadius: "10px",
            boxShadow: "0 8px 28px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255,255,255,0.05)"
          }
        };
      }
      if (n.name === "Back") {
        // Two-level back: while a sub-tab is open, Back returns to the
        // tab row (clearing customizeTab + mechanicPicker). Once the tab
        // row is visible, Back exits to the main menu.
        return {
          onClick: () => {
            if (state.customizeTab !== null) {
              state.customizeTab = null;
              state.mechanicPicker = null;
              render();
            } else {
              navigate("main");
            }
          }
        };
      }
      if (n.name === "Purcase Cart") {
        if (activeTab === "mechanic") return { hidden: true };
        return { onClick: applyPurchase };
      }
      if (n.name === "Clear Cart") {
        if (activeTab === "mechanic") return { hidden: true };
        return { onClick: restoreDraft };
      }

      // --- 6. Paint tab swatches --------------------------------------
      // Nine swatches named exactly after PAINT_COLORS keys (Orange,
      // White, Black, Red, Blue, Cyan, Magenta, Pink, Green). The Unity
      // prefab bakes a flat sprite swatch per color on 105px pitch × 180
      // width, which renders as an overlapping band of tinted rectangles
      // when dropped into DOM as-is. Render them as pure-CSS glossy
      // spheres instead — radial gradient highlight + inset/drop
      // shadows + border-radius:50% — matching the Unity runtime look.
      if (activeTab === "paint" && PAINT_COLORS[n.name]) {
        currentPaintSwatch = n.name;
        const swatchName = n.name;
        const hex = PAINT_COLORS[n.name].hex || "#888";
        const isActive = draft.paintColor === swatchName;
        const pRect = n.rect || {};
        const ballSize = PAINT_BALL_SIZE;
        // Distribute all PAINT_KEYS evenly across the canvas width so
        // the balls don't stack. Use a symmetric 240-px margin on each
        // side of the 1920-px reference canvas and step between ball
        // centers; vertical position stays at the prefab row so the
        // layout still tracks the Unity chrome.
        const idx = PAINT_KEYS.indexOf(swatchName);
        const count = PAINT_KEYS.length;
        const canvasWidth = 1920;
        const leftMargin = 240;
        const rightMargin = 240;
        const span = canvasWidth - leftMargin - rightMargin;
        const step = count > 1 ? span / (count - 1) : 0;
        const centerX = leftMargin + idx * step;
        const rowTop = (pRect.top ?? 0) + ((pRect.height ?? ballSize) - ballSize) / 2;
        currentPaintBallLeft = centerX - ballSize / 2;
        currentPaintBallTop = rowTop;
        return {
          onClick: () => { draft.paintColor = swatchName; reRender(); },
          active: isActive,
          rectOverride: {
            left: currentPaintBallLeft,
            top: currentPaintBallTop,
            width: ballSize,
            height: ballSize
          },
          style: {
            borderRadius: "50%",
            backgroundImage: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.35) 18%, rgba(255,255,255,0) 42%), radial-gradient(circle at 65% 78%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 55%)`,
            backgroundColor: hex,
            backgroundBlendMode: "normal",
            border: isActive ? "3px solid #ffcf4c" : "2px solid rgba(0,0,0,0.55)",
            boxShadow: isActive
              ? "0 0 0 4px rgba(255,207,76,0.35), inset -6px -8px 18px rgba(0,0,0,0.35), 0 6px 14px rgba(0,0,0,0.5)"
              : "inset -6px -8px 18px rgba(0,0,0,0.35), 0 6px 14px rgba(0,0,0,0.5)",
            padding: "0"
          }
        };
      }
      // Price text inside a paint swatch — the prefab bakes a literal
      // "$9999" placeholder at the baked 105-px-pitch column. Override
      // the text with the real catalog price AND reposition the label
      // to sit directly under the adaptively-placed ball so the number
      // tracks its swatch instead of floating at the old position.
      if (activeTab === "paint" && currentPaintSwatch && n.name === "Price" && n.text) {
        const price = PAINT_COLORS[currentPaintSwatch]?.price;
        if (price !== undefined) {
          const labelWidth = PAINT_BALL_SIZE + 60;
          return {
            textOverride: `$${price}`,
            rectOverride: {
              left: currentPaintBallLeft + PAINT_BALL_SIZE / 2 - labelWidth / 2,
              top: currentPaintBallTop + PAINT_BALL_SIZE + 8,
              width: labelWidth,
              height: 32
            }
          };
        }
      }
      // Bg pill behind each paint swatch's price label. In the prefab
      // this is a CCDS_UI_ButtonFade sprite baked at the 105-px-pitch
      // column with width 189; it appeared as a row of floating green
      // chips at the old swatch positions after we re-spaced the balls.
      // Reposition it directly under the new ball center so it acts as
      // a proper pill background for the repositioned price label.
      if (activeTab === "paint" && currentPaintSwatch && n.name === "Bg") {
        const pillWidth = PAINT_BALL_SIZE + 76;
        return {
          rectOverride: {
            left: currentPaintBallLeft + PAINT_BALL_SIZE / 2 - pillWidth / 2,
            top: currentPaintBallTop + PAINT_BALL_SIZE + 4,
            width: pillWidth,
            height: 40
          }
        };
      }

      // --- 7. Wheels tab tiles ----------------------------------------
      // Seven tiles in the Unity prefab: Wheel, Wheel (1) .. Wheel (6).
      // Our WHEELS catalog only has 4 entries, so we hide the three
      // extra tiles and distribute the 4 active ones evenly across the
      // canvas using the same adaptive-spacing approach as the paint
      // balls. Each active tile also latches its position so its
      // PricePanel/Bg/Price children can follow it (the prefab bakes
      // those at offscreen columns that don't track the tile rect).
      if (activeTab === "wheel" && /^Wheel(\s*\(\d+\))?$/.test(n.name)) {
        const match = n.name.match(/\((\d+)\)/);
        const tileIndex = match ? Number(match[1]) : 0;
        if (tileIndex >= WHEELS.length) {
          currentWheelTileIndex = -1;
          return { hidden: true };
        }
        const wheelOption = WHEELS[tileIndex];
        const count = WHEELS.length;
        const canvasWidth = 1920;
        const leftMargin = 260;
        const rightMargin = 260;
        const span = canvasWidth - leftMargin - rightMargin;
        const step = count > 1 ? span / (count - 1) : 0;
        const centerX = leftMargin + tileIndex * step;
        const pRect = n.rect || {};
        const rowTop = (pRect.top ?? 150) + ((pRect.height ?? WHEEL_TILE_HEIGHT) - WHEEL_TILE_HEIGHT) / 2;
        currentWheelTileIndex = tileIndex;
        currentWheelTileLeft = centerX - WHEEL_TILE_WIDTH / 2;
        currentWheelTileTop = rowTop;
        return {
          onClick: () => { draft.wheel = wheelOption.id; reRender(); },
          active: draft.wheel === wheelOption.id,
          rectOverride: {
            left: currentWheelTileLeft,
            top: currentWheelTileTop,
            width: WHEEL_TILE_WIDTH,
            height: WHEEL_TILE_HEIGHT
          }
        };
      }
      // PricePanel is an invisible container under each wheel tile; it
      // has no sprite but its baked rect (scattered across negative x
      // values for the later tiles) would render an empty div at an
      // offscreen position. Hide it — the Bg + Price children we really
      // care about get their own absolute rect overrides below.
      if (activeTab === "wheel" && currentWheelTileIndex >= 0 && n.name === "PricePanel") {
        return { hidden: true };
      }
      // Bg pill background for the wheel's price label.
      if (activeTab === "wheel" && currentWheelTileIndex >= 0 && n.name === "Bg") {
        const pillWidth = WHEEL_TILE_WIDTH - 24;
        return {
          rectOverride: {
            left: currentWheelTileLeft + (WHEEL_TILE_WIDTH - pillWidth) / 2,
            top: currentWheelTileTop + WHEEL_TILE_HEIGHT + 4,
            width: pillWidth,
            height: 44
          }
        };
      }
      // Price text — override with real catalog price and reposition
      // to sit inside the Bg pill under the tile.
      if (activeTab === "wheel" && currentWheelTileIndex >= 0 && n.name === "Price" && n.text) {
        const wheelOption = WHEELS[currentWheelTileIndex];
        const labelWidth = WHEEL_TILE_WIDTH - 40;
        return {
          textOverride: `$${wheelOption.price}`,
          rectOverride: {
            left: currentWheelTileLeft + (WHEEL_TILE_WIDTH - labelWidth) / 2,
            top: currentWheelTileTop + WHEEL_TILE_HEIGHT + 4,
            width: labelWidth,
            height: 44
          }
        };
      }

      // --- 8. Upgrades tab --------------------------------------------
      if (activeTab === "upgrades") {
        const UPGRADE_KEYS = {
          "Engine Upgrade": "engine",
          "Handling Upgrade": "handling",
          "Speed Upgrade": "speed"
        };
        // Swap Engine (baked right=1310) and Speed (baked left=310) so
        // Engine appears on the left and Speed on the right, matching
        // the Unity runtime layout.
        const UPGRADE_X_SWAP = { engine: -1000, speed: 1000 };
        const xOff = UPGRADE_X_SWAP[currentUpgradeKey] || 0;

        const upgradeKey = UPGRADE_KEYS[n.name];
        if (upgradeKey) {
          currentUpgradeKey = upgradeKey;
          const off = UPGRADE_X_SWAP[upgradeKey] || 0;
          upgradeLevelRects[upgradeKey] = off
            ? { ...n.rect, left: n.rect.left + off }
            : n.rect;
          const level = draft.upgrades?.[upgradeKey] ?? 0;
          const result = {
            onClick: () => {
              draft.upgrades[upgradeKey] = (level + 1) % (UPGRADE_TIERS + 1);
              reRender();
            },
            active: level > 0,
            // Orange tint (default) via multiply blend on the ButtonSprite
            style: {
              backgroundBlendMode: "multiply",
              backgroundColor: "rgb(255, 165, 0)"
            }
          };
          if (off) result.rectOverride = { left: n.rect.left + off };
          return result;
        }
        // Hide the baked "0" inside each upgrade — we'll overlay the
        // real live level after the walk so it stays in sync with draft.
        if (n.name === "Level") return { hidden: true };

        // Sprite-atlas slicing for upgrade icons that live inside
        // RCCP_Sprite.png (Handling = steering wheel, Speed = speedometer).
        // Engine uses a standalone Logo_Engine.png so it renders fine as-is.
        if (n.name === "Image" && n.sprite?.assetPath?.includes("RCCP_Sprite.png")) {
          const fid = String(n.sprite.fileID);
          const slice = RCCP_ATLAS_SLICES[fid];
          if (slice) {
            const aw = RCCP_ATLAS_SIZE.w;
            const ah = RCCP_ATLAS_SIZE.h;
            // Unity y is bottom-up; CSS y is top-down
            const yCss = ah - slice.y - slice.h;
            // Scale atlas so the slice fills the element rect
            const elemW = n.rect.width;
            const elemH = n.rect.height;
            const sx = elemW / slice.w;
            const sy = elemH / slice.h;
            const tintColor = n.sprite.color;
            const styleOverride = {
              backgroundImage: `url("${rootAssetUrl(n.sprite.assetPath)}")`,
              backgroundSize: `${aw * sx}px ${ah * sy}px`,
              backgroundPosition: `${-slice.x * sx}px ${-yCss * sy}px`,
              backgroundRepeat: "no-repeat",
              // Clear defaults that the generic sprite renderer sets
              backgroundBlendMode: "normal",
              backgroundColor: "transparent"
            };
            // Apply tint via filter if color is black (Handling icon)
            if (tintColor && tintColor.r === 0 && tintColor.g === 0 && tintColor.b === 0) {
              styleOverride.filter = "brightness(0)";
            }
            const result = { style: styleOverride };
            if (xOff) result.rectOverride = { left: n.rect.left + xOff };
            return result;
          }
        }

        // Show real price text inside PricePanel for each upgrade
        if (n.name === "Price" && n.text && currentUpgradeKey) {
          const lvl = draft.upgrades?.[currentUpgradeKey] ?? 0;
          const price = upgradeNextPrice(lvl);
          const result = {
            textOverride: lvl >= UPGRADE_TIERS ? "MAX" : `$${price}`
          };
          if (xOff) result.rectOverride = { left: n.rect.left + xOff };
          return result;
        }

        // Apply position swap to upgrade-button children that weren't
        // caught by the explicit handlers above (PricePanel, its Bg
        // backdrop, and Engine's standalone Logo_Engine sprite).  Only
        // target known child names/assets so we don't accidentally
        // offset Back / Cart nodes that appear later in the walk.
        if (xOff && n.rect && (n.name === "PricePanel" || n.name === "Bg" ||
            (n.name === "Image" && n.sprite?.assetPath?.includes("Logo_Engine")))) {
          return { rectOverride: { left: n.rect.left + xOff } };
        }
      }

      // --- 9. Spoilers tab (no resolver logic needed) -------------------
      // The Spoilers panel is hidden unconditionally (see section 2 above)
      // and rebuilt as custom tiles in the post-walk overlay section.

      // --- 10. Decals tab — panel hidden at section 2; custom UI below ---

      // --- 11. Neons tab — panel hidden at section 2; custom UI below ---

      // --- 12. Mechanic tab -------------------------------------------
      if (activeTab === "mechanic") {
        // Slider containers — collect rects, hide the baked bar, and
        // overlay a real <input type=range> after the walk. Active if
        // the value drifts from the default midpoint.
        if (MECH_SLIDER_KEYS[n.name]) {
          sliderRects[MECH_SLIDER_KEYS[n.name]] = n.rect;
          return { hidden: true };
        }
        // The two color-picker opener buttons.
        if (n.name === "Smoke Color Button") {
          return {
            onClick: () => { state.mechanicPicker = "smoke"; render(); },
            active: mechanicPicker === "smoke"
          };
        }
        if (n.name === "Headlight Color Button") {
          return {
            onClick: () => { state.mechanicPicker = "headlight"; render(); },
            active: mechanicPicker === "headlight"
          };
        }

        // --- 12b. Inside Smoke / Headlight Color Picker --------------
        // Slider_R/G/B live under the picker; capture their rects so we
        // can overlay real inputs aligned to them. The enclosing picker
        // panel set `colorPickerSide` during its own visit so we know
        // which color field to bind to.
        if (colorPickerSide && (n.name === "Slider_R" || n.name === "Slider_G" || n.name === "Slider_B")) {
          const channel = n.name.slice(-1).toLowerCase(); // r / g / b
          rgbSliderRects[`${colorPickerSide}-${channel}`] = n.rect;
          return { hidden: true };
        }
        if (colorPickerSide && n.name === "Close") {
          return { onClick: () => { state.mechanicPicker = null; render(); } };
        }
      }

      return null;
    };
    renderUnityPanelFlat(customizePanel, root, resolver);

    // --- Post-walk overlays -------------------------------------------

    // Upgrades: render live level digits on top of each upgrade button.
    if (activeTab === "upgrades") {
      Object.entries(upgradeLevelRects).forEach(([key, rect]) => {
        if (!rect) return;
        const label = document.createElement("div");
        label.className = "unity-panel-runtime-upgrade-level";
        const level = draft.upgrades?.[key] ?? 0;
        label.textContent = `${level}`;
        Object.assign(label.style, {
          position: "absolute",
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: "18px",
          color: "#fff",
          fontSize: "72px",
          fontWeight: "700",
          textShadow: "0 2px 6px rgba(0,0,0,0.85)",
          pointerEvents: "none"
        });
        root.appendChild(label);
      });

      // Render the Stats_Vehicle bar panel at the bottom so the user can
      // see current stats and the projected upgrade increment (orange bar).
      const statsPanel = MAIN_MENU_UI.panels?.statsVehicle;
      if (statsPanel) {
        // Draft stats include pending upgrade changes
        const draftStats = statsFor();
        // Saved stats reflect what the player has already purchased
        const saved = savedSetup();
        const vehicle = currentVehicle();
        const spoiler = SPOILERS.find((s) => s.id === saved.spoiler) || SPOILERS[0];
        const wheel = WHEELS.find((w) => w.id === saved.wheel) || WHEELS[0];
        const savedUpgrades = saved.upgrades || { engine: 0, handling: 0, speed: 0 };
        const baseStats = {
          handling: vehicle.stats.handling + spoiler.stats.handling + wheel.stats.handling + (savedUpgrades.handling || 0) * UPGRADE_STAT_BONUS_PER_TIER,
          speed: vehicle.stats.speed + spoiler.stats.speed + wheel.stats.speed + (savedUpgrades.speed || 0) * UPGRADE_STAT_BONUS_PER_TIER,
          engine: vehicle.stats.engine + spoiler.stats.engine + wheel.stats.engine + (savedUpgrades.engine || 0) * UPGRADE_STAT_BONUS_PER_TIER
        };
        // Bar scale: stats range roughly 80–200; use 200 as max so the
        // bars show meaningful variation rather than being always full.
        const STAT_MAX = 200;
        const draftByLabel = { Engine: draftStats.engine, Handling: draftStats.handling, Speed: draftStats.speed };
        const baseByLabel = { Engine: baseStats.engine, Handling: baseStats.handling, Speed: baseStats.speed };
        let curDraft = 0;
        let curBase = 0;
        const upgradeStatsResolver = (n) => {
          if (/^Button(\s*\(\d+\))?$/.test(n.name) && n.children) {
            const label = findTextInSubtree(n);
            if (draftByLabel[label] !== undefined) {
              curDraft = draftByLabel[label];
              curBase = baseByLabel[label];
            }
            return null;
          }
          if (n.name === "Fill") {
            // Green bar: shows saved/purchased stat level
            const scale = Math.min(1, Math.max(0, curBase / STAT_MAX));
            return { rectOverride: { widthScale: scale } };
          }
          if (n.name === "Fill_Upgraded") {
            // Orange bar (behind green in DOM): shows projected stat.
            // Visible only when draft upgrades exceed saved upgrades.
            if (curDraft > curBase) {
              const scale = Math.min(1, Math.max(0, curDraft / STAT_MAX));
              return { rectOverride: { widthScale: scale } };
            }
            return { hidden: true };
          }
          if (n.name === "Back") {
            return { hidden: true };
          }
          return null;
        };
        renderUnityPanelFlat(statsPanel, root, upgradeStatsResolver);
      }
    }

    // Spoiler tab: Unity-style scrollable tiles — icon + number per
    // spoiler, "X" for no-spoiler at the end.
    if (activeTab === "spoiler") {
      const genericIcon = rootAssetUrl("Realistic Car Controller Pro/Textures/Upgrades/Logo_Spoiler.png");

      // Build the visible list: actual spoiler models first, then "X" at end
      const spoilerModels = SPOILERS.filter((s) => s.model);
      const visibleItems = [...spoilerModels, SPOILERS.find((s) => !s.model)];

      const tileW = 160, tileH = 130, gap = 12;
      const containerTop = 120, containerLeft = 40;
      const containerW = 1840;

      const scrollContainer = document.createElement("div");
      scrollContainer.className = "spoiler-scroll-container";
      Object.assign(scrollContainer.style, {
        position: "absolute",
        left: `${containerLeft}px`,
        top: `${containerTop}px`,
        width: `${containerW}px`,
        height: `${tileH + 24}px`,
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        display: "flex",
        gap: `${gap}px`,
        alignItems: "center",
        padding: "6px 12px"
      });

      visibleItems.forEach((option) => {
        if (!option) return;
        const isNoSpoiler = !option.model;
        const spoilerNum = isNoSpoiler ? null : option.model.replace("Spoiler_", "").replace(/^0+/, "") || "0";
        const isSelected = draft.spoiler === option.id;

        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `spoiler-tile${isSelected ? " is-active" : ""}`;
        Object.assign(tile.style, {
          display: "inline-flex",
          flexShrink: "0",
          width: `${tileW}px`,
          height: `${tileH}px`,
          cursor: "pointer",
          border: "3px solid rgba(60, 60, 60, 0.8)",
          borderRadius: "10px",
          background: isNoSpoiler
            ? "linear-gradient(135deg, #555 0%, #333 100%)"
            : "linear-gradient(135deg, #ff8c00 0%, #e06800 100%)",
          padding: "0",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          position: "relative"
        });
        tile.addEventListener("click", () => { draft.spoiler = option.id; reRender(); });

        if (!isNoSpoiler) {
          // Icon area (left 55%)
          const icon = document.createElement("div");
          Object.assign(icon.style, {
            width: "55%",
            height: "100%",
            backgroundImage: `url("${genericIcon}")`,
            backgroundSize: "75%",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
            filter: "brightness(0.2)"
          });
          tile.appendChild(icon);

          // Number area (right 45%)
          const num = document.createElement("div");
          num.textContent = spoilerNum;
          Object.assign(num.style, {
            width: "45%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "52px",
            fontWeight: "900",
            color: "#fff",
            textShadow: "2px 2px 6px rgba(0,0,0,0.6)",
            pointerEvents: "none"
          });
          tile.appendChild(num);
        } else {
          // "X" tile for no spoiler
          const xLabel = document.createElement("div");
          xLabel.textContent = "X";
          Object.assign(xLabel.style, {
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "64px",
            fontWeight: "900",
            color: "#fff",
            textShadow: "2px 2px 6px rgba(0,0,0,0.6)",
            pointerEvents: "none"
          });
          tile.appendChild(xLabel);
        }

        scrollContainer.appendChild(tile);
      });

      root.appendChild(scrollContainer);
    }

    // Decals tab: direction buttons + scrollable decal tiles.
    if (activeTab === "decals") {
      const curDir = draft.decalLocation || "front";
      const dirLabels = { front: "FRONT", back: "REAR", left: "LEFT", right: "RIGHT" };

      // --- Direction buttons row ---
      const dirRow = document.createElement("div");
      dirRow.className = "decal-dir-row";
      Object.assign(dirRow.style, {
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        top: "100px",
        height: "80px",
        display: "flex",
        gap: "24px",
        justifyContent: "center",
        alignItems: "center"
      });

      for (const dir of DECAL_LOCATIONS) {
        const isActive = curDir === dir;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = dirLabels[dir];
        btn.className = `decal-dir-btn${isActive ? " is-active" : ""}`;
        Object.assign(btn.style, {
          width: "220px",
          height: "64px",
          border: "3px solid rgba(60, 60, 60, 0.8)",
          borderRadius: "8px",
          background: "linear-gradient(135deg, #ff8c00 0%, #e06800 100%)",
          color: "#000",
          fontSize: "28px",
          fontWeight: "900",
          cursor: "pointer",
          letterSpacing: "2px"
        });
        btn.addEventListener("click", () => {
          draft.decalLocation = dir;
          // Orbit camera to face the selected direction
          const pivot = world.carPivot.position;
          const dist = 8;
          const camY = pivot.y + 2;
          const offsets = {
            front: { x: 0, z: dist },
            back:  { x: 0, z: -dist },
            left:  { x: -dist, z: 0 },
            right: { x: dist, z: 0 }
          };
          const off = offsets[dir];
          camera.position.set(pivot.x + off.x, camY, pivot.z + off.z);
          controls.target.set(pivot.x, pivot.y + 0.8, pivot.z);
          controls.update();
          reRender();
        });
        dirRow.appendChild(btn);
      }
      root.appendChild(dirRow);

      // --- Decal tiles row (scrollable) ---
      const tileW = 140, tileH = 130, gap = 10;
      const scrollContainer = document.createElement("div");
      scrollContainer.className = "decal-scroll-container spoiler-scroll-container";
      Object.assign(scrollContainer.style, {
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        top: "200px",
        maxWidth: "1840px",
        height: `${tileH + 24}px`,
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        display: "flex",
        gap: `${gap}px`,
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 12px"
      });

      // Decal tiles then X at end
      const allItems = [...DECALS, null]; // null = clear
      allItems.forEach((decal) => {
        const isNoDecal = !decal;
        const decalId = decal?.id || null;
        const isSelected = (draft.decals?.[curDir] || null) === decalId;

        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `spoiler-tile${isSelected ? " is-active" : ""}`;
        Object.assign(tile.style, {
          display: "inline-flex",
          flexShrink: "0",
          width: `${tileW}px`,
          height: `${tileH}px`,
          cursor: "pointer",
          border: "3px solid rgba(60, 60, 60, 0.8)",
          borderRadius: "10px",
          background: isNoDecal
            ? "linear-gradient(135deg, #555 0%, #333 100%)"
            : "linear-gradient(135deg, #ff8c00 0%, #e06800 100%)",
          padding: "0",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          position: "relative"
        });
        tile.addEventListener("click", () => {
          if (!draft.decals) draft.decals = { front: null, back: null, left: null, right: null };
          draft.decals[curDir] = decalId;
          reRender();
        });

        if (!isNoDecal) {
          // Decal image
          const img = document.createElement("div");
          Object.assign(img.style, {
            width: "100%",
            height: "100%",
            backgroundImage: `url("${rootAssetUrl(decal.texture)}")`,
            backgroundSize: "70%",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
            filter: "brightness(0.15)"
          });
          tile.appendChild(img);
        } else {
          // X tile
          const xLabel = document.createElement("div");
          xLabel.textContent = "X";
          Object.assign(xLabel.style, {
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "56px",
            fontWeight: "900",
            color: "#fff",
            textShadow: "2px 2px 6px rgba(0,0,0,0.6)",
            pointerEvents: "none"
          });
          tile.appendChild(xLabel);
        }

        scrollContainer.appendChild(tile);
      });

      root.appendChild(scrollContainer);
    }

    // Neons tab: custom color tiles replacing the baked Unity panel.
    if (activeTab === "neons") {
      const tileW = 160, tileH = 130, gap = 10;
      const neonIcon = rootAssetUrl(NEON_PROJECTOR.icon);

      const scrollContainer = document.createElement("div");
      scrollContainer.className = "neon-scroll-container spoiler-scroll-container";
      Object.assign(scrollContainer.style, {
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        top: "150px",
        maxWidth: "1840px",
        height: `${tileH + 24}px`,
        overflowX: "auto",
        overflowY: "hidden",
        whiteSpace: "nowrap",
        display: "flex",
        gap: `${gap}px`,
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 12px"
      });

      const allItems = [...NEONS, null]; // null = "off" tile
      allItems.forEach((neon) => {
        const isOff = !neon;
        const neonId = neon?.id || null;
        const isSelected = (draft.neon || null) === neonId;

        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = `spoiler-tile${isSelected ? " is-active" : ""}`;
        Object.assign(tile.style, {
          display: "inline-flex",
          flexShrink: "0",
          width: `${tileW}px`,
          height: `${tileH}px`,
          cursor: "pointer",
          border: isSelected ? "3px solid #ffcf4c" : "3px solid rgba(60, 60, 60, 0.8)",
          borderRadius: "10px",
          background: isOff
            ? "linear-gradient(135deg, #555 0%, #333 100%)"
            : `linear-gradient(135deg, ${neon.color} 0%, ${neon.color}88 100%)`,
          padding: "0",
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          boxShadow: isSelected ? `0 0 12px ${neon?.color || "#ffcf4c"}` : "none"
        });
        tile.addEventListener("click", () => { draft.neon = neonId; reRender(); });

        if (!isOff) {
          // Neon icon overlay (Logo_Neon.png, darkened)
          const icon = document.createElement("div");
          Object.assign(icon.style, {
            width: "100%",
            height: "100%",
            backgroundImage: `url("${neonIcon}")`,
            backgroundSize: "60%",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
            filter: "brightness(0.2)"
          });
          tile.appendChild(icon);
        } else {
          // "X" tile for no neon
          const xLabel = document.createElement("div");
          xLabel.textContent = "X";
          Object.assign(xLabel.style, {
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "56px",
            fontWeight: "900",
            color: "#fff",
            textShadow: "2px 2px 6px rgba(0,0,0,0.6)",
            pointerEvents: "none"
          });
          tile.appendChild(xLabel);
        }

        scrollContainer.appendChild(tile);
      });

      root.appendChild(scrollContainer);
    }

    // Mechanic tab: custom runtime overlay using Unity-baked rect
    // positions. The Mechanic panel itself is hidden (see resolver above)
    // so we build everything from scratch in the 1920×1080 frame.
    if (activeTab === "mechanic") {
      const mech = document.createElement("div");
      mech.className = "mechanic-overlay";

      // --- Helpers ---
      function posDiv(cls, rect) {
        const d = document.createElement("div");
        d.className = cls;
        Object.assign(d.style, {
          position: "absolute",
          left: `${rect.left}px`, top: `${rect.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`
        });
        return d;
      }
      function posBtn(cls, rect) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = cls;
        Object.assign(b.style, {
          position: "absolute",
          left: `${rect.left}px`, top: `${rect.top}px`,
          width: `${rect.width}px`, height: `${rect.height}px`
        });
        return b;
      }

      // --- Background panels (semi-transparent dark) ---
      const bgRects = [
        { left: 7.55, top: 127.59, width: 653.54, height: 336.92 },
        { left: 680.65, top: 127.53, width: 558.7, height: 120.94 },
        { left: 1258.91, top: 129.59, width: 653.54, height: 336.92 }
      ];
      bgRects.forEach((r) => mech.appendChild(posDiv("mechanic-bg-panel", r)));

      // --- Slider definitions (Unity-baked rects) ---
      const SLIDERS = [
        // Left panel
        { key: "frontCamber", label: "Front Camber", front: true,
          track: { left: 56.22, top: 161.92, width: 501.83, height: 41.98 },
          value: { left: 564.75, top: 161.92, width: 61.57, height: 41.88 } },
        { key: "rearCamber", label: "Rear Camber", front: false,
          track: { left: 56.22, top: 236.88, width: 501.83, height: 41.98 },
          value: { left: 564.75, top: 236.88, width: 61.57, height: 41.88 } },
        { key: "frontSpringForce", label: "Front Suspensions Spring Force", front: true,
          track: { left: 56.22, top: 311.84, width: 501.83, height: 41.98 },
          value: { left: 564.75, top: 311.84, width: 61.57, height: 41.88 } },
        { key: "rearSpringForce", label: "Rear Suspensions Spring Force", front: false,
          track: { left: 56.22, top: 386.80, width: 501.83, height: 41.98 },
          value: { left: 564.75, top: 386.80, width: 61.57, height: 41.88 } },
        // Right panel
        { key: "frontSuspension", label: "Front Suspensions", front: true,
          track: { left: 1372.74, top: 164.07, width: 501.83, height: 41.98 },
          value: { left: 1304.48, top: 164.07, width: 61.57, height: 41.88 } },
        { key: "rearSuspension", label: "Rear Suspensions", front: false,
          track: { left: 1372.74, top: 239.03, width: 501.83, height: 41.98 },
          value: { left: 1304.48, top: 239.03, width: 61.57, height: 41.88 } },
        { key: "frontSpringDamp", label: "Front Suspensions Spring Damp", front: true,
          track: { left: 1372.74, top: 313.99, width: 501.83, height: 41.98 },
          value: { left: 1304.48, top: 313.99, width: 61.57, height: 41.88 } },
        { key: "rearSpringDamp", label: "Rear Suspensions Spring Damp", front: false,
          track: { left: 1372.74, top: 388.95, width: 501.83, height: 41.98 },
          value: { left: 1304.48, top: 388.95, width: 61.57, height: 41.88 } }
      ];

      SLIDERS.forEach((sl) => {
        const val = draft.mechanic?.[sl.key] ?? 0.5;

        // Slider track container (colored label bar + interactive range)
        const trackEl = posDiv(
          `mechanic-track ${sl.front ? "mechanic-track-front" : "mechanic-track-rear"}`,
          sl.track
        );
        trackEl.style.pointerEvents = "auto";

        // Blue fill bar (shows current value proportion)
        const fill = document.createElement("div");
        fill.className = "mechanic-fill";
        fill.style.width = `${val * 100}%`;
        trackEl.appendChild(fill);

        // Text label overlay
        const lbl = document.createElement("div");
        lbl.className = "mechanic-track-label";
        lbl.textContent = sl.label;
        trackEl.appendChild(lbl);

        // Range input (invisible, sits on top for interaction)
        const input = document.createElement("input");
        input.type = "range";
        input.min = "0";
        input.max = "1";
        input.step = "0.01";
        input.value = String(val);
        input.className = "mechanic-range";
        input.addEventListener("input", () => {
          const v = Number(input.value);
          draft.mechanic[sl.key] = v;
          fill.style.width = `${v * 100}%`;
          valEl.textContent = v.toFixed(1);
        });
        trackEl.appendChild(input);
        mech.appendChild(trackEl);

        // Value readout box
        const valEl = posDiv("mechanic-value", sl.value);
        valEl.textContent = val.toFixed(1);
        mech.appendChild(valEl);
      });

      // --- Color buttons (Unity-baked rects) ---
      const headlightBtn = posBtn("mechanic-color-btn", {
        left: 696.16, top: 150.67, width: 258.82, height: 74.66
      });
      headlightBtn.textContent = "Headlight Colors";
      headlightBtn.addEventListener("click", () => {
        state.mechanicPicker = state.mechanicPicker === "headlight" ? null : "headlight";
        render();
      });
      mech.appendChild(headlightBtn);

      const smokeBtn = posBtn("mechanic-color-btn mechanic-color-btn-dark", {
        left: 964.96, top: 150.67, width: 257.54, height: 74.66
      });
      smokeBtn.textContent = "Wheel Smoke Colors";
      smokeBtn.addEventListener("click", () => {
        state.mechanicPicker = state.mechanicPicker === "smoke" ? null : "smoke";
        render();
      });
      mech.appendChild(smokeBtn);

      // --- Color picker modal (Unity-baked rects) ---
      if (mechanicPicker) {
        const colorKey = mechanicPicker === "smoke" ? "smokeColor" : "headlightColor";
        const currentHex = draft.mechanic[colorKey] || "#ffffff";
        const parseHex = (hex) => {
          const s = hex.replace("#", "");
          return {
            r: parseInt(s.slice(0, 2), 16),
            g: parseInt(s.slice(2, 4), 16),
            b: parseInt(s.slice(4, 6), 16)
          };
        };
        const toHex = (rgb) => "#" + ["r", "g", "b"].map((k) => rgb[k].toString(16).padStart(2, "0")).join("");

        // Picker background (covers the center buttons area)
        const picker = posDiv("mechanic-color-picker", {
          left: 757.06, top: 127.56, width: 405.88, height: 199.87
        });

        // Append picker background FIRST so sliders render on top
        mech.appendChild(picker);

        // Channel colors matching Unity Fill / Handle colors
        const chColors = {
          r: { fill: "rgba(255,0,0,1)", handle: "#f00" },
          g: { fill: "rgba(126,255,0,1)", handle: "#0f0" },
          b: { fill: "rgba(0,23,255,1)", handle: "#00f" }
        };

        // RGB sliders at Unity positions (absolute in the 1920×1080 frame)
        const rgbSliders = [
          { ch: "r", rect: { left: 821.42, top: 136.65, width: 277.15, height: 41.78 } },
          { ch: "g", rect: { left: 821.42, top: 206.60, width: 277.15, height: 41.78 } },
          { ch: "b", rect: { left: 821.42, top: 276.55, width: 277.15, height: 41.78 } }
        ];
        rgbSliders.forEach(({ ch, rect }) => {
          const chVal = parseHex(currentHex)[ch];

          // Track container
          const track = posDiv("mechanic-picker-track", rect);
          track.style.pointerEvents = "auto";

          // Gray background bar
          const bg = document.createElement("div");
          bg.className = "mechanic-picker-track-bg";
          track.appendChild(bg);

          // Colored fill bar
          const fill = document.createElement("div");
          fill.className = "mechanic-picker-fill";
          fill.style.width = `${(chVal / 255) * 100}%`;
          fill.style.background = chColors[ch].fill;
          track.appendChild(fill);

          // Colored handle indicator
          const handle = document.createElement("div");
          handle.className = "mechanic-picker-handle";
          handle.style.left = `${(chVal / 255) * 100}%`;
          handle.style.background = chColors[ch].handle;
          track.appendChild(handle);

          // Invisible range input for interaction
          const input = document.createElement("input");
          input.type = "range";
          input.min = "0";
          input.max = "255";
          input.step = "1";
          input.value = String(chVal);
          input.className = "mechanic-picker-input";
          input.addEventListener("input", () => {
            const rgb = parseHex(draft.mechanic[colorKey] || "#ffffff");
            rgb[ch] = Number(input.value);
            draft.mechanic[colorKey] = toHex(rgb);
            const pct = `${(Number(input.value) / 255) * 100}%`;
            fill.style.width = pct;
            handle.style.left = pct;
          });
          track.appendChild(input);
          mech.appendChild(track);
        });

        // Close button (red, below the picker panel)
        const closeBtn = posBtn("mechanic-picker-close", {
          left: 757.06, top: 358.64, width: 405.88, height: 105.69
        });
        closeBtn.textContent = "CLOSE";
        closeBtn.addEventListener("click", () => {
          state.mechanicPicker = null;
          render();
        });
        mech.appendChild(closeBtn);
      }

      root.appendChild(mech);
    }

    // --- Runtime cart overlay (skip on Mechanic — no purchasable items) ---
    if (activeTab !== "mechanic") {
    // Unity cart rect: left=1494.849 top=342.23 w=425.151 h=479.54.
    // Show only deltas against the player's saved setup — items that
    // already match what's on the car don't belong in a "pending
    // purchase" cart and made it look like the wheel/spoiler were
    // always queued for re-purchase.
    const saved = savedSetup();
    const cartItems = [];
    if (draft.spoiler !== saved.spoiler) {
      cartItems.push({ label: setup.spoiler.label, price: setup.spoiler.price });
    }
    if (draft.wheel !== saved.wheel) {
      cartItems.push({ label: setup.wheel.label, price: setup.wheel.price });
    }
    if (draft.paintColor && draft.paintColor !== "none" && draft.paintColor !== saved.paintColor) {
      const paint = PAINT_COLORS[draft.paintColor];
      if (paint) cartItems.push({ label: `${draft.paintColor} Paint`, price: paint.price });
    }
    ["engine", "handling", "speed"].forEach((key) => {
      const level = draft.upgrades?.[key] ?? 0;
      const savedLevel = saved.upgrades?.[key] ?? 0;
      if (level > savedLevel) {
        // Sum progressive prices for each tier from savedLevel to level
        let totalPrice = 0;
        for (let i = savedLevel; i < level; i++) totalPrice += upgradeNextPrice(i);
        cartItems.push({ label: `${key[0].toUpperCase()}${key.slice(1)} L${level}`, price: totalPrice });
      }
    });
    // Decal changes: compare per-direction
    for (const dir of DECAL_LOCATIONS) {
      const draftDecal = draft.decals?.[dir] || null;
      const savedDecal = saved.decals?.[dir] || null;
      if (draftDecal !== savedDecal && draftDecal) {
        const entry = DECALS.find((d) => d.id === draftDecal);
        if (entry) cartItems.push({ label: `${entry.label} (${dir})`, price: entry.price });
      }
    }
    // Neon change
    if (draft.neon !== (saved.neon || null) && draft.neon) {
      const neonEntry = NEONS.find((n) => n.id === draft.neon);
      if (neonEntry) cartItems.push({ label: `${neonEntry.label} Neon`, price: neonEntry.price });
    }
    const cartTotal = cartItems.reduce((sum, item) => sum + item.price, 0);

    const runtimeCart = document.createElement("div");
    runtimeCart.className = "unity-panel-runtime-cart";
    runtimeCart.style.position = "absolute";
    runtimeCart.style.left = "1514px";
    runtimeCart.style.top = "410px";
    runtimeCart.style.width = "386px";
    runtimeCart.style.color = "#fff";
    runtimeCart.style.pointerEvents = "none";
    runtimeCart.innerHTML = cartItems
      .map((item) => `<div style="display:flex;justify-content:space-between;font-size:20px;padding:4px 0"><strong>${item.label}</strong><span>$${item.price}</span></div>`)
      .join("");
    runtimeCart.innerHTML += `<div style="margin-top:12px;font-size:22px;text-align:right">TOTAL $${cartTotal}</div>`;
    root.appendChild(runtimeCart);
    } // end cart skip for mechanic

    ui.menuPageLayer.appendChild(root);
    return;
  }

  const root = document.createElement("div");
  root.className = "menu-page menu-page-customize";
  const cart = document.createElement("aside");
  cart.className = "unity-cart";
  const cartList = document.createElement("div");
  cartList.className = "unity-cart-list";
  [setup.spoiler, setup.wheel].forEach((item) => {
    const row = document.createElement("div");
    row.className = "unity-cart-item";
    row.innerHTML = `<strong>${item.label}</strong><span>$${item.price}</span>`;
    cartList.appendChild(row);
  });
  const total = setup.spoiler.price + setup.wheel.price;
  cart.innerHTML = `<h3>CART</h3>`;
  cart.appendChild(cartList);
  cart.append(
    menuOverlayButton("CLEAR CART", "unity-small-action unity-danger", restoreDraft),
    menuOverlayButton(`PURCHASE $${total}`, "unity-small-action unity-green", applyPurchase)
  );
  root.appendChild(cart);

  const back = menuOverlayButton("<-- BACK", "unity-back-btn", () => navigate("main"));
  root.appendChild(back);

  const tabs = document.createElement("div");
  tabs.className = "unity-tab-row";
  const tabSpecs = [
    ["paint", "PAINT"],
    ["wheel", "WHEELS"],
    ["mechanic", "MECHANIC"],
    ["upgrades", "UPGRADES"],
    ["spoiler", "SPOILERS"],
    ["decals", "DECALS"],
    ["neons", "NEONS"]
  ];
  tabSpecs.forEach(([id, label]) => {
    tabs.appendChild(menuOverlayButton(label, "unity-tab-btn", () => {
      state.customizeTab = id;
      render();
    }, state.customizeTab === id));
  });
  root.appendChild(tabs);

  const tray = document.createElement("div");
  tray.className = "unity-option-tray";
  if (state.customizeTab === "wheel") {
    WHEELS.forEach((item) => {
      tray.appendChild(menuOverlayButton(`${item.label}  $${item.price}`, "unity-option-chip", () => {
        state.draft.wheel = item.id;
        applyVisuals();
        render();
      }, state.draft.wheel === item.id));
    });
  } else if (state.customizeTab !== "spoiler") {
    tray.appendChild(menuOverlayButton("COMING FROM UNITY PREFAB NEXT", "unity-option-chip unity-disabled", () => {}, false));
  }
  root.appendChild(tray);
  ui.menuPageLayer.appendChild(root);
}

// Walk a dumped panel subtree looking for the first node with text.
// Used by renderCustomize to find TMP button labels under clone-named
// Unity buttons ("Button", "Button (1)", ...).
function findTextInSubtree(node) {
  if (!node) return "";
  if (node.text) return node.text;
  if (node.children) {
    for (const c of node.children) {
      const found = findTextInSubtree(c);
      if (found) return found;
    }
  }
  return "";
}

function renderMission() {
  const options = driveSceneOptions();
  const selectedOption = options.find((option) => option.buildIndex === save.selectedScene) || options[0] || null;
  setSceneText("Menu_Drive", "DRIVE", selectedOption ? `Selected scene: ${selectedOption.title}` : "Select a city scene to start driving.");
  updateMarker();
  clearMenuPageLayer();
  ui.panel.replaceChildren();

  // --- Mission picker overlay (hidden — preserved for menu-based flow) ----
  // Styled to match the Unity Menu_Drive panel: same sprites, font sizes,
  // and layout in the 1920×1080 reference frame.
  // Activate by setting state.useMissionPicker = true before navigating.
  if (state.useMissionPicker && state.missionPickerScene != null) {
    const root = document.createElement("div");
    root.className = "menu-page menu-page-mission-picker unity-panel-root";
    root.style.position = "absolute";
    root.style.inset = "0";

    const btnSprite = rootAssetUrl("Textures/UI/CCDS_UI_Button.png");
    const fadeSprite = rootAssetUrl("Textures/UI/CCDS_UI_ButtonFade.png");

    // Background band — same as Menu_Drive (center bar, dark 50% alpha)
    const band = document.createElement("div");
    Object.assign(band.style, {
      position: "absolute",
      left: "0px", top: "280px",
      width: "1920px", height: "520px",
      backgroundImage: `url("${fadeSprite}")`,
      backgroundSize: "100% 100%",
      backgroundColor: "rgba(0,0,0,0.5)",
      backgroundBlendMode: "multiply"
    });
    root.appendChild(band);

    // Title — bold italic, centered above cards, matching Unity TMP style
    const title = document.createElement("div");
    title.textContent = "SELECT MISSION";
    Object.assign(title.style, {
      position: "absolute",
      left: "0px", top: "290px",
      width: "1920px", height: "60px",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "46px",
      fontWeight: "700",
      fontStyle: "italic",
      color: "rgba(255,255,255,0.9)",
      letterSpacing: "4px",
      textShadow: "0 2px 8px rgba(0,0,0,0.6)",
      pointerEvents: "none"
    });
    root.appendChild(title);

    // Mission cards — 5 cards evenly distributed, same size as city cards
    const cardW = 310;
    const cardH = 260;
    const gap = 20;
    const totalW = MISSIONS.length * cardW + (MISSIONS.length - 1) * gap;
    const startX = (1920 - totalW) / 2;
    const cardY = 375;

    // Accent tints per mission (applied to the card border glow)
    const MISSION_TINTS = {
      free: { r: 0.2, g: 0.8, b: 0.3 },
      checkpoint: { r: 0.2, g: 0.5, b: 1.0 },
      trailblazer: { r: 1.0, g: 0.55, b: 0.0 },
      race: { r: 1.0, g: 0.2, b: 0.2 },
      pursuit: { r: 0.6, g: 0.3, b: 1.0 }
    };

    MISSIONS.forEach((mission, i) => {
      const x = startX + i * (cardW + gap);
      const tint = MISSION_TINTS[mission.id] || MISSION_TINTS.free;
      const tintCSS = `rgb(${Math.round(tint.r * 255)},${Math.round(tint.g * 255)},${Math.round(tint.b * 255)})`;

      // Card container — CCDS_UI_Button.png background, tinted
      const card = document.createElement("button");
      card.type = "button";
      Object.assign(card.style, {
        position: "absolute",
        left: `${x}px`, top: `${cardY}px`,
        width: `${cardW}px`, height: `${cardH}px`,
        backgroundImage: `url("${btnSprite}")`,
        backgroundSize: "100% 100%",
        backgroundColor: tintCSS,
        backgroundBlendMode: "multiply",
        border: "none",
        borderRadius: "0",
        cursor: "pointer",
        padding: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        transition: "filter 0.15s, transform 0.15s",
        boxShadow: `0 4px 20px rgba(0,0,0,0.4), inset 0 0 0 2px ${tintCSS}44`
      });
      card.addEventListener("mouseenter", () => {
        card.style.filter = "brightness(1.25)";
        card.style.transform = "scale(1.04)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.filter = "brightness(1)";
        card.style.transform = "scale(1)";
      });

      // Mission name — TMP-style bold italic
      const nameEl = document.createElement("div");
      nameEl.textContent = mission.name;
      Object.assign(nameEl.style, {
        fontSize: "32px",
        fontWeight: "700",
        fontStyle: "italic",
        color: "rgba(255,255,255,0.9)",
        textShadow: "0 2px 6px rgba(0,0,0,0.5)",
        textTransform: "uppercase",
        letterSpacing: "2px",
        marginBottom: "8px",
        pointerEvents: "none"
      });
      card.appendChild(nameEl);

      // Description
      const descEl = document.createElement("div");
      descEl.textContent = mission.desc;
      Object.assign(descEl.style, {
        fontSize: "13px",
        fontStyle: "italic",
        color: "rgba(255,255,255,0.65)",
        textAlign: "center",
        lineHeight: "1.3",
        padding: "0 16px",
        maxWidth: `${cardW - 32}px`,
        pointerEvents: "none"
      });
      card.appendChild(descEl);

      // Reward + time meta — gold accent matching Unity's orange-gold
      const metaEl = document.createElement("div");
      const parts = [];
      if (mission.reward > 0) parts.push(`$${mission.reward}`);
      if (mission.timeLimited && mission.time > 0) parts.push(`${mission.time}s`);
      if (mission.id === "free") parts.push("UNLIMITED");
      metaEl.textContent = parts.join("  |  ");
      Object.assign(metaEl.style, {
        fontSize: "16px",
        fontWeight: "700",
        fontStyle: "italic",
        color: "#ffcf4c",
        marginTop: "12px",
        letterSpacing: "1px",
        pointerEvents: "none"
      });
      card.appendChild(metaEl);

      card.addEventListener("click", () => {
        save.selectedScene = state.missionPickerScene;
        state.missionId = mission.id;
        state.missionPickerScene = null;
        persist();
        navigate("game");
      });
      root.appendChild(card);
    });

    // Back button — same position and style as Menu_Drive Back button
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    Object.assign(backBtn.style, {
      position: "absolute",
      left: "0px", top: "808px",
      width: "160px", height: "77px",
      backgroundImage: `url("${btnSprite}")`,
      backgroundSize: "100% 100%",
      border: "none",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0"
    });
    const backText = document.createElement("span");
    backText.textContent = "<-- Back";
    Object.assign(backText.style, {
      fontSize: "25px",
      fontWeight: "700",
      fontStyle: "italic",
      color: "rgba(0,0,0,0.9)"
    });
    backBtn.appendChild(backText);
    backBtn.addEventListener("click", () => {
      state.missionPickerScene = null;
      render();
    });
    root.appendChild(backBtn);

    ui.menuPageLayer.appendChild(root);
    return;
  }

  // Unity-aligned proof-of-concept: render the baked Menu_Drive panel
  // tree from ccdsData. Falls back to the legacy hand-coded layout if
  // the extract script hasn't dumped the panel yet.
  const drivePanel = MAIN_MENU_UI.panels?.drive;
  if (drivePanel) {
    const root = document.createElement("div");
    root.className = "menu-page menu-page-drive-select unity-panel-root";
    root.style.position = "absolute";
    root.style.inset = "0";
    const pickScene = (buildIndex) => () => {
      save.selectedScene = buildIndex;
      state.missionId = "free";
      persist();
      navigate("game");
    };
    // The Image child inside each Scene_City_N card has no sprite field
    // in the prefab — Unity binds the city preview texture at runtime
    // from the scene manifest. Walk order is top-down, so a closure that
    // latches the current scene when it enters a Scene_City_N and reads
    // it back when it encounters the Image child is enough to inject the
    // preview via the renderer's backgroundImage descriptor.
    const sceneByName = {
      Scene_City_1: options[0] || null,
      Scene_City_2: options[1] || null
    };
    let currentSceneOption = null;
    const driveResolver = (n) => {
      if (n.name in sceneByName) {
        currentSceneOption = sceneByName[n.name];
        return currentSceneOption
          ? { onClick: pickScene(currentSceneOption.buildIndex) }
          : null;
      }
      if (n.name === "Image" && currentSceneOption?.preview) {
        return { backgroundImage: currentSceneOption.preview };
      }
      if (n.name === "Back") {
        currentSceneOption = null;
        return { onClick: () => navigate("main") };
      }
      return null;
    };
    renderUnityPanelFlat(drivePanel, root, driveResolver);
    ui.menuPageLayer.appendChild(root);
    return;
  }

  const root = document.createElement("div");
  root.className = "menu-page menu-page-drive-select";

  const band = document.createElement("div");
  band.className = "drive-select-band";

  const sceneRail = document.createElement("div");
  sceneRail.className = "drive-scene-rail";

  options.forEach((option) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `drive-scene-card ${option.variantClass}${option.buildIndex === save.selectedScene ? " is-active" : ""}`;
    card.setAttribute("aria-pressed", option.buildIndex === save.selectedScene ? "true" : "false");
    card.addEventListener("click", () => {
      save.selectedScene = option.buildIndex;
      state.missionId = "free";
      persist();
      navigate("game");
    });

    const label = document.createElement("span");
    label.className = "drive-scene-label";
    label.textContent = option.title;

    const frame = document.createElement("span");
    frame.className = "drive-scene-frame";

    const preview = document.createElement("span");
    preview.className = "drive-scene-preview";
    preview.style.backgroundImage = `url("${option.preview}")`;
    frame.appendChild(preview);

    card.append(label, frame);
    sceneRail.appendChild(card);
  });

  band.appendChild(sceneRail);
  root.appendChild(band);

  const onlineBtn = document.createElement("button");
  onlineBtn.type = "button";
  onlineBtn.className = "drive-online-btn";
  onlineBtn.textContent = "ONLINE";
  onlineBtn.addEventListener("click", () => {
    state.missionId = "free";
    navigate("game");
  });

  const selector = document.createElement("div");
  selector.className = "drive-online-indicator";
  selector.innerHTML = `<span class="drive-online-indicator-dot" aria-hidden="true"></span>`;

  root.append(selector, onlineBtn, menuOverlayButton("<-- BACK", "unity-back-btn", () => navigate("main")));
  ui.menuPageLayer.appendChild(root);
}

function renderSettings() {
  setSceneText("Menu_Settings", "SETTINGS", "Unity-style in-scene settings layout.");
  clearMenuPageLayer();
  ui.panel.replaceChildren();

  // Unity-aligned chrome: baked Menu_Settings tree for graphics quality
  // buttons (Low/Med/High/Ultra), audio/music sliders, Image FX / Shadows
  // toggles, and Back. The Unity prefab does not have sliders for
  // drawDistance/rtLights/trafficIntensity or an autoHandbrake toggle —
  // those stay as a runtime overlay so the port doesn't downgrade the
  // existing feature set. Rebind grid is rendered as dead visuals for
  // now (no input-system port yet).
  const GRAPHICS_QUALITIES = { Low: "low", Med: "med", High: "high", Ultra: "ultra" };
  const settingsPanel = MAIN_MENU_UI.panels?.settings;
  if (settingsPanel) {
    const root = document.createElement("div");
    root.className = "menu-page menu-page-settings unity-panel-root";
    root.style.position = "absolute";
    root.style.inset = "0";

    // Track the baked rects for Slider_Audio/Music so we can overlay a
    // real <input type=range> aligned to them.
    const sliderRects = {};

    const resolver = (n) => {
      if (GRAPHICS_QUALITIES[n.name]) {
        const quality = GRAPHICS_QUALITIES[n.name];
        return {
          onClick: () => {
            save.graphicsQuality = quality;
            persist();
            render();
          },
          active: save.graphicsQuality === quality
        };
      }
      if (n.name === "Slider_Audio") {
        sliderRects.audioVolume = n.rect;
        return { hidden: true };
      }
      if (n.name === "Slider_Music") {
        sliderRects.musicVolume = n.rect;
        return { hidden: true };
      }
      if (n.name === "Image FX") {
        return {
          onClick: () => toggleSetting("imageEffects"),
          active: save.imageEffects
        };
      }
      if (n.name === "Shadows") {
        return {
          onClick: () => toggleSetting("shadows"),
          active: save.shadows
        };
      }
      if (n.name === "Back") {
        return { onClick: () => navigate("main") };
      }
      // Rebind grid is runtime-state — render as dead visuals (no handler,
      // no interaction) until an input-system port exists.
      return null;
    };
    renderUnityPanelFlat(settingsPanel, root, resolver);

    // Overlay real range inputs on top of the baked slider rects.
    const placeSlider = (rect, key) => {
      if (!rect) return;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "1";
      input.step = "0.01";
      input.value = String(save[key]);
      input.className = "unity-panel-runtime-slider";
      input.style.position = "absolute";
      input.style.left = `${rect.left}px`;
      input.style.top = `${rect.top}px`;
      input.style.width = `${rect.width}px`;
      input.style.height = `${rect.height}px`;
      input.addEventListener("input", () => {
        save[key] = Number(input.value);
        persist();
      });
      root.appendChild(input);
    };
    placeSlider(sliderRects.audioVolume, "audioVolume");
    placeSlider(sliderRects.musicVolume, "musicVolume");

    // Runtime overlay for features that aren't in the Unity prefab:
    // drawDistance/rtLights/trafficIntensity sliders + autoHandbrake.
    // Parked beneath the Content block to avoid overlapping the baked
    // Unity chrome.
    const extras = document.createElement("div");
    extras.className = "unity-panel-runtime-extras";
    extras.style.position = "absolute";
    extras.style.left = "211px";
    extras.style.top = "745px";
    extras.style.width = "1499px";
    extras.style.display = "flex";
    extras.style.gap = "12px";
    extras.style.alignItems = "center";
    extras.style.color = "#fff";
    extras.style.fontSize = "14px";
    [
      ["DRAW DIST", "drawDistance"],
      ["RT LIGHTS", "rtLights"],
      ["TRAFFIC", "trafficIntensity"]
    ].forEach(([label, key]) => {
      const block = document.createElement("label");
      block.style.display = "flex";
      block.style.flexDirection = "column";
      block.innerHTML = `<span>${label}</span>`;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "1";
      input.step = "0.01";
      input.value = String(save[key]);
      input.addEventListener("input", () => {
        save[key] = Number(input.value);
        persist();
      });
      block.appendChild(input);
      extras.appendChild(block);
    });
    extras.appendChild(menuOverlayButton(
      `AUTO HANDBRAKE ${save.autoHandbrake ? "ON" : "OFF"}`,
      "unity-green-toggle",
      () => {
        save.autoHandbrake = !save.autoHandbrake;
        persist();
        render();
      },
      save.autoHandbrake
    ));
    root.appendChild(extras);

    ui.menuPageLayer.appendChild(root);
    return;
  }

  const root = document.createElement("div");
  root.className = "menu-page menu-page-settings";
  const legacyPanel = document.createElement("div");
  legacyPanel.className = "unity-settings-panel";

  const qualityRow = document.createElement("div");
  qualityRow.className = "unity-quality-row";
  qualityRow.appendChild(document.createElement("span")).textContent = "GRAPHICS";
  ["low", "med", "high", "ultra"].forEach((quality) => {
    qualityRow.appendChild(menuOverlayButton(quality.toUpperCase(), "unity-quality-btn", () => {
      save.graphicsQuality = quality;
      persist();
      render();
    }, save.graphicsQuality === quality));
  });
  legacyPanel.appendChild(qualityRow);

  const sliderGrid = document.createElement("div");
  sliderGrid.className = "unity-slider-grid";
  [
    ["AUDIO", "audioVolume"],
    ["MUSIC", "musicVolume"],
    ["DRAW DISTANCE", "drawDistance"],
    ["RT LIGHTS", "rtLights"],
    ["TRAFFIC INTENSITY", "trafficIntensity"]
  ].forEach(([label, key]) => {
    const block = document.createElement("label");
    block.className = "unity-slider-block";
    block.innerHTML = `<span>${label}</span>`;
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(save[key]);
    input.addEventListener("input", () => {
      save[key] = Number(input.value);
      persist();
      render();
    });
    block.appendChild(input);
    sliderGrid.appendChild(block);
  });
  legacyPanel.appendChild(sliderGrid);

  const toggleRow = document.createElement("div");
  toggleRow.className = "unity-settings-toggle-row";
  toggleRow.append(
    menuOverlayButton(`IMAGE EFFECTS ${save.imageEffects ? "ON" : "OFF"}`, "unity-green-toggle", () => toggleSetting("imageEffects"), save.imageEffects),
    menuOverlayButton(`SHADOWS ${save.shadows ? "ON" : "OFF"}`, "unity-green-toggle", () => toggleSetting("shadows"), save.shadows),
    menuOverlayButton(`AUTO HANDBRAKE ${save.autoHandbrake ? "ON" : "OFF"}`, "unity-green-toggle", () => {
      save.autoHandbrake = !save.autoHandbrake;
      persist();
      render();
    }, save.autoHandbrake)
  );
  legacyPanel.appendChild(toggleRow);
  root.append(legacyPanel, menuOverlayButton("<-- BACK", "unity-back-btn", () => navigate("main")));
  ui.menuPageLayer.appendChild(root);
}

function renderGame() {
  setSceneText("Gameplay", currentMission().name, `Scene: ${currentScene()?.label || "Unknown"} | Objective: ${currentMission().desc}`);
  world.road.visible = false;
  world.grass.visible = false;
  world.pad.visible = false;
  controls.enabled = false;
  clearMenuPageLayer();
  ui.panel.replaceChildren();
  ensureGameplayHud();
  focusGameplayViewport();
}

function renderPanel() {
  if (state.route === "garage") return renderGarage();
  if (state.route === "customize") return renderCustomize();
  if (state.route === "mission") return renderMission();
  if (state.route === "settings") return renderSettings();
  if (state.route === "game") return renderGame();
  return renderMain();
}

export function render() {
  updateHeader();
  setPresentationMode();
  syncViewportSize();
  applyUnityMenuLayout();
  applyUnityGameplayLayout();
  renderPanel();
  updateHud();
  syncMainMenuPanels();
}
