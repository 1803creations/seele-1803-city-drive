// Minimal publish/subscribe event bus — equivalent to Unity CCDS_Events.
//
// Usage:
//   import { events } from "./core/events.js";
//   const unsubscribe = events.on("mission:complete", (payload) => {...});
//   events.emit("mission:complete", { missionId, reward });
//   unsubscribe();
//
// Handlers are called synchronously in subscription order. Throwing handlers
// are caught and logged so one subscriber cannot break the others.

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(type, handler) {
    if (typeof handler !== "function") return () => {};
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const unsubscribe = this.on(type, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off(type, handler) {
    const set = this._listeners.get(type);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._listeners.delete(type);
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set || set.size === 0) return;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }

  clear(type) {
    if (type) {
      this._listeners.delete(type);
    } else {
      this._listeners.clear();
    }
  }
}

export const events = new EventBus();
export { EventBus };
