// src/sim-core/integration_classic.js
// Integration layer for new modules with existing simulation core

/**
 * Initialize events for a simulation run
 */
function initializeEvents(seed, scenarioConfig) {
  scenarioConfig = scenarioConfig || {};
  
  if (!window.makeEventGenerator) return null;
  
  const eventGenerator = window.makeEventGenerator(seed);
  const events = eventGenerator.generateEvents({
    startTick: 0,
    endTick: scenarioConfig.duration || 365,
    baseRate: scenarioConfig.eventRate || 0.02,
    allowedTypes: scenarioConfig.eventTypes || ['weather', 'illness', 'disaster', 'policy']
  });
  
  return {
    generator: eventGenerator,
    events: events,
    activeEvents: []
  };
}

/**
 * Update macro dynamics using ODE solver
 */
function updateMacroDynamics(state, tick) {
  if (!state.macro || !window.macroDerivatives || !window.createSolver) return;
  
  const solver = window.createSolver('rk4', 1.0); // 1 day time step
  const eventEffects = state.eventEffects || {};
  
  // Get derivatives for current macro state
  const derivatives = window.macroDerivatives(state.macro, state.transport || {}, eventEffects);
  
  // Solve ODEs for this tick
  const newMacroState = solver.step(state.macro, derivatives, tick);
  
  // Apply stability constraints
  if (window.applyStabilityConstraints) {
    window.applyStabilityConstraints(newMacroState);
  }
  
  // Update demand multipliers
  if (window.updateDemandMultipliers) {
    window.updateDemandMultipliers(newMacroState);
  }
  
  // Update state
  state.macro = newMacroState;
  
  // Generate macro report
  if (window.generateMacroReport && tick % 7 === 0) { // Weekly reports
    const report = window.generateMacroReport(newMacroState, tick);
    if (!state.macroReports) state.macroReports = [];
    state.macroReports.push(report);
  }
}

/**
 * Apply event effects to economy calculations
 */
function applyEventEffectsToEconomy(state) {
  const effects = state.eventEffects || {};
  
  // Modify revenue based on demand multiplier
  if (effects.demandMultiplier && effects.demandMultiplier !== 1) {
    state.revenueEUR = (state.revenueEUR || 0) * effects.demandMultiplier;
  }
  
  // Modify costs based on infrastructure damage
  if (effects.infrastructureDamage && effects.infrastructureDamage > 0) {
    const damageCost = (state.costEUR || 0) * effects.infrastructureDamage * 0.5;
    state.costEUR = (state.costEUR || 0) + damageCost;
  }
  
  // Apply speed multiplier to operations
  if (effects.speedMultiplier && effects.speedMultiplier !== 1) {
    // Speed reduction affects operational efficiency
    const efficiencyLoss = 1 - effects.speedMultiplier;
    state.operationalEfficiency = 1 - efficiencyLoss * 0.3;
  }
  
  // Apply subsidy changes
  if (effects.subsidyMultiplier && effects.subsidyMultiplier !== 1) {
    state.subsidyEUR = (state.subsidyEUR || 0) * effects.subsidyMultiplier;
  }
}

/**
 * Initialize KPI tracking
 */
function initializeKPIs(state) {
  if (!window.kpiDashboard) return;
  
  // Set initial KPI values from state
  const initialKPIs = {
    revenue: state.revenueEUR || 0,
    profit: state.profitEUR || 0,
    cash: state.cashEUR || 0,
    pax_moved: state.paxMoved || 0,
    freight_moved: state.freightMoved || 0,
    network_coverage: calculateNetworkCoverage(state),
    line_utilization: calculateLineUtilization(state)
  };
  
  // Initialize KPI dashboard with these values
  for (const [kpiId, value] of Object.entries(initialKPIs)) {
    window.kpiDashboard.updateKPI(kpiId, value, Date.now());
  }
}

/**
 * Calculate network coverage percentage
 */
function calculateNetworkCoverage(state) {
  if (!state.nodes || !state.tracks) return 0;
  
  const totalNodes = state.nodes.size || 0;
  const connectedNodes = new Set();
  
  // Find all nodes connected to tracks
  for (const track of state.tracks.values()) {
    if (track.from) connectedNodes.add(track.from);
    if (track.to) connectedNodes.add(track.to);
  }
  
  return totalNodes > 0 ? (connectedNodes.size / totalNodes) * 100 : 0;
}

/**
 * Calculate average line utilization
 */
function calculateLineUtilization(state) {
  if (!state.lines || state.lines.size === 0) return 0;
  
  let totalUtilization = 0;
  let lineCount = 0;
  
  for (const line of state.lines.values()) {
    if (line.utilization !== undefined) {
      totalUtilization += line.utilization;
      lineCount++;
    }
  }
  
  return lineCount > 0 ? totalUtilization / lineCount : 0;
}

/**
 * Setup event listeners for UI integration
 */
function setupEventListeners() {
  // Listen for simulation state changes
  if (typeof document !== 'undefined') {
    document.addEventListener('simulationTick', (event) => {
      const state = event.detail.state;
      
      // Update KPI dashboard
      if (window.kpiDashboard) {
        window.kpiDashboard.update();
      }
      
      // Update event timeline
      if (window.updateEventTimeline) {
        window.updateEventTimeline(state);
      }
    });
    
    // Listen for line selection
    document.addEventListener('lineSelected', (event) => {
      if (window.lineColorTool) {
        window.lineColorTool.selectLine(event.detail.lineId);
      }
    });
    
    // Listen for tile loading progress
    document.addEventListener('tileLoadProgress', (event) => {
      const progress = event.detail;
      console.log(`Tile loading: ${progress.loaded}/${progress.total} (${Math.round(progress.progress * 100)}%)`);
    });
  }
}

/**
 * Validate integration state
 */
function validateIntegration(state) {
  const issues = [];
  
  // Check required components
  if (!state.events && typeof window.makeEventGenerator === 'function') {
    issues.push('Events not initialized but event framework is available');
  }
  
  if (!state.macro && typeof window.initializeMacroVariables === 'function') {
    issues.push('Macro variables not initialized but macro framework is available');
  }
  
  // Check data consistency
  if (state.eventEffects && !state.events) {
    issues.push('Event effects present but no events in state');
  }
  
  if (state.macro && state.macroRegions && state.macroRegions.size === 0) {
    issues.push('Macro state initialized but no regions defined');
  }
  
  return {
    valid: issues.length === 0,
    issues: issues
  };
}

/**
 * Export integration utilities
 */
const integrationUtils = {
  initializeEvents: initializeEvents,
  updateMacroDynamics: updateMacroDynamics,
  applyEventEffectsToEconomy: applyEventEffectsToEconomy,
  initializeKPIs: initializeKPIs,
  setupEventListeners: setupEventListeners,
  validateIntegration: validateIntegration
};

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    
    // Make integration utilities globally available
    window.integrationUtils = integrationUtils;
  });
} else {
  // Make available immediately if DOM is not available
  window.integrationUtils = integrationUtils;
}
