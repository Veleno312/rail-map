// src/sim-core/kpi_dashboard.js
// KPI Dashboard [18.1] - Metrics display for user feedback

/**
 * KPI Dashboard manager
 */
export class KPIDashboard {
  constructor() {
    this.isVisible = false;
    this.kpis = new Map();
    this.history = new Map();
    this.maxHistoryLength = 50;
    this.updateInterval = 5000; // 5 seconds
    this.intervalId = null;
    
    this.initializeKPIs();
  }
  
  /**
   * Initialize KPI definitions
   */
  initializeKPIs() {
    // Financial KPIs
    this.kpis.set('revenue', {
      label: 'Revenue',
      unit: '€',
      format: 'currency',
      category: 'financial',
      target: null,
      threshold: { warning: 0, critical: 0 }
    });
    
    this.kpis.set('profit', {
      label: 'Profit',
      unit: '€',
      format: 'currency',
      category: 'financial',
      target: null,
      threshold: { warning: -1000, critical: -10000 }
    });
    
    this.kpis.set('cash', {
      label: 'Cash Flow',
      unit: '€',
      format: 'currency',
      category: 'financial',
      target: null,
      threshold: { warning: 5000, critical: 1000 }
    });
    
    // Operational KPIs
    this.kpis.set('pax_moved', {
      label: 'Passengers',
      unit: '',
      format: 'number',
      category: 'operational',
      target: null,
      threshold: { warning: 100, critical: 50 }
    });
    
    this.kpis.set('freight_moved', {
      label: 'Freight',
      unit: 'tons',
      format: 'number',
      category: 'operational',
      target: null,
      threshold: { warning: 1000, critical: 500 }
    });
    
    this.kpis.set('on_time_performance', {
      label: 'On-Time',
      unit: '%',
      format: 'percentage',
      category: 'operational',
      target: 95,
      threshold: { warning: 85, critical: 75 }
    });
    
    // Network KPIs
    this.kpis.set('network_coverage', {
      label: 'Coverage',
      unit: '%',
      format: 'percentage',
      category: 'network',
      target: 80,
      threshold: { warning: 60, critical: 40 }
    });
    
    this.kpis.set('line_utilization', {
      label: 'Utilization',
      unit: '%',
      format: 'percentage',
      category: 'network',
      target: 75,
      threshold: { warning: 90, critical: 95 }
    });
    
    // Customer KPIs
    this.kpis.set('customer_satisfaction', {
      label: 'Satisfaction',
      unit: '%',
      format: 'percentage',
      category: 'customer',
      target: 85,
      threshold: { warning: 70, critical: 60 }
    });
    
    this.kpis.set('complaint_rate', {
      label: 'Complaints',
      unit: '/1000pax',
      format: 'rate',
      category: 'customer',
      target: 5,
      threshold: { warning: 10, critical: 20 }
    });
  }
  
  /**
   * Start automatic updates
   */
  start() {
    if (this.intervalId) return;
    
    this.intervalId = setInterval(() => {
      this.update();
    }, this.updateInterval);
    
    this.update(); // Initial update
  }
  
  /**
   * Stop automatic updates
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  /**
   * Update KPI values from simulation state
   */
  update() {
    if (!window.simState) return;
    
    const state = window.simState;
    const currentTime = Date.now();
    
    // Update financial KPIs
    this.updateKPI('revenue', state.revenueEUR || state.revenue || 0, currentTime);
    this.updateKPI('profit', state.profitEUR || state.profit || 0, currentTime);
    this.updateKPI('cash', state.cashEUR || 0, currentTime);
    
    // Update operational KPIs
    this.updateKPI('pax_moved', state.paxMoved || 0, currentTime);
    this.updateKPI('freight_moved', state.freightMoved || 0, currentTime);
    this.updateKPI('on_time_performance', this.calculateOnTimePerformance(state), currentTime);
    
    // Update network KPIs
    this.updateKPI('network_coverage', this.calculateNetworkCoverage(state), currentTime);
    this.updateKPI('line_utilization', this.calculateLineUtilization(state), currentTime);
    
    // Update customer KPIs
    this.updateKPI('customer_satisfaction', this.calculateCustomerSatisfaction(state), currentTime);
    this.updateKPI('complaint_rate', this.calculateComplaintRate(state), currentTime);
    
    // Render if visible
    if (this.isVisible) {
      this.render();
    }
  }
  
