// src/sim-core/macro_dynamics.js
// Macro Variables [17.1][17.2] - Population/GDP/industry dynamics with accessibility

/**
 * Initialize macro variables for regions
 */
export function initializeMacroVariables(regions) {
  const macro = {};
  
  for (const regionId of regions) {
    macro[regionId] = {
      // Population dynamics
      P: 100000, // Base population
      P_growth_rate: 0.01, // 1% annual growth
      
      // GDP dynamics  
      G: 1000000, // Base GDP in EUR
      G_growth_rate: 0.02, // 2% annual growth
      
      // Industry dynamics
      I: 500000, // Base industrial output
      I_growth_rate: 0.015, // 1.5% annual growth
      
      // Housing/Infrastructure
      H: 800000, // Housing stock
      H_growth_rate: 0.005, // 0.5% annual growth
      
      // Accessibility index
      A: 0.5, // 0-1 scale, 0.5 = moderate accessibility
      
      // Transport metrics
      avgTravelTime: 30, // minutes
      transportCost: 0.1, // EUR/km
      
      // Demand multipliers
      passengerDemand: 1.0,
      freightDemand: 1.0,
      
      // Feedback coefficients
      accessibility_elasticity: 0.3, // How much accessibility affects growth
      transport_elasticity: 0.2, // How much transport affects productivity
      population_elasticity: 0.4 // How much population affects demand
    };
  }
  
  return macro;
}

/**
 * Calculate accessibility index from travel times and service levels
 */
export function calculateAccessibility(region, networkState, travelTimes) {
  // Accessibility = f(travel time, frequency, cost)
  // Higher accessibility = better transport connections
  
  const gravityParams = {
    alpha: 1.0, // Distance decay parameter
    beta: 0.5,  // Service quality weight
    gamma: 0.3  // Cost sensitivity
  };
  
  let accessibilitySum = 0;
  
  // Calculate accessibility to all other regions
  for (const otherRegionId in networkState.regions) {
    if (otherRegionId === region.id) continue;
    
    const otherRegion = networkState.regions[otherRegionId];
    const travelTime = travelTimes[`${region.id}-${otherRegionId}`] || 60; // Default 1 hour
    const frequency = networkState.frequencies[`${region.id}-${otherRegionId}`] || 1; // Daily
    const cost = networkState.costs[`${region.id}-${otherRegionId}`] || 10; // EUR
    
    // Gravity-based accessibility measure
    const opportunity = otherRegion.population || 100000;
    const impedance = Math.pow(travelTime, gravityParams.alpha) * 
                     Math.pow(frequency + 1, -gravityParams.beta) * 
                     Math.pow(cost + 1, gravityParams.gamma);
    
    accessibilitySum += opportunity / impedance;
  }
  
  // Normalize to 0-1 scale
  const maxAccessibility = 1000000; // Calibration constant
  const accessibility = Math.min(1, accessibilitySum / maxAccessibility);
  
  return accessibility;
}

/**
 * Define differential equations for macro dynamics
 */
export function macroDerivatives(macroState, transportState, eventEffects = {}) {
  const derivatives = {};
  
  // Apply event effects
  const demandMultiplier = eventEffects.demandMultiplier || 1;
  const speedMultiplier = eventEffects.speedMultiplier || 1;
  
  for (const regionId in macroState) {
    const region = macroState[regionId];
    
    // Population dynamics: dP/dt = rP * P * (1 - P/K) + f(A)
    const carryingCapacity = region.P * 10; // Assume 10x current population as carrying capacity
    const accessibilityGrowthBonus = region.accessibility_elasticity * region.A * region.P * 0.01;
    const eventImpact = (demandMultiplier - 1) * region.P * 0.1; // Events affect population growth
    
    // GDP dynamics: dG/dt = rG * G + f(transport, accessibility)
    const transportProductivityBonus = region.transport_elasticity * 
                                     (speedMultiplier - 1) * region.G * 0.05;
    const accessibilityProductivityBonus = region.accessibility_elasticity * 
                                          region.A * region.G * 0.02;
    
    // Industry dynamics: dI/dt = rI * I + f(accessibility, population)
    const populationDemandBonus = region.population_elasticity * 
                                (region.P / 100000 - 1) * region.I * 0.01;
    const accessibilityIndustryBonus = region.accessibility_elasticity * 
                                      region.A * region.I * 0.03;
    
    // Housing dynamics: dH/dt = rH * H + f(population pressure)
    const housingPressure = Math.max(0, (region.P / region.H - 1)) * region.H * 0.02;
    
    derivatives[regionId] = {
      P: region.P_growth_rate * region.P * (1 - region.P / carryingCapacity) + 
         accessibilityGrowthBonus + eventImpact,
      
      G: region.G_growth_rate * region.G + transportProductivityBonus + 
         accessibilityProductivityBonus + eventImpact * 0.5,
      
      I: region.I_growth_rate * region.I + populationDemandBonus + 
         accessibilityIndustryBonus + eventImpact * 0.3,
      
      H: region.H_growth_rate * region.H + housingPressure + eventImpact * 0.2,
      
      A: (region.A - 0.5) * 0.01 + eventImpact * 0.01 // Slowly revert to baseline
    };
  }
  
  return derivatives;
}

