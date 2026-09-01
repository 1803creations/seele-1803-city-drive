export function createWheelRig(world, carBody, dynamics = {}) {
  return {
    wheels: dynamics?.wheels || [],
    update() {},
    dispose() {
      this.wheels = [];
    }
  };
}
