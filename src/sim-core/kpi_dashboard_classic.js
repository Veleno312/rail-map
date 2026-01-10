// src/sim-core/kpi_dashboard_classic.js
// Classic script version compatible with existing setup

/**
 * KPI Dashboard manager - Classic script version
 */
function createKPIDashboard() {
  const dashboard = {
    isVisible: false,
    kpis: new Map(),
    history: new Map(),
    maxHistoryLength: 50,
    updateInterval: 5000,
    intervalId: null,
    
    initializeKPIs: function() {
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
    },
    
    start: function() {
      if (this.intervalId) return;
      
      var self = this;
      this.intervalId = setInterval(function() {
        self.update();
      }, this.updateInterval);
      
      this.update();
    },
    
    stop: function() {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    },
    
    update: function() {
      if (!window.simState) return;
      
      var state = window.simState;
      var currentTime = Date.now();
      
      // Update financial KPIs
      this.updateKPI('revenue', state.revenueEUR || state.revenue || 0, currentTime);
      this.updateKPI('profit', state.profitEUR || state.profit || 0, currentTime);
      this.updateKPI('cash', state.cashEUR || 0, currentTime);
      
      // Update operational KPIs
      this.updateKPI('pax_moved', state.paxMoved || 0, currentTime);
      this.updateKPI('on_time_performance', this.calculateOnTimePerformance(state), currentTime);
      
      // Update network KPIs
      this.updateKPI('network_coverage', this.calculateNetworkCoverage(state), currentTime);
      
      // Render if visible
      if (this.isVisible) {
        this.render();
      }
    },
    
    updateKPI: function(kpiId, value, timestamp) {
      if (!this.history.has(kpiId)) {
        this.history.set(kpiId, []);
      }
      
      var history = this.history.get(kpiId);
      history.push({ value: value, timestamp: timestamp });
      
      // Limit history length
      if (history.length > this.maxHistoryLength) {
        history.shift();
      }
    },
    
    calculateOnTimePerformance: function(state) {
      var totalTrains = state.totalTrains || 100;
      var delayedTrains = state.delayedTrains || 10;
      return Math.max(0, 100 - (delayedTrains / totalTrains) * 100);
    },
    
    calculateNetworkCoverage: function(state) {
      if (!state.nodes || !state.tracks) return 0;
      
      var totalNodes = state.nodes.size || 0;
      var connectedNodes = new Set();
      
      // Find all nodes connected to tracks
      for (var track of state.tracks.values()) {
        if (track.from) connectedNodes.add(track.from);
        if (track.to) connectedNodes.add(track.to);
      }
      
      return totalNodes > 0 ? (connectedNodes.size / totalNodes) * 100 : 0;
    },
    
    show: function() {
      this.isVisible = true;
      var dashboard = document.getElementById('kpiDashboard');
      if (dashboard) {
        dashboard.style.display = 'block';
        this.render();
      }
    },
    
    hide: function() {
      this.isVisible = false;
      var dashboard = document.getElementById('kpiDashboard');
      if (dashboard) {
        dashboard.style.display = 'none';
      }
    },
    
    toggle: function() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    },
    
    render: function() {
      var container = document.getElementById('kpiContent');
      if (!container) return;
      
      var categories = this.groupKPIsByCategory();
      var html = '';
      
      for (var categoryId in categories) {
        html += this.renderCategory(categoryId, categories[categoryId]);
      }
      
      container.innerHTML = html;
    },
    
    groupKPIsByCategory: function() {
      var categories = {};
      
      for (var [kpiId, kpi] of this.kpis) {
        if (!categories[kpi.category]) {
          categories[kpi.category] = [];
        }
        categories[kpi.category].push(kpiId);
      }
      
      return categories;
    },
    
    renderCategory: function(category, kpiIds) {
      var categoryLabels = {
        financial: 'Financial',
        operational: 'Operational',
        network: 'Network',
        customer: 'Customer'
      };
      
      var html = '<div class="section"><div class="title">' + (categoryLabels[category] || category) + '</div><div class="kpi-grid">';
      
      for (var i = 0; i < kpiIds.length; i++) {
        html += this.renderKPI(kpiIds[i]);
      }
      
      html += '</div></div>';
      return html;
    },
    
    renderKPI: function(kpiId) {
      var kpi = this.kpis.get(kpiId);
      var history = this.history.get(kpiId) || [];
      var current = history[history.length - 1];
      
      if (!current) {
        return '<div class="kpi-item"><div class="kpi-value">--</div><div class="kpi-label">' + kpi.label + '</div></div>';
      }
      
      var formattedValue = this.formatValue(current.value, kpi.format);
      
      return '<div class="kpi-item"><div class="kpi-value">' + formattedValue + '</div><div class="kpi-label">' + kpi.label + '</div></div>';
    },
    
    formatValue: function(value, format) {
      switch (format) {
        case 'currency':
          return '€' + Math.round(value).toLocaleString();
        case 'percentage':
          return Math.round(value) + '%';
        case 'number':
        default:
          if (value >= 1000000) {
            return (value / 1000000).toFixed(1) + 'M';
          } else if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'K';
          }
          return Math.round(value).toString();
      }
    }
  };
  
  // Initialize
  dashboard.initializeKPIs();
  
  return dashboard;
}

// Create global instance
window.kpiDashboard = createKPIDashboard();

// UI function
window.ui_toggleKPIDashboard = function() {
  window.kpiDashboard.toggle();
};

// Auto-start when page loads
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(function() {
    window.kpiDashboard.start();
  }, 1000);
});
