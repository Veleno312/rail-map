// debug_integration.js
// Simple diagnostic script to check if modules are loading correctly

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', function() {
  console.log('=== Integration Debug ===');
  
  // Check if classes are available
  console.log('KPIDashboard class:', typeof window.KPIDashboard);
  console.log('LineColorTool class:', typeof window.LineColorTool);
  console.log('EventTimeline class:', typeof window.EventTimeline);
  
  // Check if instances are created
  console.log('kpiDashboard instance:', typeof window.kpiDashboard);
  console.log('lineColorTool instance:', typeof window.lineColorTool);
  console.log('eventTimeline instance:', typeof window.eventTimeline);
  
  // Check if toggle methods exist
  console.log('kpiDashboard.toggle:', typeof window.kpiDashboard?.toggle);
  console.log('lineColorTool.selectLine:', typeof window.lineColorTool?.selectLine);
  console.log('eventTimeline.toggle:', typeof window.eventTimeline?.toggle);
  
  // Test KPI dashboard specifically
  if (window.kpiDashboard && typeof window.kpiDashboard.toggle === 'function') {
    console.log('✅ KPI Dashboard is ready');
  } else {
    console.error('❌ KPI Dashboard not ready');
    
    // Try to create it manually
    if (typeof window.KPIDashboard === 'function') {
      console.log('Attempting to create KPI Dashboard manually...');
      window.kpiDashboard = new window.KPIDashboard();
      console.log('Manual creation result:', typeof window.kpiDashboard?.toggle);
    }
  }
  
  // Monitor simulation state for issues
  if (window.state) {
    console.log('Current state keys:', Object.keys(window.state));
    
    // Check for DOM elements in state
    for (var key in window.state) {
      var val = window.state[key];
      if (val && typeof val === 'object' && val instanceof HTMLElement) {
        console.warn('Found DOM element in state:', key, val.tagName);
      }
    }
  }
  
  // Add a test button to the page for debugging
  setTimeout(() => {
    const testButton = document.createElement('button');
    testButton.textContent = 'Test Integration';
    testButton.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      z-index: 10000;
      background: #2b6cff;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
    `;
    
    testButton.onclick = function() {
      console.log('=== Testing Integration ===');
      
      // Test KPI Dashboard
      try {
        if (window.kpiDashboard && typeof window.kpiDashboard.toggle === 'function') {
          console.log('✅ KPI Dashboard toggle works');
          window.kpiDashboard.toggle();
        } else {
          console.error('❌ KPI Dashboard toggle failed');
        }
      } catch (error) {
        console.error('❌ KPI Dashboard error:', error);
      }
      
      // Test Event Timeline
      try {
        if (window.eventTimeline && typeof window.eventTimeline.toggle === 'function') {
          console.log('✅ Event Timeline toggle works');
        } else {
          console.error('❌ Event Timeline toggle failed');
        }
      } catch (error) {
        console.error('❌ Event Timeline error:', error);
      }
      
      // Test Line Color Tool
      try {
        if (window.lineColorTool && typeof window.lineColorTool.selectLine === 'function') {
          console.log('✅ Line Color Tool works');
        } else {
          console.error('❌ Line Color Tool failed');
        }
      } catch (error) {
        console.error('❌ Line Color Tool error:', error);
      }
      
      // Test simulation state cloning
      try {
        if (window.state && window.simCoreStep) {
          console.log('Testing simulation state cloning...');
          var testInput = { seed: 123 };
          window.simCoreStep(window.state, testInput);
          console.log('✅ Simulation step works');
        }
      } catch (error) {
        console.error('❌ Simulation step error:', error);
        console.error('Error details:', error.message);
        
        // Help identify problematic state properties
        if (window.state) {
          console.log('Checking state for problematic objects...');
          for (var key in window.state) {
            try {
              JSON.stringify(window.state[key]);
            } catch {
              console.warn('Problematic state property:', key, typeof window.state[key]);
            }
          }
        }
      }
    };
    
    document.body.appendChild(testButton);
  }, 1000);
});

// Also check immediately for debugging
console.log('Immediate check - KPIDashboard:', typeof window.KPIDashboard);
console.log('Immediate check - kpiDashboard:', typeof window.kpiDashboard);

// Monitor for simulation errors
window.addEventListener('error', function(event) {
  if (event.message.includes('structuredClone') || event.message.includes('HTMLDivElement')) {
    console.error('🔍 Detected structuredClone error - this is likely caused by DOM elements in simulation state');
    console.error('Error details:', event.message);
    console.error('Check the simulation state for DOM references');
  }
});
