// src/sim-core/ode_solver.js
// ODE Solver Module [17.3] - Differential equation solver for macro dynamics

/**
 * Runge-Kutta 4th order ODE solver
 * Stable and accurate for most differential equations
 */
function RK4Solver(dt = 1.0) {
  this.dt = dt; // Time step
}

RK4Solver.prototype.step = function(state, derivatives, t) {
  const k1 = derivatives(state, t);
  const k2 = derivatives(this.addState(state, k1, this.dt * 0.5), t + this.dt * 0.5);
  const k3 = derivatives(this.addState(state, k2, this.dt * 0.5), t + this.dt * 0.5);
  const k4 = derivatives(this.addState(state, k3, this.dt), t + this.dt);

  // RK4 weighted average
  const weightedSum = this.addState(
    this.addState(
      this.addState(k1, k2, 2),
      this.addState(k3, k4, 2),
      1
    ),
    state,
    this.dt / 6
  );

  return weightedSum;
};

RK4Solver.prototype.addState = function(state1, state2, scale2 = 1) {
  const result = {};

  for (const key in state1) {
    if (typeof state1[key] === 'number') {
      result[key] = state1[key] + (state2[key] || 0) * scale2;
    } else {
      result[key] = state1[key]; // Preserve non-numeric fields
    }
  }

  // Add any keys only in state2
  for (const key in state2) {
    if (typeof state2[key] === 'number' && !(key in result)) {
      result[key] = (state2[key] || 0) * scale2;
    }
  }

  return result;
};

/**
 * Euler's method (simpler, faster, less accurate)
 * Good for quick prototyping or when high precision isn't needed
 */
export class EulerSolver {
  constructor(dt = 1.0) {
    this.dt = dt;
  }
  
  step(state, derivatives, t) {
    const dY = derivatives(state, t);
    return this.addState(state, dY, this.dt);
  }
  
  addState(state1, state2, scale2 = 1) {
    const result = {};
    for (const key in state1) {
      if (typeof state1[key] === 'number') {
        result[key] = state1[key] + (state2[key] || 0) * scale2;
      } else {
        result[key] = state1[key];
      }
    }
    for (const key in state2) {
      if (typeof state2[key] === 'number' && !(key in result)) {
        result[key] = (state2[key] || 0) * scale2;
      }
    }
    return result;
  }
}

/**
 * Adaptive step size solver for stiff equations
 * Automatically adjusts step size for stability
 */
export class AdaptiveSolver {
  constructor(dt = 1.0, tolerance = 1e-6) {
    this.dt = dt;
    this.tolerance = tolerance;
    this.rk4 = new RK4Solver(dt);
  }
  
  step(state, derivatives, t) {
    let currentDt = this.dt;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      // Take two half-steps vs one full step
      const halfStep1 = this.rk4.step(state, derivatives, t);
      const halfStep2 = this.rk4.step(halfStep1, derivatives, t + currentDt * 0.5);
      
      const fullStep = this.rk4.step(state, derivatives, t);
      
      // Estimate error
      const error = this.estimateError(halfStep2, fullStep);
      
      if (error < this.tolerance) {
        // Accept step and possibly increase dt
        if (error < this.tolerance * 0.1) {
          this.dt = Math.min(currentDt * 2, 10.0); // Cap max step size
        }
        return halfStep2;
      } else {
        // Reject step and reduce dt
        currentDt *= 0.5;
        this.dt = currentDt;
      }
      
      attempts++;
    }
    
    // If we couldn't meet tolerance, return the best we have
    return this.rk4.step(state, derivatives, t);
  }
  
  estimateError(state1, state2) {
    let maxError = 0;
    for (const key in state1) {
      if (typeof state1[key] === 'number') {
        const error = Math.abs(state1[key] - (state2[key] || 0));
        const relativeError = error / (Math.abs(state1[key]) + 1e-10);
        maxError = Math.max(maxError, relativeError);
      }
    }
    return maxError;
  }
}

/**
 * Factory function to create appropriate solver
 */
export function createSolver(type = 'rk4', dt = 1.0, options = {}) {
  switch (type.toLowerCase()) {
    case 'euler':
      return new EulerSolver(dt);
    case 'adaptive':
      return new AdaptiveSolver(dt, options.tolerance);
    case 'rk4':
    default:
      return new RK4Solver(dt);
  }
}

/**
 * Validate solver parameters
 */
export function validateSolverParams(params) {
  const errors = [];
  
  if (params.dt !== undefined) {
    if (typeof params.dt !== 'number' || params.dt <= 0) {
      errors.push('dt must be a positive number');
    }
  }
  
  if (params.type !== undefined) {
    const validTypes = ['euler', 'rk4', 'adaptive'];
    if (!validTypes.includes(params.type)) {
      errors.push(`type must be one of: ${validTypes.join(', ')}`);
    }
  }
  
  if (params.tolerance !== undefined) {
    if (typeof params.tolerance !== 'number' || params.tolerance <= 0) {
      errors.push('tolerance must be a positive number');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Stability checker for ODE systems
 * Helps detect potentially unstable configurations
 */
export function checkStability(derivatives, state, t, dt = 1.0) {
  // Test with small perturbation
  const epsilon = 1e-6;
  const perturbedState = {};
  
  for (const key in state) {
    if (typeof state[key] === 'number') {
      perturbedState[key] = state[key] + epsilon;
    } else {
      perturbedState[key] = state[key];
    }
  }
  
  const normalDeriv = derivatives(state, t);
  const perturbedDeriv = derivatives(perturbedState, t);
  
  // Estimate local Lipschitz constant
  let maxLipschitz = 0;
  for (const key in normalDeriv) {
    if (typeof normalDeriv[key] === 'number') {
      const diff = Math.abs(perturbedDeriv[key] - normalDeriv[key]);
      const lipschitz = diff / epsilon;
      maxLipschitz = Math.max(maxLipschitz, lipschitz);
    }
  }
  
  // Stability criterion (rough heuristic)
  const stable = maxLipschitz * dt < 2.0;
  
  return {
    stable,
    lipschitzConstant: maxLipschitz,
    recommendedDt: stable ? dt : Math.min(dt, 1.0 / maxLipschitz)
  };
}
