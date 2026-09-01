// Global keyboard capture for the gameplay viewport.
//
// Ported from the inline input section of main.js. Gameplay capture
// prevents WASD/arrow/space from triggering browser scrolling while
// the player is driving. Side-effect on import: NONE. Call
// `installInputListeners()` from `bootstrap()` to wire the DOM events.

import { keys, state } from "../core/state.js";
import { renderer } from "../scene/World.js";

export const GAMEPLAY_CAPTURE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "KeyL",
  "ShiftLeft",
  "KeyN",
  "KeyM",
  "KeyP"
]);

export function normalizeKeyIds(event) {
  const ids = new Set();
  if (event.code) ids.add(event.code);
  if (typeof event.key === "string" && event.key) {
    if (event.key.length === 1) ids.add(`Key${event.key.toUpperCase()}`);
    else ids.add(event.key);
  }
  return ids;
}

export function syncKeyState(event, pressed) {
  normalizeKeyIds(event).forEach((id) => keys.set(id, pressed));
}

export function clearPressedKeys() {
  keys.clear();
}

export function focusGameplayViewport() {
  if (state.route !== "game") return;
  try {
    renderer.domElement.focus({ preventScroll: true });
  } catch {
    renderer.domElement.focus();
  }
}

export function shouldCaptureGameplayKey(event) {
  if (state.route !== "game") return false;
  for (const id of normalizeKeyIds(event)) {
    if (GAMEPLAY_CAPTURE_KEYS.has(id)) return true;
  }
  return false;
}

export function handleGlobalKeyDown(event) {
  syncKeyState(event, true);
  if (shouldCaptureGameplayKey(event)) event.preventDefault();
}

export function handleGlobalKeyUp(event) {
  syncKeyState(event, false);
  if (shouldCaptureGameplayKey(event)) event.preventDefault();
}

export function installInputListeners() {
  window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
  window.addEventListener("keyup", handleGlobalKeyUp, { capture: true });
  document.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
  document.addEventListener("keyup", handleGlobalKeyUp, { capture: true });
  renderer.domElement.addEventListener("keydown", handleGlobalKeyDown);
  renderer.domElement.addEventListener("keyup", handleGlobalKeyUp);
  window.addEventListener("blur", clearPressedKeys);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearPressedKeys();
  });
}
