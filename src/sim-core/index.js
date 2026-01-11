// src/sim-core/index.js
// Make sure simCoreStep is available globally
// Classic script version: define simCoreStep in the global scope
// Assumes all dependencies (makeRng, makeRunMeta, validateState, computeFlows, computeEconomy) are loaded globally

window.simCoreStep = function simCoreStep(prevState, input) {
	try {
		if (typeof window.simCoreStepPure === "function") {
			return window.simCoreStepPure(prevState, input);
		}
		const seed = (input?.seed ?? 1) >>> 0;
		const scenarioId = input?.scenarioId ?? "default";
		const tickLabel = input?.tickLabel ?? "";

		// Clone so we don't mutate the caller's state (skip unserializable/DOM objects)
		// IMPORTANT: Never clone Maps/Sets from the global state - they should remain as references
		const state = {};
		
		// Helper function to check if value is serializable
		function isSerializable(val) {
			if (val === null || val === undefined) return true;
			if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') return true;
			
			// Skip functions
			if (typeof val === 'function') return false;
			
			// Skip DOM elements and nodes
			if (val instanceof HTMLElement || val instanceof Node || val instanceof Window) return false;
			
			// NEVER clone Maps/Sets - they should be passed by reference
			if (val instanceof Map || val instanceof Set) return false;
			
			// Handle Arrays - check all elements
			if (Array.isArray(val)) {
				for (let i = 0; i < val.length; i++) {
					if (!isSerializable(val[i])) return false;
				}
				return true;
			}
			
			// Handle plain objects - check all properties
			if (typeof val === 'object') {
				try {
					// Try JSON.stringify as a quick test
					const json = JSON.stringify(val);
					JSON.parse(json); // Verify it can be parsed back
					return true;
				} catch {
					return false;
				}
			}
			
			return false;
		}
		
		// Helper function to safely clone a value
		function safeClone(val) {
			if (val === null || val === undefined) return val;
			if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') return val;
			
			// NEVER clone Maps/Sets - pass by reference to maintain functionality
			if (val instanceof Map || val instanceof Set) {
				return val; // Return original reference
			}
			
			// Handle Arrays
			if (Array.isArray(val)) {
				try {
					return val.map(item => safeClone(item));
				} catch (e) {
					console.warn('Failed to clone array:', e.message);
					return [];
				}
			}
			
			// Handle plain objects
			if (typeof val === 'object') {
				try {
					// Deep clone via JSON for plain objects
					return JSON.parse(JSON.stringify(val));
				} catch {
					// If JSON fails, try manual cloning
					try {
						const obj = {};
						for (const key in val) {
							if (Object.prototype.hasOwnProperty.call(val, key)) {
								obj[key] = safeClone(val[key]);
							}
						}
						return obj;
					} catch (e2) {
						console.warn('Failed to clone object:', e2.message);
						return {};
					}
				}
			}
			
			return val;
		}
		
		for (const key in prevState) {
			const val = prevState[key];
			
			// Special handling for Maps/Sets - always pass by reference
			if (val instanceof Map || val instanceof Set) {
				state[key] = val; // Keep original reference
			} else if (isSerializable(val)) {
				try {
					state[key] = safeClone(val);
				} catch (e) {
					console.warn('Failed to clone state property:', key, e.message);
					// Skip this property
					continue;
				}
			} else {
				// Log what we're skipping for debugging
				if (val && typeof val === 'object') {
					console.warn('Skipping unserializable state property:', key, 
						val instanceof HTMLElement ? 'HTMLElement' : 
						val instanceof Node ? 'Node' : 
						val instanceof Window ? 'Window' : 
						typeof val);
				}
			}
		}

		// Attach meta once (or keep existing)
		state.meta = state.meta ?? window.makeRunMeta({ seed, scenarioId });
		state.tTick = Number.isInteger(state.tTick) ? state.tTick : 0;

		// Deterministic rng stream for this tick (available for later models)
		const rng = window.makeRng(seed).fork(`tick:${state.tTick}`);
		state.rng = { seed: rng.seed };

		// 0) Process events (new - affects all subsequent calculations)
		if (window.applyEventEffects && state.events) {
			window.applyEventEffects(state, state.events, state.tTick);
		}

		// Helper function to ensure Maps/Sets are properly initialized
		function ensureMapsAndSets(state) {
			// Convert plain objects back to Maps if needed
			if (state.nodes && !(state.nodes instanceof Map)) {
				try {
					const nodesMap = new Map();
					if (typeof state.nodes === 'object') {
						for (const key in state.nodes) {
							if (Object.prototype.hasOwnProperty.call(state.nodes, key)) {
								nodesMap.set(key, state.nodes[key]);
							}
						}
					}
					state.nodes = nodesMap;
				} catch (e) {
					console.warn('Failed to restore nodes Map:', e);
					state.nodes = new Map();
				}
			} else if (!state.nodes) {
				state.nodes = new Map();
			}
			
			if (state.tracks && !(state.tracks instanceof Map)) {
				try {
					const tracksMap = new Map();
					if (typeof state.tracks === 'object') {
						for (const key in state.tracks) {
							if (Object.prototype.hasOwnProperty.call(state.tracks, key)) {
								tracksMap.set(key, state.tracks[key]);
							}
						}
					}
					state.tracks = tracksMap;
				} catch (e) {
					console.warn('Failed to restore tracks Map:', e);
					state.tracks = new Map();
				}
			} else if (!state.tracks) {
				state.tracks = new Map();
			}
			
			if (state.lines && !(state.lines instanceof Map)) {
				try {
					const linesMap = new Map();
					if (typeof state.lines === 'object') {
						for (const key in state.lines) {
							if (Object.prototype.hasOwnProperty.call(state.lines, key)) {
								linesMap.set(key, state.lines[key]);
							}
						}
					}
					state.lines = linesMap;
				} catch (e) {
					console.warn('Failed to restore lines Map:', e);
					state.lines = new Map();
				}
			} else if (!state.lines) {
				state.lines = new Map();
			}
		}

		// Helper function to safely call computeFlows
		function safeComputeFlows(state) {
			ensureMapsAndSets(state);
			
			// Add debugging
			console.log('computeFlows state check:', {
				nodesExists: !!state.nodes,
				nodesIsMap: state.nodes instanceof Map,
				nodesSize: state.nodes.size,
				tracksExists: !!state.tracks,
				tracksIsMap: state.tracks instanceof Map,
				tracksSize: state.tracks.size,
				linesExists: !!state.lines,
				linesIsMap: state.lines instanceof Map,
				linesSize: state.lines.size
			});
			
			// Test basic Map operations
			try {
				state.nodes.get('test');
				state.tracks.get('test');
				state.lines.get('test');
				console.log('Map operations test passed');
			} catch (e) {
				console.error('Map operations test failed:', e);
				// Re-initialize Maps if operations fail
				state.nodes = new Map();
				state.tracks = new Map();
				state.lines = new Map();
			}
			
			window.computeFlows(state);
		}

		// Helper function to safely call computeEconomy
		function safeComputeEconomy(state) {
			ensureMapsAndSets(state);
			
			// Add debugging
			console.log('computeEconomy state check:', {
				nodesExists: !!state.nodes,
				nodesIsMap: state.nodes instanceof Map,
				nodesSize: state.nodes.size,
				tracksExists: !!state.tracks,
				tracksIsMap: state.tracks instanceof Map,
				tracksSize: state.tracks.size,
				linesExists: !!state.lines,
				linesIsMap: state.lines instanceof Map,
				linesSize: state.lines.size
			});
			
			// Test basic Map operations
			try {
				state.nodes.get('test');
				state.tracks.get('test');
				state.lines.get('test');
				console.log('Map operations test passed');
			} catch (e) {
				console.error('Map operations test failed:', e);
				// Re-initialize Maps if operations fail
				state.nodes = new Map();
				state.tracks = new Map();
				state.lines = new Map();
			}
			
			window.computeEconomy(state);
		}

		// 1) dynamics / flows
		if (window.computeFlows) {
			try {
				safeComputeFlows(state);
			} catch (e) {
				console.error('Error in computeFlows:', e);
				console.error('State at error:', { 
					hasNodes: !!state.nodes, 
					nodesType: typeof state.nodes,
					nodesIsMap: state.nodes instanceof Map,
					hasTracks: !!state.tracks,
					tracksType: typeof state.tracks,
					tracksIsMap: state.tracks instanceof Map,
					hasLines: !!state.lines,
					linesType: typeof state.lines,
					linesIsMap: state.lines instanceof Map
				});
			}
		}
		
		// 2) economy update
		if (window.computeEconomy) {
			try {
				safeComputeEconomy(state);
			} catch (e) {
				console.error('Error in computeEconomy:', e);
				console.error('State at error:', { 
					hasNodes: !!state.nodes, 
					nodesType: typeof state.nodes,
					nodesIsMap: state.nodes instanceof Map,
					hasTracks: !!state.tracks,
					tracksType: typeof state.tracks,
					tracksIsMap: state.tracks instanceof Map,
					hasLines: !!state.lines,
					linesType: typeof state.lines,
					linesIsMap: state.lines instanceof Map
				});
			}
		}

		// 3) Macro dynamics (new - if available)
		if (window.updateMacroDynamics && state.macro) {
			window.updateMacroDynamics(state, state.tTick);
		}

		// advance tick
		state.tTick += 1;

		// Create one "row" for exports
		const tickRow = {
			tTick: state.tTick,
			tickLabel,
			cashEUR: numOrNull(state.cashEUR),
			revenueEUR: numOrNull(state.revenueEUR ?? state.revenue),
			costEUR: numOrNull(state.costEUR ?? state.cost),
			profitEUR: numOrNull(state.profitEUR ?? state.profit),
			paxMoved: numOrNull(state.paxMoved),
			runId: state.meta.runId,
		};

		const issues = window.validateState(state);

		return { state, tickRow, issues };
	} catch (error) {
		console.error('Error in simCoreStep:', error);
		
		// Return a minimal valid state to prevent complete failure
		const minimalState = {
			tTick: (prevState?.tTick || 0) + 1,
			meta: prevState?.meta || { runId: 'fallback', timestamp: Date.now() },
			rng: { seed: input?.seed || 1 }
		};
		
		const minimalTickRow = {
			tTick: minimalState.tTick,
			tickLabel: input?.tickLabel || '',
			runId: minimalState.meta.runId,
			cashEUR: null,
			revenueEUR: null,
			costEUR: null,
			profitEUR: null,
			paxMoved: null
		};
		
		return { 
			state: minimalState, 
			tickRow: minimalTickRow, 
			issues: [{ type: 'error', message: error.message }] 
		};
	}
}

function numOrNull(x) {
	return Number.isFinite(x) ? x : null;
}
