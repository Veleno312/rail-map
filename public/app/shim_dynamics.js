// Expose ESM dynamics exports to global scope for classic scripts.
import * as dyn from "../dynamics.js";
Object.assign(window, dyn);
