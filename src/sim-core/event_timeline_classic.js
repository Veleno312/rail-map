// src/sim-core/event_timeline_classic.js
// Classic script version compatible with existing setup

/**
 * Event Timeline manager - Classic script version
 */
function createEventTimeline() {
  var timeline = {
    isVisible: false,
    events: [],
    currentTick: 0,
    
    show: function() {
      this.isVisible = true;
      var timelineEl = document.getElementById('eventTimeline');
      if (timelineEl) {
        timelineEl.style.display = 'block';
        this.render();
      }
    },
    
    hide: function() {
      this.isVisible = false;
      var timelineEl = document.getElementById('eventTimeline');
      if (timelineEl) {
        timelineEl.style.display = 'none';
      }
    },
    
    toggle: function() {
      if (this.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    },
    
    updateEvents: function(state) {
      this.events = state.events || [];
      this.currentTick = state.tTick || 0;
      
      if (this.isVisible) {
        this.render();
      }
    },
    
    render: function() {
      var container = document.getElementById('eventTimelineContent');
      if (!container) return;

      var timelineEvents = this.getTimelineEvents();
      
      var html = '<div class="section"><div class="title">Event Timeline</div><div class="sub">Current tick: ' + this.currentTick + '</div><div class="event-list">';
      
      if (timelineEvents.length === 0) {
        html += '<div class="event-item"><div class="event-message">No events in current timeframe</div></div>';
      } else {
        for (var i = 0; i < timelineEvents.length; i++) {
          html += this.renderEvent(timelineEvents[i]);
        }
      }
      
      html += '</div><div class="row" style="margin-top:12px;"><button class="btn secondary" onclick="eventTimeline.hide()">Close</button></div></div>';
      
      container.innerHTML = html;
    },
    
    getTimelineEvents: function() {
      var filtered = [];
      
      for (var i = 0; i < this.events.length; i++) {
        var event = this.events[i];
        if (Math.abs(event.tick - this.currentTick) <= 50) {
          var status = event.tick > this.currentTick ? 'upcoming' : 
                      this.currentTick < event.tick + event.duration ? 'active' : 'completed';
          var progress = Math.max(0, Math.min(1, (this.currentTick - event.tick) / event.duration));
          
          filtered.push({
            ...event,
            status: status,
            progress: progress
          });
        }
      }
      
      return filtered.sort(function(a, b) { return a.tick - b.tick; });
    },
    
    renderEvent: function(event) {
      var statusClass = event.status === 'active' ? 'event-active' : 
                       event.status === 'upcoming' ? 'event-upcoming' : 
                       'event-completed';

      var statusIcon = event.status === 'active' ? '🔴' : 
                       event.status === 'upcoming' ? '⏳' : 
                       '✅';

      var severityColor = this.getSeverityColor(event.params ? event.params.severity || 0.5 : 0.5);

      var html = '<div class="event-item ' + statusClass + '">';
      html += '<div class="event-header">';
      html += '<span class="event-icon">' + statusIcon + '</span>';
      html += '<span class="event-type">' + (event.type ? event.type.toUpperCase() : 'UNKNOWN') + '</span>';
      html += '<span class="event-tick">Tick ' + event.tick + '</span>';
      html += '</div>';
      
      html += '<div class="event-details">';
      html += '<div class="event-severity" style="background-color: ' + severityColor + ';">';
      html += 'Severity: ' + Math.round((event.params ? event.params.severity || 0.5 : 0.5) * 100) + '%';
      html += '</div>';
      html += '<div class="event-region">Region: ' + (event.params ? event.params.region || 'global' : 'global') + '</div>';
      
      if (event.status === 'active') {
        html += '<div class="event-progress">';
        html += '<div class="progress-bar">';
        html += '<div class="progress-fill" style="width: ' + (event.progress * 100) + '%"></div>';
        html += '</div>';
        html += '<span class="progress-text">' + Math.round(event.progress * 100) + '%</span>';
        html += '</div>';
      }
      
      html += '</div>';
      
      if (event.params) {
        html += '<div class="event-params">';
        html += this.formatEventParams(event.params);
        html += '</div>';
      }
      
      html += '</div>';
      
      return html;
    },
    
    getSeverityColor: function(severity) {
      if (severity < 0.3) return '#10b981'; // Green
      if (severity < 0.7) return '#f59e0b'; // Yellow
      return '#ef4444'; // Red
    },
    
    formatEventParams: function(params) {
      if (!params) return '';

      var formatted = [];
      
      for (var key in params) {
        if (key === 'severity' || key === 'region') continue;
        
        var value = params[key];
        var displayValue = value;
        
        if (typeof value === 'number') {
          if (key.includes('Rate') || key.includes('Multiplier')) {
            displayValue = (value * 100).toFixed(1) + '%';
          } else if (key.includes('Reduction') || key.includes('Damage')) {
            displayValue = (value * 100).toFixed(1) + '%';
          } else if (key.includes('Duration')) {
            displayValue = value + ' ticks';
          }
        }
        
        formatted.push('<div class="param-item"><span class="param-key">' + key + ':</span> <span class="param-value">' + displayValue + '</span></div>');
      }

      return formatted.join('');
    }
  };
  
  return timeline;
}

// Create global instance
window.eventTimeline = createEventTimeline();

// UI function
window.ui_toggleEventTimeline = function() {
  window.eventTimeline.toggle();
};

// Update function
window.updateEventTimeline = function(state) {
  window.eventTimeline.updateEvents(state);
};

// Auto-update when simulation ticks
document.addEventListener('DOMContentLoaded', function() {
  document.addEventListener('simulationTick', function(event) {
    if (window.updateEventTimeline) {
      window.updateEventTimeline(event.detail.state);
    }
  });
});