  /**
   * Update individual KPI with history tracking
   */
  updateKPI(kpiId, value, timestamp) {
    if (!this.history.has(kpiId)) {
      this.history.set(kpiId, []);
    }
    
    const history = this.history.get(kpiId);
    history.push({ value, timestamp });
    
    // Limit history length
    if (history.length > this.maxHistoryLength) {
      history.shift();
    }
  }
  
  /**
   * Calculate on-time performance
   */
  calculateOnTimePerformance(state) {
    // Mock calculation - would use actual delay data
    const totalTrains = state.totalTrains || 100;
    const delayedTrains = state.delayedTrains || 10;
    return Math.max(0, 100 - (delayedTrains / totalTrains) * 100);
  }
  
  /**
   * Calculate network coverage
   */
  calculateNetworkCoverage(state) {
    // Percentage of population served by rail network
    const servedPopulation = state.servedPopulation || 500000;
    const totalPopulation = state.totalPopulation || 1000000;
    return (servedPopulation / totalPopulation) * 100;
  }
  
  /**
   * Calculate line utilization
   */
  calculateLineUtilization(state) {
    // Average capacity utilization across all lines
    const lines = state.lines || [];
    if (lines.length === 0) return 0;
    
    const totalUtilization = lines.reduce((sum, line) => {
      return sum + (line.utilization || 0);
    }, 0);
    
    return totalUtilization / lines.length;
  }
  
  /**
   * Calculate customer satisfaction
   */
  calculateCustomerSatisfaction(state) {
    // Based on on-time performance, crowding, and service quality
    const onTime = this.calculateOnTimePerformance(state);
    const crowding = state.averageCrowding || 50; // 0-100 scale
    const serviceQuality = state.serviceQuality || 80; // 0-100 scale
    
    // Weighted average
    return (onTime * 0.5 + (100 - crowding) * 0.3 + serviceQuality * 0.2);
  }
  
  /**
   * Calculate complaint rate
   */
  calculateComplaintRate(state) {
    // Complaints per 1000 passengers
    const complaints = state.complaints || 10;
    const passengers = state.paxMoved || 1000;
    return (complaints / passengers) * 1000;
  }
  
  /**
   * Show the dashboard
   */
  show() {
    this.isVisible = true;
    const dashboard = document.getElementById('kpiDashboard');
    if (dashboard) {
      dashboard.style.display = 'block';
      this.render();
    }
  }
  
  /**
   * Hide the dashboard
   */
  hide() {
    this.isVisible = false;
    const dashboard = document.getElementById('kpiDashboard');
    if (dashboard) {
      dashboard.style.display = 'none';
    }
  }
  
  /**
   * Toggle dashboard visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  
  /**
   * Render the dashboard
   */
  render() {
    const container = document.getElementById('kpiContent');
    if (!container) return;
    
    const categories = this.groupKPIsByCategory();
    let html = '';
    
    for (const [category, kpiIds] of categories) {
      html += this.renderCategory(category, kpiIds);
    }
    
    container.innerHTML = html;
  }
  
  /**
   * Group KPIs by category
   */
  groupKPIsByCategory() {
    const categories = new Map();
    
    for (const [kpiId, kpi] of this.kpis) {
      if (!categories.has(kpi.category)) {
        categories.set(kpi.category, []);
      }
      categories.get(kpi.category).push(kpiId);
    }
    
    return categories;
  }
  
  /**
   * Render a category section
   */
  renderCategory(category, kpiIds) {
    const categoryLabels = {
      financial: 'Financial',
      operational: 'Operational',
      network: 'Network',
      customer: 'Customer'
    };
    
    let html = `
      <div class="section">
        <div class="title">${categoryLabels[category] || category}</div>
        <div class="kpi-grid">
    `;
    
    for (const kpiId of kpiIds) {
      html += this.renderKPI(kpiId);
    }
    
    html += `
        </div>
      </div>
    `;
    
    return html;
  }
  
  /**
   * Render individual KPI
   */
  renderKPI(kpiId) {
    const kpi = this.kpis.get(kpiId);
    const history = this.history.get(kpiId) || [];
    const current = history[history.length - 1];
    const previous = history[history.length - 2];
    
    if (!current) {
      return `
        <div class="kpi-item">
          <div class="kpi-value">--</div>
          <div class="kpi-label">${kpi.label}</div>
        </div>
      `;
    }
    
    const formattedValue = this.formatValue(current.value, kpi.format);
    const trend = this.calculateTrend(current.value, previous?.value);
    const status = this.getKPIStatus(kpiId, current.value);
    
    return `
      <div class="kpi-item ${status}">
        <div class="kpi-value">${formattedValue}</div>
        <div class="kpi-label">${kpi.label}</div>
        ${trend ? `<div class="kpi-trend ${trend.direction}">${trend.symbol} ${trend.percent}%</div>` : ''}
        ${this.renderSparkline(history)}
      </div>
    `;
  }
  
