# City Drive — project note

## User Delta Ledger
- Raw user request: Create a playable Three.js city driving game with vehicle selection and open-city free driving.
- Template selected: `threejs-car-driving` bundled starter.
- Starter features kept: vehicle garage/selection, paint and wheel customization, open-city free drive, traffic/police behavior, missions, driving HUD, audio, city scene, Rapier physics, persistent save.
- Starter features modified: visible branding and title text changed to generic **City Drive / Open City Drive**; delivery converted from import-map static HTML to Vite/npm while preserving gameplay module boundaries and remote asset URLs.
- Starter features removed: none; no unrelated track-racing, lap, nitro, or minimap additions.
- New features required by user: none beyond the compatible starter surface.
- Asset replacements required by user/art direction: none.
- Source/manifest/code contracts that must change: Vite entry/deployment contract; runtime asset, motion, and facing reports added without changing vehicle model contracts.
- Template conflicts or unsupported requirements: none.
- Decision: adapt template; preserve bundled starter assets and runtime behavior.

## Asset / motion / facing manifest

Art direction: polished generic city-driving simulator using the bundled Unity-derived FBX, texture, UI, and audio assets.
Platform: PC + mobile browser.

| Entity / system | Source | Runtime binding | Motion contract / notes |
|---|---|---|---|
| Player vehicle catalog (13 FBX vehicles) | RETRIEVE — starter remote asset URLs in `src/vehicle/VehicleOrchestration.js` | `ensureVehicleModel` → `assets.car` replaces the prior car visual; measured wheel-radius scaling | move=`simulation-root`; suspension/steering/wheel spin=`procedural-visual`; lights=`procedural-visual`; damage/skid=`procedural-fx` |
| City environment FBX | RETRIEVE — starter remote URL in `src/scene/CityLoader.js` | `applyMenuScene` binds the loaded FBX to the city world groups | static scene; terrain surface height queried by raycast |
| Wheel and spoiler packs | RETRIEVE — starter remote URLs in `src/scene/CityLoader.js` | loaded parts populate wheel/spoiler libraries and replace stock/customization visuals | wheel steer/spin=`procedural-visual`; rigid part mount=`socket-follow` via measured vehicle anchors |
| Traffic vehicle FBX | RETRIEVE — starter remote URL in `src/scene/CityLoader.js` | `TrafficSystem.loadVehicleMeshes` clones loaded traffic meshes | navigation=`simulation-root`; indicators/lights=`procedural-visual` |
| Road/building/sky/particle/UI textures | RETRIEVE — starter mappings in `src/core/utils.js` and `CityLoader.js` | material and texture loaders bind mapped remote URLs | static materials; particles=`procedural-fx` |
| Engine, impact, gearbox, music, siren audio | RETRIEVE — starter remote URLs in `src/physics/World.js` | audio elements are created by physics/audio startup and triggered by gameplay | audio playback=`procedural-fx` |
| HUD, menus, controls, colliders, beacons, physics, AI | PROCEDURAL | DOM/WebGL systems in copied starter | HUD/menu=`ui-motion`; physics/AI=`simulation-root`; particles=`procedural-fx` |

### Facing contract — player vehicle
- controlFrame: `actor-local`
- gameplayForward: `+Z`
- visualForward: `+Z` (starter vehicle convention preserved; no replacement model introduced)
- visualPivotYaw: `0`
- actor root: `world.carPivot`; visual pivot: `assets.car`

## Model contract summary
- Vehicle ids, model paths, wheel names/radii, body predicates, lights, spoiler mounts, and dynamics remain the starter's Unity-derived contracts.
- Remote assets stay remote; no downloaded/cache copies and no `asset-replacements.json` because no replacement was requested.
