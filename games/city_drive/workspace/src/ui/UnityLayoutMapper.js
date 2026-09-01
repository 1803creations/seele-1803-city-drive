// Unity UGUI → CSS layout mapper.
//
// Ported from the inline UI-layout section of main.js. This module is
// DOM-only: it reads the Unity RectTransform / Canvas scaler data from
// `MAIN_MENU_UI` and pushes CSS custom properties onto the DOM elements
// cached in `core/state.ui`. No physics, no scene, no rendering state.
//
// Side effects on import: none. Callers (main.js during bootstrap +
// window resize handler) drive everything.

import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { normalizeUiToken, rootAssetUrl } from "../core/utils.js";
import { MAIN_MENU_UI, GAMEPLAY_UI, UNITY_GAMEPLAY_REFERENCE } from "../core/config.js";
import { ui, tgaUiCache, save, state } from "../core/state.js";
import { renderer, camera } from "../scene/World.js";

// --- CSS variable + sprite skinning ----------------------------------------

export function applyUiSkin() {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--ui-button-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_Button.png")}")`);
  rootStyle.setProperty("--ui-button-fade-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_ButtonFade.png")}")`);
  rootStyle.setProperty("--ui-item-background-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_ItemBackground.png")}")`);
  rootStyle.setProperty("--ui-label-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_LabelBackground.png")}")`);
  rootStyle.setProperty("--ui-vignette-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_Vignette.png")}")`);
  rootStyle.setProperty("--ui-money-image", `url("${rootAssetUrl("Textures/UI/CCDS_Icon_Money.png")}")`);
  rootStyle.setProperty("--ui-marker-image", `url("${rootAssetUrl("Textures/UI/CCDS_Marker.png")}")`);
  rootStyle.setProperty("--ui-gradient-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_Gradient.png")}")`);
  rootStyle.setProperty("--ui-vertical-slider-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_VerticalSliderCutted.png")}")`);
  rootStyle.setProperty("--ui-time-image", `url("${rootAssetUrl("Textures/UI/CCDS_Icon_Time.png")}")`);
  rootStyle.setProperty("--ui-percent-image", `url("${rootAssetUrl("Textures/UI/CCDS_UI_Percentage.png")}")`);
  rootStyle.setProperty("--ui-rccp-image", `url("${rootAssetUrl("Textures/UI/RCCP_Sprite.png")}")`);
  rootStyle.setProperty("--ui-speedometer-image", "none");
  applyTgaUiSkin("--ui-speedometer-image", "Textures/UI/Speedometer.tga");
  const utilityOff = MAIN_MENU_UI.utilityBar?.items?.[1]?.offSprite?.assetPath || MAIN_MENU_UI.utilityBar?.items?.[0]?.offSprite?.assetPath;
  const utilityOn = MAIN_MENU_UI.utilityBar?.items?.[1]?.onSprite?.assetPath || MAIN_MENU_UI.utilityBar?.items?.[2]?.onSprite?.assetPath;
  const profileFrame = MAIN_MENU_UI.profilePanel?.frameSprite?.assetPath;
  const profilePanel = MAIN_MENU_UI.profilePanel?.panelSprite?.assetPath;
  const profileInputBg = MAIN_MENU_UI.profilePanel?.inputBackgroundSprite?.assetPath;
  const profileInputLine = MAIN_MENU_UI.profilePanel?.inputUnderlineSprite?.assetPath;
  const profileSubmit = MAIN_MENU_UI.profilePanel?.submitSprite?.assetPath;
  const profileSubmitFade = MAIN_MENU_UI.profilePanel?.submitFadeSprite?.assetPath;
  const setColorVar = (name, color, fallbackAlpha = 1) => {
    if (!color) return;
    const r = Math.round((color.r ?? 1) * 255);
    const g = Math.round((color.g ?? 1) * 255);
    const b = Math.round((color.b ?? 1) * 255);
    const a = color.a ?? fallbackAlpha;
    rootStyle.setProperty(name, `rgba(${r}, ${g}, ${b}, ${a})`);
  };
  if (utilityOff) rootStyle.setProperty("--utility-off-image", `url("${rootAssetUrl(utilityOff)}")`);
  if (utilityOn) rootStyle.setProperty("--utility-on-image", `url("${rootAssetUrl(utilityOn)}")`);
  if (profileFrame) rootStyle.setProperty("--profile-frame-image", `url("${rootAssetUrl(profileFrame)}")`);
  if (profilePanel) rootStyle.setProperty("--profile-panel-image", `url("${rootAssetUrl(profilePanel)}")`);
  if (profileInputBg) rootStyle.setProperty("--profile-input-bg-image", `url("${rootAssetUrl(profileInputBg)}")`);
  if (profileInputLine) rootStyle.setProperty("--profile-input-line-image", `url("${rootAssetUrl(profileInputLine)}")`);
  if (profileSubmit) rootStyle.setProperty("--profile-submit-image", `url("${rootAssetUrl(profileSubmit)}")`);
  if (profileSubmitFade) rootStyle.setProperty("--profile-submit-fade-image", `url("${rootAssetUrl(profileSubmitFade)}")`);
  setColorVar("--utility-off-tint", MAIN_MENU_UI.utilityBar?.items?.[1]?.offSprite?.color);
  setColorVar("--utility-on-tint", MAIN_MENU_UI.utilityBar?.items?.[1]?.onSprite?.color);
  setColorVar("--profile-frame-tint", MAIN_MENU_UI.profilePanel?.frameSprite?.color);
  setColorVar("--profile-panel-tint", MAIN_MENU_UI.profilePanel?.panelSprite?.color);
  setColorVar("--profile-input-bg-tint", MAIN_MENU_UI.profilePanel?.inputBackgroundSprite?.color);
  setColorVar("--profile-input-line-tint", MAIN_MENU_UI.profilePanel?.inputUnderlineSprite?.color);
  setColorVar("--profile-submit-tint", MAIN_MENU_UI.profilePanel?.submitSprite?.color);
  setColorVar("--profile-submit-fade-tint", MAIN_MENU_UI.profilePanel?.submitFadeSprite?.color);
}

