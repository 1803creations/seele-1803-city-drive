// Shared DOM helpers for building menu pages.
//
// Ported from the inline dom-helpers section of main.js. Pure DOM
// primitives + the scene-text setter. No DI — writes into the
// already-initialized `ui` singleton from core/state.

import { ui } from "../core/state.js";
import { rootAssetUrl } from "../core/utils.js";

export function setSceneText(kicker, title, desc) {
  ui.kicker.textContent = kicker;
  ui.title.textContent = title;
  ui.desc.textContent = desc;
}

export function button(label, cls, fn) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = cls;
  element.textContent = label;
  element.addEventListener("click", fn);
  return element;
}

export function menuOverlayButton(label, cls, fn, active = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = `${cls}${active ? " is-active" : ""}`;
  element.textContent = label;
  element.addEventListener("click", fn);
  return element;
}

export function createStatMeter(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "unity-meter";
  wrap.innerHTML = `<span>${label}</span><div class="unity-meter-bar"><i style="width:${Math.max(12, Math.min(100, value))}%"></i></div>`;
  return wrap;
}

export function clearMenuPageLayer() {
  ui.menuPageLayer?.replaceChildren();
}

// Render a Unity-baked panel tree (from ccdsData.mainMenuUi.panels.*) as
// flat absolutely-positioned divs in canvas-pixel space. The panel is
// dropped into the parent which is expected to be `.main-menu-canvas`'s
// child layer (transformed by --unity-menu-scale) — child rects are
// already world-baked so each div positions itself directly in the 1920×
// 1080 reference frame.
//
// `resolver` is either a `{[nodeName]: handler}` map (convenient for the
// simple cases) or a function `(node) => { onClick?, active?, hidden?, rectOverride? }`
// returning an interaction descriptor. The callback form lets callers
// dispatch by text content (useful for clone-named TMP buttons like the
// customization tab row, where Unity uses "Button"/"Button (1)"/etc.)
// and per-node visibility overrides (for conditional reveal of elements
// that share the same prefab rect). `rectOverride` lets callers resize
// or reposition a node's rect at render time (needed to runtime-drive
// fill bars whose prefab rect is baked at max width) — supports
// absolute `{left, top, width, height}` or relative `{widthScale,
// heightScale}` multipliers applied to the prefab rect.
export function renderUnityPanelFlat(node, container, resolver = {}) {
  if (!node) return;
  const resolve = typeof resolver === "function"
    ? resolver
    : (n) => (resolver[n.name] ? { onClick: resolver[n.name] } : null);
  // Unity stores menu panels as SetActive(false) in the prefab and turns
  // them on at runtime when the player navigates in. The caller has
  // already decided to render this panel, so treat the top-level node as
  // implicitly active — only honor `active === false` on descendants.
  // Descriptors can also set `forceActive: true` to opt a specific
  // subtree back in (needed to render customization tab panels, which
  // live under a `Panels` container that Unity keeps inactive in the
  // prefab and toggles per-tab at runtime).
  const visit = (n, isRoot) => {
    if (!n) return;
    const descriptor = resolve(n) || null;
    if (descriptor?.hidden) return;
    if (!isRoot && n.active === false && !descriptor?.forceActive) return;
    const prefabRect = n.rect;
    const override = descriptor?.rectOverride;
    const rect = override
      ? {
          left: override.left ?? prefabRect?.left ?? 0,
          top: override.top ?? prefabRect?.top ?? 0,
          width: override.width ?? (prefabRect?.width ?? 0) * (override.widthScale ?? 1),
          height: override.height ?? (prefabRect?.height ?? 0) * (override.heightScale ?? 1)
        }
      : prefabRect;
    if (rect && (rect.width > 0 || rect.height > 0)) {
      const handler = descriptor?.onClick;
      const el = document.createElement(handler ? "button" : "div");
      if (handler) {
        el.type = "button";
        el.addEventListener("click", handler);
      }
      el.className = `unity-panel-node unity-panel-node--${n.name.replace(/[^a-zA-Z0-9_-]/g, "_")}${descriptor?.active ? " is-active" : ""}`;
      const s = el.style;
      s.position = "absolute";
      s.left = `${rect.left}px`;
      s.top = `${rect.top}px`;
      s.width = `${rect.width}px`;
      s.height = `${rect.height}px`;
      s.pointerEvents = handler ? "auto" : "none";
      if (handler) {
        s.background = "transparent";
        s.border = "none";
        s.padding = "0";
        s.cursor = "pointer";
      }
      if (n.sprite?.assetPath && !descriptor?.label && !descriptor?.backgroundImage) {
        s.backgroundImage = `url("${rootAssetUrl(n.sprite.assetPath)}")`;
        s.backgroundSize = "100% 100%";
        s.backgroundRepeat = "no-repeat";
        if (n.sprite.color) {
          const { r = 1, g = 1, b = 1, a = 1 } = n.sprite.color;
          s.opacity = String(a);
          // Approximate RGB tint via a blended background-color overlay
          // (UGUI multiplies sprite pixels by tint; we can't do that in
          // CSS without a canvas pass, but this gets close for flat UI).
          if (r !== 1 || g !== 1 || b !== 1) {
            const r8 = Math.round(r * 255);
            const g8 = Math.round(g * 255);
            const b8 = Math.round(b * 255);
            s.backgroundBlendMode = "multiply";
            s.backgroundColor = `rgb(${r8}, ${g8}, ${b8})`;
          }
        }
      }
      // Descriptor-supplied background image override. Used for nodes
      // whose sprite is bound at runtime in Unity (e.g. Scene_City_N's
      // Image child gets its preview texture injected by the menu
      // controller — the prefab sprite field is empty). Takes a ready-
      // to-use URL (already wrapped by rootAssetUrl at the caller site).
      if (descriptor?.backgroundImage) {
        s.backgroundImage = `url("${descriptor.backgroundImage}")`;
        s.backgroundSize = descriptor.backgroundSize || "cover";
        s.backgroundPosition = "center";
        s.backgroundRepeat = "no-repeat";
      }
      // Descriptor-supplied glyph/text fallback. Used when the prefab
      // sprite is an atlas entry we can't slice yet (Button_Previous /
      // Button_Next live inside RCCP_Sprite.png). Replaces the sprite
      // background entirely so the atlas doesn't render garbled underneath.
      if (descriptor?.label && !n.text) {
        const lbl = document.createElement("span");
        lbl.className = "unity-panel-node-text unity-panel-node-label-fallback";
        lbl.textContent = descriptor.label;
        lbl.style.position = "absolute";
        lbl.style.inset = "0";
        lbl.style.display = "flex";
        lbl.style.alignItems = "center";
        lbl.style.justifyContent = "center";
        lbl.style.color = descriptor.labelColor || "#ffcf4c";
        lbl.style.fontSize = `${descriptor.labelFontSize || 72}px`;
        lbl.style.fontWeight = "700";
        lbl.style.textShadow = "0 2px 6px rgba(0,0,0,0.85)";
        lbl.style.pointerEvents = "none";
        el.appendChild(lbl);
      }
      if (n.text) {
        const label = document.createElement("span");
        label.className = "unity-panel-node-text";
        label.textContent = descriptor?.textOverride ?? n.text;
        label.style.position = "absolute";
        label.style.inset = "0";
        label.style.display = "flex";
        label.style.alignItems = "center";
        // TMP HorizontalAlignmentOptions: 1=Left, 2=Center, 4=Right.
        const ha = n.textStyle?.horizontal ?? 2;
        label.style.justifyContent = ha === 1 ? "flex-start" : ha === 4 ? "flex-end" : "center";
        if (n.textStyle?.color) {
          const { r = 1, g = 1, b = 1, a = 1 } = n.textStyle.color;
          label.style.color = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
        } else {
          label.style.color = "#fff";
        }
        label.style.fontSize = `${n.textStyle?.fontSize ?? 24}px`;
        // TMP fontStyle bitflags: 1=Bold, 2=Italic, 4=Underline, 16=Upper.
        const fs = n.textStyle?.fontStyle ?? 0;
        if (fs & 1) label.style.fontWeight = "700";
        if (fs & 2) label.style.fontStyle = "italic";
        if (fs & 4) label.style.textDecoration = "underline";
        if (fs & 16) label.style.textTransform = "uppercase";
        label.style.textShadow = "0 1px 2px rgba(0,0,0,0.6)";
        el.appendChild(label);
      }
      // Descriptor-supplied raw style overrides. Applied last so it wins
      // over sprite/tint/backgroundImage rendering — lets callers render
      // nodes like paint swatches as pure-CSS circles with gradient
      // highlights, bypassing the flat-rect sprite tint entirely.
      if (descriptor?.style) Object.assign(el.style, descriptor.style);
      container.appendChild(el);
    }
    if (n.children) for (const c of n.children) visit(c, false);
  };
  visit(node, true);
}