/**
 * Update demand multipliers based on macro state
 */
export function updateDemandMultipliers(macroState) {
  for (const regionId in macroState) {
    const region = macroState[regionId];
    
    // Passenger demand based on population and accessibility
    region.passengerDemand = Math.pow(region.P / 100000, region.population_elasticity) * 
                             Math.pow(region.A, region.accessibility_elasticity);
    
    // Freight demand based on industry and accessibility
    region.freightDemand = Math.pow(region.I / 500000, 0.8) * 
                           Math.pow(region.A, 0.5);
    
    // Apply bounds to prevent unrealistic values
    region.passengerDemand = Math.max(0.1, Math.min(10, region.passengerDemand));
    region.freightDemand = Math.max(0.1, Math.min(10, region.freightDemand));
  }
}

/**
 * Stability constraints to prevent runaway growth
 */
export function applyStabilityConstraints(macroState) {
  for (const regionId in macroState) {
    const region = macroState[regionId];
    
    // Non-negativity constraints
    region.P = Math.max(1000, region.P);
    region.G = Math.max(10000, region.G);
    region.I = Math.max(5000, region.I);
    region.H = Math.max(4000, region.H);
    
    // Upper bounds (reasonable limits)
    region.P = Math.min(50000000, region.P); // Max 50 million people
    region.G = Math.min(1000000000, region.G); // Max 1 billion EUR
    region.I = Math.min(500000000, region.I); // Max 500 million EUR
    region.H = Math.min(40000000, region.H); // Max 40 million housing units
    
    // Accessibility bounds
    region.A = Math.max(0, Math.min(1, region.A));
    
    // Growth rate bounds (prevent explosive growth)
    region.P_growth_rate = Math.max(-0.1, Math.min(0.1, region.P_growth_rate));
    region.G_growth_rate = Math.max(-0.2, Math.min(0.2, region.G_growth_rate));
    region.I_growth_rate = Math.max(-0.15, Math.min(0.15, region.I_growth_rate));
    region.H_growth_rate = Math.max(-0.05, Math.min(0.1, region.H_growth_rate));
  }
}

/**
 * Generate macro report for analysis
 */
export function generateMacroReport(macroState, tick) {
  const report = {
    tick,
    timestamp: Date.now(),
    regions: {},
    aggregates: {
      totalPopulation: 0,
      totalGDP: 0,
      totalIndustry: 0,
      totalHousing: 0,
      avgAccessibility: 0,
      totalPassengerDemand: 0,
      totalFreightDemand: 0
    }
  };
  
  const regionCount = Object.keys(macroState).length;
  
  for (const regionId in macroState) {
    const region = macroState[regionId];
    
    report.regions[regionId] = {
      population: region.P,
      gdp: region.G,
      industry: region.I,
      housing: region.H,
      accessibility: region.A,
      passengerDemand: region.passengerDemand,
      freightDemand: region.freightDemand,
      growthRates: {
        population: region.P_growth_rate,
        gdp: region.G_growth_rate,
        industry: region.I_growth_rate,
        housing: region.H_growth_rate
      }
    };
    
    // Update aggregates
    report.aggregates.totalPopulation += region.P;
    report.aggregates.totalGDP += region.G;
    report.aggregates.totalIndustry += region.I;
    report.aggregates.totalHousing += region.H;
    report.aggregates.avgAccessibility += region.A;
    report.aggregates.totalPassengerDemand += region.passengerDemand;
    report.aggregates.totalFreightDemand += region.freightDemand;
  }
  
  // Calculate averages
  report.aggregates.avgAccessibility /= regionCount;
  
  // Calculate per capita metrics
  report.aggregates.gdpPerCapita = report.aggregates.totalGDP / report.aggregates.totalPopulation;
  report.aggregates.housingPerCapita = report.aggregates.totalHousing / report.aggregates.totalPopulation;
  
  return report;
}

/**
 * Validate macro state
 */
export function validateMacroState(macroState) {
  const errors = [];
  const warnings = [];
  
  for (const regionId in macroState) {
    const region = macroState[regionId];
    
    // Check for required fields
    const requiredFields = ['P', 'G', 'I', 'H', 'A', 'passengerDemand', 'freightDemand'];
    for (const field of requiredFields) {
      if (!(field in region) || typeof region[field] !== 'number') {
        errors.push(`Region ${regionId}: missing or invalid ${field}`);
      }
    }
    
    // Check for reasonable values
    if (region.P < 0) errors.push(`Region ${regionId}: negative population`);
    if (region.G < 0) errors.push(`Region ${regionId}: negative GDP`);
    if (region.I < 0) errors.push(`Region ${regionId}: negative industry`);
    if (region.H < 0) errors.push(`Region ${regionId}: negative housing`);
    if (region.A < 0 || region.A > 1) errors.push(`Region ${regionId}: accessibility out of bounds`);
    
    // Warnings for unusual values
    if (region.P > 10000000) warnings.push(`Region ${regionId}: very large population`);
    if (region.G > 100000000) warnings.push(`Region ${regionId}: very large GDP`);
    if (region.A < 0.1) warnings.push(`Region ${regionId}: very low accessibility`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
