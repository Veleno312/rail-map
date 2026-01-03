import { simCoreStep } from "./step.js";

export { simCoreStep };

// Legacy bridge (so your existing app/sim.js can call it without imports yet)
window.simCoreStep = simCoreStep;