  /**
   * Format value according to format type
   */
  formatValue(value, format) {
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('de-DE', {
          style: 'currency',
          currency: 'EUR',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }).format(value);
      
      case 'percentage':
        return `${Math.round(value)}%`;
      
      case 'rate':
        return value.toFixed(1);
      
      case 'number':
      default:
        if (value >= 1000000) {
          return `${(value / 1000000).toFixed(1)}M`;
        } else if (value >= 1000) {
          return `${(value / 1000).toFixed(1)}K`;
        }
        return Math.round(value).toString();
    }
  }
  
  /**
   * Calculate trend between current and previous values
   */
  calculateTrend(current, previous) {
    if (!previous || previous === 0) return null;
    
    const change = ((current - previous) / Math.abs(previous)) * 100;
    const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'stable';
    const symbol = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    
    return {
      direction,
      symbol,
      percent: Math.abs(change).toFixed(1)
    };
  }
  
  /**
   * Get KPI status based on thresholds
   */
  getKPIStatus(kpiId, value) {
    const kpi = this.kpis.get(kpiId);
    if (!kpi || !kpi.threshold) return '';
    
    const { warning, critical } = kpi.threshold;
    
    if (critical !== undefined && this.isThresholdBreached(value, critical, kpi)) {
      return 'critical';
    }
    
    if (warning !== undefined && this.isThresholdBreached(value, warning, kpi)) {
      return 'warning';
    }
    
    return '';
  }
  
  /**
   * Check if threshold is breached
   */
  isThresholdBreached(value, threshold, kpi) {
    // For some KPIs (like profit), lower is worse
    const lowerIsWorse = ['profit', 'cash', 'customer_satisfaction', 'on_time_performance'].includes(kpi.label.toLowerCase());
    
    if (lowerIsWorse) {
      return value < threshold;
    } else {
      return value > threshold;
    }
  }
  
  /**
   * Render sparkline chart
   */
  renderSparkline(history) {
    if (history.length < 2) return '';
    
    const values = history.map(h => h.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    const points = values.map((value, index) => {
      const x = (index / (history.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    }).join(' ');
    
    return `
      <div class="kpi-sparkline">
        <svg width="100%" height="100%" viewBox="0 0 100 100">
          <polyline
            points="${points}"
            fill="none"
            stroke="#2b6cff"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    `;
  }
  
  /**
   * Export KPI data
   */
  exportData() {
    const exportData = {
      timestamp: Date.now(),
      kpis: {},
      history: {}
    };
    
    // Current values
    for (const [kpiId, kpi] of this.kpis) {
      const history = this.history.get(kpiId) || [];
      const current = history[history.length - 1];
      
      exportData.kpis[kpiId] = {
        label: kpi.label,
        category: kpi.category,
        unit: kpi.unit,
        currentValue: current?.value || null,
        target: kpi.target,
        threshold: kpi.threshold
      };
    }
    
    // Historical data
    for (const [kpiId, history] of this.history) {
      exportData.history[kpiId] = history;
    }
    
    return exportData;
  }
}

/**
 * Global KPI dashboard instance
 */
// Ensure the class is available globally
if (typeof window.KPIDashboard === 'undefined') {
  window.KPIDashboard = KPIDashboard;
}

// Create instance only if class is available
if (typeof window.KPIDashboard === 'function') {
  window.kpiDashboard = new window.KPIDashboard();
} else {
  console.error('KPIDashboard class not available');
  window.kpiDashboard = {
    toggle: function() {
      if (window.showToast) {
        window.showToast('KPI Dashboard not available', 'error');
      }
    }
  };
}

/**
 * UI functions for KPI dashboard
 */
window.ui_toggleKPIDashboard = function() {
  window.kpiDashboard.toggle();
};

/**
 * Initialize KPI dashboard when page loads
 */
document.addEventListener('DOMContentLoaded', () => {
  // Start KPI dashboard
  setTimeout(() => {
    window.kpiDashboard.start();
  }, 1000);
});
