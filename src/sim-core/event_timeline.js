// src/sim-core/event_timeline.js
// Event Timeline UI Component

/**
 * Event Timeline manager
 */
export class EventTimeline {
  constructor() {
    this.isVisible = false;
    this.events = [];
    this.currentTick = 0;
    this.timelineElement = null;
  }

  /**
   * Show the event timeline
   */
  show() {
    this.isVisible = true;
    const timeline = document.getElementById('eventTimeline');
    if (timeline) {
      timeline.style.display = 'block';
      this.render();
    }
  }

  /**
   * Hide the event timeline
   */
  hide() {
    this.isVisible = false;
    const timeline = document.getElementById('eventTimeline');
    if (timeline) {
      timeline.style.display = 'none';
    }
  }

  /**
   * Toggle timeline visibility
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Update events from simulation state
   */
  updateEvents(state) {
    this.events = state.events || [];
    this.currentTick = state.tTick || 0;
    
    if (this.isVisible) {
      this.render();
    }
  }

  /**
   * Render the timeline
   */
  render() {
    const container = document.getElementById('eventTimelineContent');
    if (!container) return;

    const timelineEvents = this.getTimelineEvents();
    
    let html = `
      <div class="section">
        <div class="title">Event Timeline</div>
        <div class="sub">Current tick: ${this.currentTick}</div>
        
        <div class="event-list">
    `;

    if (timelineEvents.length === 0) {
      html += `
        <div class="event-item">
          <div class="event-message">No events in current timeframe</div>
        </div>
      `;
    } else {
      for (const event of timelineEvents) {
        html += this.renderEvent(event);
      }
    }

    html += `
        </div>
        
        <div class="row" style="margin-top:12px;">
          <button class="btn secondary" onclick="eventTimeline.hide()">Close</button>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  /**
   * Get events for timeline display
   */
  getTimelineEvents() {
    if (!window.createEventTimeline) {
      return this.events.filter(event => 
        Math.abs(event.tick - this.currentTick) <= 50
      ).map(event => ({
        ...event,
        status: event.tick > this.currentTick ? 'upcoming' : 
                this.currentTick < event.tick + event.duration ? 'active' : 'completed',
        progress: Math.max(0, Math.min(1, (this.currentTick - event.tick) / event.duration))
      })).sort((a, b) => a.tick - b.tick);
    }

    return window.createEventTimeline(this.events, this.currentTick);
  }

  /**
   * Render individual event
   */
  renderEvent(event) {
    const statusClass = event.status === 'active' ? 'event-active' : 
                       event.status === 'upcoming' ? 'event-upcoming' : 
                       'event-completed';

    const statusIcon = event.status === 'active' ? '🔴' : 
                       event.status === 'upcoming' ? '⏳' : 
                       '✅';

    const severityColor = this.getSeverityColor(event.params?.severity || 0.5);

    return `
      <div class="event-item ${statusClass}">
        <div class="event-header">
          <span class="event-icon">${statusIcon}</span>
          <span class="event-type">${event.type?.toUpperCase() || 'UNKNOWN'}</span>
          <span class="event-tick">Tick ${event.tick}</span>
        </div>
        <div class="event-details">
          <div class="event-severity" style="background-color: ${severityColor};">
            Severity: ${(event.params?.severity || 0.5 * 100).toFixed(0)}%
          </div>
          <div class="event-region">Region: ${event.params?.region || 'global'}</div>
          ${event.status === 'active' ? `
            <div class="event-progress">
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${event.progress * 100}%"></div>
              </div>
              <span class="progress-text">${Math.round(event.progress * 100)}%</span>
            </div>
          ` : ''}
        </div>
        <div class="event-params">
          ${this.formatEventParams(event.params)}
        </div>
      </div>
    `;
  }

  /**
   * Get color for severity level
   */
  getSeverityColor(severity) {
    if (severity < 0.3) return '#10b981'; // Green
    if (severity < 0.7) return '#f59e0b'; // Yellow
    return '#ef4444'; // Red
  }

  /**
   * Format event parameters for display
   */
  formatEventParams(params) {
    if (!params) return '';

    const formatted = [];
    
    for (const [key, value] of Object.entries(params)) {
      if (key === 'severity' || key === 'region') continue;
      
      let displayValue = value;
      if (typeof value === 'number') {
        if (key.includes('Rate') || key.includes('Multiplier')) {
          displayValue = `${(value * 100).toFixed(1)}%`;
        } else if (key.includes('Reduction') || key.includes('Damage')) {
          displayValue = `${(value * 100).toFixed(1)}%`;
        } else if (key.includes('Duration')) {
          displayValue = `${value} ticks`;
        }
      }
      
      formatted.push(`<div class="param-item"><span class="param-key">${key}:</span> <span class="param-value">${displayValue}</span></div>`);
    }

    return formatted.join('');
  }
}

/**
 * Global event timeline instance
 */
// Ensure the class is available globally
if (typeof window.EventTimeline === 'undefined') {
  window.EventTimeline = EventTimeline;
}

// Create instance only if class is available
if (typeof window.EventTimeline === 'function') {
  window.eventTimeline = new window.EventTimeline();
} else {
  console.error('EventTimeline class not available');
  window.eventTimeline = {
    toggle: function() {
      if (window.showToast) {
        window.showToast('Event timeline not available', 'error');
      }
    },
    hide: function() {
      // No-op
    },
    updateEvents: function(state) {
      // No-op
    }
  };
}

/**
 * UI functions for event timeline
 */
window.ui_toggleEventTimeline = function() {
  window.eventTimeline.toggle();
};

/**
 * Update event timeline from simulation state
 */
window.updateEventTimeline = function(state) {
  window.eventTimeline.updateEvents(state);
};

/**
 * Initialize event timeline when page loads
 */
document.addEventListener('DOMContentLoaded', () => {
  // Auto-update timeline when simulation ticks
  document.addEventListener('simulationTick', (event) => {
    window.updateEventTimeline(event.detail.state);
  });
});