export function applyTgaUiSkin(cssVarName, relativePath) {
  const cached = tgaUiCache.get(relativePath);
  if (cached) {
    document.documentElement.style.setProperty(cssVarName, `url("${cached}")`);
    return;
  }

  const loader = new TGALoader();
  loader.load(rootAssetUrl(relativePath), (texture) => {
    const image = texture.image;
    if (!image?.data || !image.width || !image.height) return;

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0
    );

    const dataUrl = canvas.toDataURL("image/png");
    tgaUiCache.set(relativePath, dataUrl);
    document.documentElement.style.setProperty(cssVarName, `url("${dataUrl}")`);
  });
}

// --- Unity UGUI rect → CSS edge conversion ---------------------------------

export function findMainMenuButtonLabel(keyword) {
  return MAIN_MENU_UI.menuMain?.bottomBar?.buttons?.find((button) => normalizeUiToken(button.label) === normalizeUiToken(keyword))?.label ?? keyword;
}

export function findTestingButtonLabel(keyword) {
  return MAIN_MENU_UI.menuMain?.testingPanel?.buttons?.find((button) => normalizeUiToken(button.label) === normalizeUiToken(keyword))?.label ?? keyword;
}

export function resolveUnityRectEdges(layout, reference = { x: 1920, y: 1080 }) {
  if (!layout) return null;
  const width = layout.sizeDelta?.x ?? 0;
  const height = layout.sizeDelta?.y ?? 0;
  const minX = layout.anchorMin?.x ?? 0;
  const maxX = layout.anchorMax?.x ?? minX;
  const minY = layout.anchorMin?.y ?? 0;
  const maxY = layout.anchorMax?.y ?? minY;
  const pivotX = layout.pivot?.x ?? 0.5;
  const pivotY = layout.pivot?.y ?? 0.5;
  const anchoredX = layout.anchoredPosition?.x ?? 0;
  const anchoredY = layout.anchoredPosition?.y ?? 0;
  const anchorCenterX = ((minX + maxX) * 0.5) * reference.x;
  const anchorCenterY = ((minY + maxY) * 0.5) * reference.y;
  const centerX = anchorCenterX + anchoredX;
  const centerY = anchorCenterY + anchoredY;
  const left = centerX - width * pivotX;
  const right = reference.x - (left + width);
  const bottom = centerY - height * pivotY;
  const top = reference.y - (bottom + height);
  return { left, right, top, bottom, width, height };
}

