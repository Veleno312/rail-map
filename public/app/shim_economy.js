// Expose ESM economy exports to global scope for classic scripts.
import * as econ from "../economy.js";
Object.assign(window, econ);
