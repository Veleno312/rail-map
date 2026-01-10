// src/sim-core/line_color_tool_classic.js
// Line Color Tool [21.1] - Visual enhancement for lines

/**
 * Line Color Tool manager - Classic script version
 */
function createLineColorTool() {
  const tool = {
    isVisible: false,
    selectedLineId: null,
    currentColor: '#2b6cff',
    presetColors: [
      '#2b6cff', '#ef4444', '#10b981', '#f59e0b',
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
      '#f97316', '#6366f1', '#14b8a6', '#a855f7',
      '#0ea5e9', '#22c55e', '#eab308', '#dc2626'
    ],
    
    initializeEventListeners: function() {
      // Listen for line selection events
      if (typeof document !== 'undefined') {
        document.addEventListener('lineSelected', (event) => {
          this.selectLine(event.detail.lineId);
        });
        
        // Listen for line color changes
        document.addEventListener('lineColorChanged', (event) => {
          this.updateLineColor(event.detail.lineId, event.detail.color);
        });
      }
    },
    
    show: function(lineId) {
      this.selectedLineId = lineId;
      this.isVisible = true;
      
      const picker = document.getElementById('lineColorPicker');
      if (picker) {
        picker.style.display = 'block';
        this.render();
      }
    },
    
    hide: function() {
      this.isVisible = false;
      this.selectedLineId = null;
      
      const picker = document.getElementById('lineColorPicker');
      if (picker) {
        picker.style.display = 'none';
      }
    },
    
    selectLine: function(lineId) {
      if (!lineId) return;
      
      this.selectedLineId = lineId;
      
      // Get current line color
      const line = this.getLineById(lineId);
      if (line && line.color) {
        this.currentColor = line.color;
      }
      
      if (!this.isVisible) {
        this.show(lineId);
      } else {
        this.render();
      }
    },
    
    getLineById: function(lineId) {
      if (!window.simState || !window.simState.lines) return null;
      
      return window.simState.lines.find(line => line.id === lineId);
    },
    
    updateLineColor: function(lineId, color) {
      if (!window.simState || !window.simState.lines) return;
      
      const line = this.getLineById(lineId);
      if (!line) return;
      
      // Update line color in state
      line.color = color;
      this.currentColor = color;
      
      // Update map visualization
      this.updateLineVisualization(lineId, color);
      
      // Update line legend
      this.updateLineLegend(lineId, color);
      
      // Emit change event
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('lineColorUpdated', {
          detail: { lineId, color }
        }));
      }
      
      // Show toast notification
      this.showToast('Line color updated');
    },
    
    updateLineVisualization: function(lineId, color) {
      // This would update the actual map rendering
      // Implementation depends on your mapping library (Leaflet, MapLibre, etc.)
      
      if (window.mapLayers && window.mapLayers.updateLineColor) {
        window.mapLayers.updateLineColor(lineId, color);
      }
      
      // If using Leaflet
      if (window.L && window.lineLayers) {
        const layer = window.lineLayers[lineId];
        if (layer) {
          layer.setStyle({ color: color });
        }
      }
    },
    
    updateLineLegend: function(lineId, color) {
      const legendItem = document.querySelector(`#lineLegend [data-line-id="${lineId}"]`);
      if (legendItem) {
        const swatch = legendItem.querySelector('.swatch');
        if (swatch) {
          swatch.style.backgroundColor = color;
        }
      }
    },
    
    render: function() {
      const container = document.getElementById('lineColorContent');
      if (!container) return;
      
      const line = this.selectedLineId ? this.getLineById(this.selectedLineId) : null;
      const lineName = line ? line.name || `Line ${line.number}` : 'Select a line';
      
      let html = `
        <div class="section">
          <div class="title">${lineName}</div>
          <div class="sub">Choose a color for this line</div>
          
          <div class="color-grid">
      `;
      
      // Render preset colors
      for (const color of this.presetColors) {
        const isSelected = color === this.currentColor;
        html += `
          <div class="color-swatch ${isSelected ? 'selected' : ''}" 
               style="background-color: ${color}"
               onclick="window.lineColorTool.selectPresetColor('${color}')"
               title="${color}">
          </div>
        `;
      }
      
      html += `
          </div>
          
          <div class="custom-color">
            <input type="color" 
                   id="customColorInput" 
                   value="${this.currentColor}"
                   onchange="window.lineColorTool.selectCustomColor(this.value)">
            <input type="text" 
                   id="customColorText" 
                   value="${this.currentColor}"
                   placeholder="#000000"
                   onchange="window.lineColorTool.selectCustomColor(this.value)">
          </div>
          
          <div class="line-preview">
            <div class="preview-line" style="background-color: ${this.currentColor}"></div>
          </div>
          
          <div class="row">
            <button class="btn" onclick="window.lineColorTool.applyColor()">Apply Color</button>
            <button class="btn secondary" onclick="window.lineColorTool.hide()">Cancel</button>
          </div>
        </div>
      `;
      
      container.innerHTML = html;
    },
    
    selectPresetColor: function(color) {
      this.currentColor = color;
      this.updatePreview();
      
      // Update selection UI
      const swatches = document.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => {
        swatch.classList.remove('selected');
        if (swatch.style.backgroundColor === color || 
            this.rgbToHex(swatch.style.backgroundColor) === color.toLowerCase()) {
          swatch.classList.add('selected');
        }
      });
      
      // Update custom color inputs
      const customInput = document.getElementById('customColorInput');
      const customText = document.getElementById('customColorText');
      if (customInput) customInput.value = color;
      if (customText) customText.value = color;
    },
    
    selectCustomColor: function(color) {
      // Validate color format
      if (!this.isValidColor(color)) {
        this.showToast('Invalid color format', 'error');
        return;
      }
      
      this.currentColor = color;
      this.updatePreview();
      
      // Update custom color inputs
      const customInput = document.getElementById('customColorInput');
      const customText = document.getElementById('customColorText');
      if (customInput) customInput.value = color;
      if (customText) customText.value = color;
      
      // Remove preset selection
      const swatches = document.querySelectorAll('.color-swatch');
      swatches.forEach(swatch => swatch.classList.remove('selected'));
    },
    
    applyColor: function() {
      if (!this.selectedLineId) {
        this.showToast('Please select a line first', 'error');
        return;
      }
      
      this.updateLineColor(this.selectedLineId, this.currentColor);
      this.hide();
    },
    
    updatePreview: function() {
      const previewLine = document.querySelector('.preview-line');
      if (previewLine) {
        previewLine.style.backgroundColor = this.currentColor;
      }
    },
    
    isValidColor: function(color) {
      // Check hex format
      if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
        return true;
      }
      
      // Check named colors
      const s = new Option().style;
      s.color = color;
      return s.color !== '';
    },
    
    rgbToHex: function(rgb) {
      if (!rgb || !rgb.startsWith('rgb')) return rgb;
      
      const values = rgb.match(/\d+/g);
      if (!values || values.length < 3) return rgb;
      
      const hex = values.slice(0, 3).map(x => {
        const hex = parseInt(x).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      });
      
      return '#' + hex.join('');
    },
    
    showToast: function(message, type) {
      type = type || 'success';
      if (window.showToast) {
        window.showToast(message);
      } else {
        console.log(`Toast (${type}): ${message}`);
      }
    },
    
    getAllLineColors: function() {
      if (!window.simState || !window.simState.lines) return {};
      
      const colors = {};
      for (const line of window.simState.lines) {
        colors[line.id] = line.color || this.getDefaultLineColor(line.id);
      }
      
      return colors;
    },
    
    getDefaultLineColor: function(lineId) {
      // Generate a deterministic color based on line ID
      const hash = this.hashCode(lineId);
      const hue = Math.abs(hash) % 360;
      return this.hslToHex(hue, 70, 50);
    },
    
    hashCode: function(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash;
    },
    
    hslToHex: function(h, s, l) {
      l /= 100;
      const a = s * Math.min(l, 1 - l) / 100;
      const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    },
    
    resetAllLineColors: function() {
      if (!window.simState || !window.simState.lines) return;
      
      for (const line of window.simState.lines) {
        const defaultColor = this.getDefaultLineColor(line.id);
        this.updateLineColor(line.id, defaultColor);
      }
      
      this.showToast('All line colors reset to defaults');
    },
    
    exportColorConfig: function() {
      const colors = this.getAllLineColors();
      
      const config = {
        version: '1.0',
        timestamp: Date.now(),
        colors: colors
      };
      
      return config;
    },
    
    importColorConfig: function(config) {
      if (!config || !config.colors) {
        this.showToast('Invalid color configuration', 'error');
        return;
      }
      
      for (const [lineId, color] of Object.entries(config.colors)) {
        if (this.getLineById(lineId)) {
          this.updateLineColor(lineId, color);
        }
      }
      
      this.showToast('Color configuration imported');
    }
  };
  
  // Initialize event listeners
  tool.initializeEventListeners();
  
  return tool;
}

// Create global instance
window.lineColorTool = createLineColorTool();

// UI functions for line color tool
window.ui_closeLineColorPicker = function() {
  window.lineColorTool.hide();
};

// Add line color button to line legend items
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    // Add color buttons to line legend when it's rendered
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const legendItems = document.querySelectorAll('#lineLegend .item');
          legendItems.forEach(item => {
            if (!item.querySelector('.color-btn')) {
              const lineId = item.getAttribute('data-line-id');
              if (lineId) {
                const colorBtn = document.createElement('button');
                colorBtn.className = 'btn secondary';
                colorBtn.style.cssText = 'width:auto;padding:4px 8px;margin:0;font-size:10px;';
                colorBtn.textContent = 'Color';
                colorBtn.onclick = () => window.lineColorTool.selectLine(lineId);
                
                const meta = item.querySelector('.meta');
                if (meta) {
                  meta.appendChild(colorBtn);
                }
              }
            }
          });
        }
      });
    });
    
    const lineLegend = document.getElementById('lineLegend');
    if (lineLegend) {
      observer.observe(lineLegend, { childList: true, subtree: true });
    }
  });
}
