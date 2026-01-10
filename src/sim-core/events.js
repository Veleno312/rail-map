// src/sim-core/events.js
// Event Framework [16.1] - Seeded event system for reproducible scenarios

/**
 * Event types with their parameter schemas
 */
const EVENT_TYPES = {
  WEATHER: {
    id: 'weather',
    params: {
      severity: { type: 'number', min: 0, max: 1, default: 0.5 },
      region: { type: 'string', default: 'global' },
      speedReduction: { type: 'number', min: 0, max: 1, default: 0.3 },
      cancellationRate: { type: 'number', min: 0, max: 1, default: 0.1 }
    }
  },
  ILLNESS: {
    id: 'illness',
    params: {
      severity: { type: 'number', min: 0, max: 1, default: 0.5 },
      region: { type: 'string', default: 'global' },
      demandShock: { type: 'number', min: -1, max: 0, default: -0.3 }
    }
  },
  DISASTER: {
    id: 'disaster',
    params: {
      severity: { type: 'number', min: 0, max: 1, default: 0.5 },
      region: { type: 'string', default: 'local' },
      infrastructureDamage: { type: 'number', min: 0, max: 1, default: 0.4 },
      closureDuration: { type: 'number', min: 1, max: 365, default: 30 }
    }
  },
  POLICY: {
    id: 'policy',
    params: {
      severity: { type: 'number', min: 0, max: 1, default: 0.5 },
      region: { type: 'string', default: 'country' },
      subsidyChange: { type: 'number', min: -1, max: 1, default: 0.2 },
      strikeProbability: { type: 'number', min: 0, max: 1, default: 0.1 }
    }
  }
};

/**
 * Create an event generator with deterministic seeding
 */
function makeEventGenerator(seed = 1) {
  let currentSeed = seed;
  
  return {
    /**
     * Generate events for a given time period
     * @param {Object} params - Generation parameters
     * @param {number} params.startTick - Starting tick
     * @param {number} params.endTick - Ending tick
     * @param {number} params.baseRate - Base event probability per tick
     * @param {Array} params.allowedTypes - Allowed event types
     * @returns {Array} Array of events
     */
    generateEvents({ startTick, endTick, baseRate = 0.01, allowedTypes = Object.keys(EVENT_TYPES) }) {
      const events = [];
      
      for (let tick = startTick; tick <= endTick; tick++) {
        // Use deterministic RNG for this tick
        const tickSeed = hashCombine(currentSeed, tick);
        const random = seededRandom(tickSeed);
        
        if (random < baseRate) {
          // Event occurs this tick
          const eventTypeSeed = hashCombine(tickSeed, 1);
          const typeIndex = Math.floor(seededRandom(eventTypeSeed) * allowedTypes.length);
          const eventType = allowedTypes[typeIndex];
          
          const event = generateSingleEvent(eventType, hashCombine(eventTypeSeed, 2), tick);
          if (event) {
            events.push(event);
          }
        }
      }
      
      return events;
    },
    
    /**
     * Get the current seed for reproducibility
     */
    getSeed() {
      return currentSeed;
    },
    
    /**
     * Update the seed (for new scenarios)
     */
    setSeed(newSeed) {
      currentSeed = newSeed;
    }
  };
}

/**
 * Generate a single event with deterministic parameters
 */
function generateSingleEvent(eventType, seed, tick) {
  const typeDef = EVENT_TYPES[eventType.toUpperCase()];
  if (!typeDef) return null;
  
  const event = {
    id: `event_${eventType}_${tick}`,
    type: typeDef.id,
    tick,
    params: {},
    duration: 0
  };
  
  // Generate parameters deterministically
  let paramSeed = seed;
  for (const [paramName, paramDef] of Object.entries(typeDef.params)) {
    const random = seededRandom(paramSeed++);
    
    if (paramDef.type === 'number') {
      if (paramDef.min !== undefined && paramDef.max !== undefined) {
        event.params[paramName] = paramDef.min + random * (paramDef.max - paramDef.min);
      } else {
        event.params[paramName] = paramDef.default;
      }
    } else {
      event.params[paramName] = paramDef.default;
    }
  }
  
  // Set duration based on severity (more severe = longer duration)
  event.duration = Math.ceil(1 + event.params.severity * 30); // 1-31 ticks
  
  return event;
}

/**
 * Apply event effects to simulation state
 */
function applyEventEffects(state, events, currentTick) {
  const activeEvents = events.filter(event => 
    event.tick <= currentTick && currentTick < event.tick + event.duration
  );
  
  const effects = {
    speedMultiplier: 1,
    demandMultiplier: 1,
    cancellationMultiplier: 0,
    infrastructureDamage: 0,
    subsidyMultiplier: 1
  };
  
  for (const event of activeEvents) {
    switch (event.type) {
      case 'weather':
        effects.speedMultiplier *= (1 - event.params.speedReduction);
        effects.cancellationMultiplier += event.params.cancellationRate;
        break;
        
      case 'illness':
        effects.demandMultiplier *= (1 + event.params.demandShock);
        break;
        
      case 'disaster':
        effects.infrastructureDamage = Math.max(effects.infrastructureDamage, event.params.infrastructureDamage);
        break;
        
      case 'policy':
        effects.subsidyMultiplier *= (1 + event.params.subsidyChange);
        break;
    }
  }
  
  // Apply effects to state
  state.eventEffects = effects;
  state.activeEvents = activeEvents;
  
  return state;
}

/**
 * Simple hash combine for deterministic seeding
 */
function hashCombine(a, b) {
  a = ((a >>> 0) + (b >>> 0)) >>> 0;
  a = ((a ^ 61) ^ ((a >>> 0) >>> 16)) >>> 0;
  a = (a + (a >>> 0) << 3) >>> 0;
  a = (a ^ (a >>> 0) >>> 4) >>> 0;
  a = (a * 0x27d4eb2d) >>> 0;
  a = (a ^ (a >>> 0) >>> 15) >>> 0;
  return a;
}

/**
 * Seeded random number generator
 */
function seededRandom(seed) {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

/**
 * Validate event structure
 */
function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, errors: ['Event must be an object'] };
  }
  
  const errors = [];
  
  if (!event.id || typeof event.id !== 'string') {
    errors.push('Event must have a string id');
  }
  
  if (!event.type || !Object.values(EVENT_TYPES).some(t => t.id === event.type)) {
    errors.push(`Event type must be one of: ${Object.keys(EVENT_TYPES).join(', ')}`);
  }
  
  if (!Number.isInteger(event.tick) || event.tick < 0) {
    errors.push('Event tick must be a non-negative integer');
  }
  
  if (!Number.isInteger(event.duration) || event.duration < 0) {
    errors.push('Event duration must be a non-negative integer');
  }
  
  if (!event.params || typeof event.params !== 'object') {
    errors.push('Event must have params object');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create event timeline for UI display
 */
function createEventTimeline(events, currentTick) {
  return events
    .filter(event => Math.abs(event.tick - currentTick) <= 50) // Show nearby events
    .map(event => ({
      ...event,
      status: event.tick > currentTick ? 'upcoming' : 
              currentTick < event.tick + event.duration ? 'active' : 'completed',
      progress: Math.max(0, Math.min(1, (currentTick - event.tick) / event.duration))
    }))
    .sort((a, b) => a.tick - b.tick);
}

// Make functions globally available
window.makeEventGenerator = makeEventGenerator;
window.applyEventEffects = applyEventEffects;
window.validateEvent = validateEvent;
window.createEventTimeline = createEventTimeline;
window.EVENT_TYPES = EVENT_TYPES;