export function syncViewportSize() {
  const width = Math.max(1, ui.root.clientWidth);
  const height = Math.max(1, ui.root.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

export function applyUnityMenuLayout() {
  const reference = MAIN_MENU_UI.canvasScaler?.referenceResolution || { x: 1920, y: 1080 };
  const scale = Math.min(ui.root.clientWidth / reference.x, ui.root.clientHeight / reference.y);
  const style = ui.mainMenuUi.style;
  style.setProperty("--unity-menu-width", `${reference.x}px`);
  style.setProperty("--unity-menu-height", `${reference.y}px`);
  style.setProperty("--unity-menu-scale", `${scale || 1}`);

  const topBar = resolveUnityRectEdges(MAIN_MENU_UI.topBar?.layout, reference);
  const leftBanner = resolveUnityRectEdges(MAIN_MENU_UI.topBar?.sections?.[1]?.layout, reference);
  const rightBanner = resolveUnityRectEdges(MAIN_MENU_UI.topBar?.sections?.[2]?.layout, reference);
  const bottomBar = resolveUnityRectEdges(MAIN_MENU_UI.menuMain?.bottomBar?.layout, reference);
  const actionLayout = MAIN_MENU_UI.menuMain?.bottomBar?.buttons?.[0]?.layout || null;
  const actionWidth = actionLayout?.sizeDelta?.x ?? 375;
  const actionHeight = actionLayout?.sizeDelta?.y ?? 87.3398;
  const actionGap = bottomBar ? Math.max(0, (reference.x - actionWidth * 5) / 4) : 12;
  const testingButtons = resolveUnityRectEdges(MAIN_MENU_UI.menuMain?.testingPanel?.buttonsContainerLayout, reference);
  const testingToggle = resolveUnityRectEdges(MAIN_MENU_UI.menuMain?.testingPanel?.toggleCloseLayout, reference);
  const utilityBar = resolveUnityRectEdges(MAIN_MENU_UI.utilityBar?.layout, reference);
  const utilityItem = resolveUnityRectEdges(MAIN_MENU_UI.utilityBar?.items?.[0]?.layout, reference);
  const profilePanel = resolveUnityRectEdges(MAIN_MENU_UI.profilePanel?.panelLayout, reference);
  const profileSubmit = resolveUnityRectEdges(MAIN_MENU_UI.profilePanel?.submitLayout, reference);
  const testingHeight = Math.max(
    testingButtons ? testingButtons.bottom + testingButtons.height : 0,
    testingToggle ? testingToggle.bottom + testingToggle.height : 0
  );

  if (topBar) {
    style.setProperty("--main-menu-topbar-top", `${topBar.top}px`);
    style.setProperty("--main-menu-topbar-height", `${topBar.height}px`);
  }
  if (leftBanner) {
    style.setProperty("--main-menu-banner-width", `${leftBanner.width}px`);
    style.setProperty("--main-menu-banner-height", `${leftBanner.height}px`);
  }
  if (rightBanner) {
    style.setProperty("--main-menu-right-banner-width", `${rightBanner.width}px`);
  }
  if (bottomBar) {
    style.setProperty("--main-menu-nav-bottom", `${bottomBar.bottom}px`);
    style.setProperty("--main-menu-nav-height", `${actionHeight}px`);
  }
  style.setProperty("--main-menu-action-width", `${actionWidth}px`);
  style.setProperty("--main-menu-action-height", `${actionHeight}px`);
  style.setProperty("--main-menu-action-gap", `${actionGap}px`);
  if (utilityBar) {
    style.setProperty("--utility-bar-left", `${utilityBar.left}px`);
    style.setProperty("--utility-bar-bottom", `${utilityBar.bottom}px`);
  }
  if (utilityItem) {
    style.setProperty("--utility-item-width", `${utilityItem.width}px`);
  }
  if (profilePanel) {
    style.setProperty("--profile-panel-height", `${profilePanel.height}px`);
  }
  if (profileSubmit) {
    style.setProperty("--profile-submit-width", `${profileSubmit.width}px`);
    style.setProperty("--profile-submit-height", `${profileSubmit.height}px`);
  }

  if (testingButtons) {
    style.setProperty("--testing-panel-left", `${testingButtons.left}px`);
    style.setProperty("--testing-panel-bottom", `${testingButtons.bottom}px`);
    style.setProperty("--testing-panel-width", `${testingButtons.width}px`);
    style.setProperty("--testing-panel-height", `${testingButtons.height}px`);
  }
  if (testingToggle) {
    style.setProperty("--testing-toggle-left", `${testingToggle.left}px`);
    style.setProperty("--testing-toggle-bottom", `${testingToggle.bottom}px`);
    style.setProperty("--testing-toggle-size", `${testingToggle.width}px`);
  }
  style.setProperty("--testing-side-height", `${testingHeight || 447}px`);
}

// The gameplay HUD's panel positions are baked into ccdsData.gameplayUi at
// extract time (each entry is `{left, top, width, height}` in the canvas
// reference frame, computed by walking the prefab parent chain). Here we
// simply forward those rects into CSS custom properties and let the static
// stylesheet do the work.
export function applyUnityGameplayLayout() {
  const reference = GAMEPLAY_UI.canvasScaler?.referenceResolution || UNITY_GAMEPLAY_REFERENCE;
  const scale = Math.min(
    Math.max(1, ui.root.clientWidth) / reference.x,
    Math.max(1, ui.root.clientHeight) / reference.y
  );
  const style = ui.hud?.style;
  if (!style) return;
  style.setProperty("--unity-gameplay-width", `${reference.x}px`);
  style.setProperty("--unity-gameplay-height", `${reference.y}px`);
  style.setProperty("--unity-gameplay-scale", `${scale || 1}`);

  const setRectVars = (prefix, rect) => {
    if (!rect) return;
    style.setProperty(`--${prefix}-left`, `${rect.left}px`);
    style.setProperty(`--${prefix}-top`, `${rect.top}px`);
    style.setProperty(`--${prefix}-width`, `${rect.width}px`);
    style.setProperty(`--${prefix}-height`, `${rect.height}px`);
  };

  const setScaleVars = (prefix, scale) => {
    if (!scale) return;
    style.setProperty(`--${prefix}-scale-x`, scale.x ?? 1);
    style.setProperty(`--${prefix}-scale-y`, scale.y ?? 1);
  };

  setRectVars("gauge", GAMEPLAY_UI.gauge?.rect);
  setRectVars("felony", GAMEPLAY_UI.gauge?.felony?.rect);
  setScaleVars("felony", GAMEPLAY_UI.gauge?.felony?.localScale);
  setRectVars("stats", GAMEPLAY_UI.stats?.rect);
  setRectVars("health", GAMEPLAY_UI.stats?.health?.rect);
  setScaleVars("health", GAMEPLAY_UI.stats?.health?.localScale);
  setRectVars("stats-buttons", GAMEPLAY_UI.stats?.buttons?.rect);
  setScaleVars("stats-buttons", GAMEPLAY_UI.stats?.buttons?.localScale);
  setRectVars("stats-money", GAMEPLAY_UI.stats?.money?.rect);
  setScaleVars("stats-money", GAMEPLAY_UI.stats?.money?.localScale);
  setRectVars("minimap", GAMEPLAY_UI.minimap?.rect);
  if (GAMEPLAY_UI.minimap?.rect) {
    const rect = GAMEPLAY_UI.minimap.rect;
    style.setProperty("--minimap-width", `${Math.round(rect.width * 1.28)}px`);
    style.setProperty("--minimap-height", `${Math.round(rect.height * 1.28)}px`);
  }
}

export function applyUnityMenuText() {
  const brandLines = MAIN_MENU_UI.topBar?.brandTextLines || [];
  if (brandLines[0]) {
    document.title = "City Drive — Open City Driving";
    ui.brandLine1.textContent = "CITY DRIVE | OPEN CITY DRIVING";
  }
  if (brandLines[1]) ui.brandLine2.textContent = "EXPLORE";
  if (brandLines[2]) ui.brandLine3.textContent = "DRIVE FREE";
  if (MAIN_MENU_UI.topBar?.titleText) ui.mainMenuMode.textContent = MAIN_MENU_UI.topBar.titleText.toUpperCase();
  if (MAIN_MENU_UI.menuMain?.testingPanel?.title) ui.testingTitle.textContent = MAIN_MENU_UI.menuMain.testingPanel.title;
  if (MAIN_MENU_UI.menuMain?.testingPanel?.toggleClose) ui.testingToggle.textContent = MAIN_MENU_UI.menuMain.testingPanel.toggleClose;
  ui.driveBtn.textContent = findMainMenuButtonLabel("Drive").toUpperCase();
  ui.vehiclesBtn.textContent = findMainMenuButtonLabel("Vehicles").toUpperCase();
  ui.customizeBtn.textContent = findMainMenuButtonLabel("Customization").toUpperCase();
  ui.settingsBtn.textContent = findMainMenuButtonLabel("Settings").toUpperCase();
  ui.quitBtn.textContent = findMainMenuButtonLabel("Quit").toUpperCase();
  ui.addMoney.textContent = findTestingButtonLabel("Add Money").toUpperCase();
  ui.unlockCars.textContent = findTestingButtonLabel("Unlock All Cars").toUpperCase();
  ui.resetSave.textContent = findTestingButtonLabel("Reset Save").toUpperCase();
  ui.utilityControlsBtn.textContent = (MAIN_MENU_UI.utilityBar?.items?.[0]?.label || "Controls").toUpperCase();
  ui.utilityImageFxBtn.textContent = (MAIN_MENU_UI.utilityBar?.items?.[1]?.label || "Image Effects").toUpperCase();
  ui.utilityShadowsBtn.textContent = (MAIN_MENU_UI.utilityBar?.items?.[2]?.label || "Shadows").toUpperCase();
  ui.profilePanelTitle.textContent = (MAIN_MENU_UI.profilePanel?.titleText || "Welcome!").toUpperCase();
  ui.profilePanelCopy.textContent = "Welcome to Open City Drive!";
  ui.profileNameInput.placeholder = MAIN_MENU_UI.profilePanel?.playerNamePlaceholder || "New Player Name";
  ui.profileSubmitBtn.textContent = (MAIN_MENU_UI.profilePanel?.submitLabel || "Submit").toUpperCase();
}

export function syncMainMenuPanels() {
  const showProfilePanel = state.route === "main" && save.firstGameplay;
  ui.profilePanel?.classList.toggle("is-hidden", !showProfilePanel);
  ui.utilityBar?.classList.toggle("is-profile-open", showProfilePanel);
}
