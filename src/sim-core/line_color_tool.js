// src/sim-core/line_color_tool.js
// Line Color Tool [21.1] - Visual enhancement for lines

/**
 * Line Color Tool manager
 */
export class LineColorTool {
  constructor() {
    this.isVisible = false;
    this.selectedLineId = null;
    this.currentColor = '#2b6cff';
    this.presetColors = [
      '#2b6cff', '#ef4444', '#10b981', '#f59e0b',
      '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
      '#f97316', '#6366f1', '#14b8a6', '#a855f7',
      '#0ea5e9', '#22c55e', '#eab308', '#dc2626'
    ];
    
    this.initializeEventListeners();
  }
  
  /**
   * Initialize event listeners
   */
  initializeEventListeners() {
    // Listen for line selection events
    document.addEventListener('lineSelected', (event) => {
      this.selectLine(event.detail.lineId);
    });
    
    // Listen for line color changes
    document.addEventListener('lineColorChanged', (event) => {
      this.updateLineColor(event.detail.lineId, event.detail.color);
    });
  }
  
  /**
   * Show the color picker
   */
  show(lineId = null) {
    this.selectedLineId = lineId;
    this.isVisible = true;
    
    const picker = document.getElementById('lineColorPicker');
    if (picker) {
      picker.style.display = 'block';
      this.render();
    }
  }
  
  /**
   * Hide the color picker
   */
  hide() {
    this.isVisible = false;
    this.selectedLineId = null;
    
    const picker = document.getElementById('lineColorPicker');
    if (picker) {
      picker.style.display = 'none';
    }
  }
  
  /**
   * Select a line for color editing
   */
  selectLine(lineId) {
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
  }
  
  /**
   * Get line by ID
   */
  getLineById(lineId) {
    if (!window.simState || !window.simState.lines) return null;
    
    return window.simState.lines.find(line => line.id === lineId);
  }
  
  /**
   * Update line color
   */
  updateLineColor(lineId, color) {
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
    document.dispatchEvent(new CustomEvent('lineColorUpdated', {
      detail: { lineId, color }
    }));
    
    // Show toast notification
    this.showToast(`Line color updated`);
  }
  
  /**
   * Update line visualization on map
   */
  updateLineVisualization(lineId, color) {
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
  }
  
  /**
   * Update line legend
   */
  updateLineLegend(lineId, color) {
    const legendItem = document.querySelector(`#lineLegend [data-line-id="${lineId}"]`);
    if (legendItem) {
      const swatch = legendItem.querySelector('.swatch');
      if (swatch) {
        swatch.style.backgroundColor = color;
      }
    }
  }
  
  /**
   * Render the color picker interface
   */
  render() {
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
             onclick="lineColorTool.selectPresetColor('${color}')"
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
                 onchange="lineColorTool.selectCustomColor(this.value)">
          <input type="text" 
                 id="customColorText" 
                 value="${this.currentColor}"
                 placeholder="#000000"
                 onchange="lineColorTool.selectCustomColor(this.value)">
        </div>
        
        <div class="line-preview">
          <div class="preview-line" style="background-color: ${this.currentColor}"></div>
        </div>
        
        <div class="row">
          <button class="btn" onclick="lineColorTool.applyColor()">Apply Color</button>
          <button class="btn secondary" onclick="lineColorTool.hide()">Cancel</button>
        </div>
      </div>
    `;
    
    container.innerHTML = html;
  }
  
  /**
   * Select a preset color
   */
  selectPresetColor(color) {
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
  }
  
  /**
   * Select a custom color
   */
  selectCustomColor(color) {
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
  }
  
  /**
   * Apply the selected color
   */
  applyColor() {
    if (!this.selectedLineId) {
      this.showToast('Please select a line first', 'error');
      return;
    }
    
    this.updateLineColor(this.selectedLineId, this.currentColor);
    this.hide();
  }
  
  /**
   * Update the preview
   */
  updatePreview() {
    const previewLine = document.querySelector('.preview-line');
    if (previewLine) {
      previewLine.style.backgroundColor = this.currentColor;
    }
  }
  
  /**
   * Validate color format
   */
  isValidColor(color) {
    // Check hex format
    if (/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
      return true;
    }
    
    // Check named colors
    const s = new Option().style;
    s.color = color;
    return s.color !== '';
  }
  
  /**
   * Convert RGB to hex
   */
  rgbToHex(rgb) {
    if (!rgb || !rgb.startsWith('rgb')) return rgb;
    
    const values = rgb.match(/\d+/g);
    if (!values || values.length < 3) return rgb;
    
    const hex = values.slice(0, 3).map(x => {
      const hex = parseInt(x).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    });
    
    return '#' + hex.join('');
  }
  
  /**
   * Show toast notification
   */
  showToast(message, type = 'success') {
    if (window.showToast) {
      window.showToast(message);
    } else {
      console.log(`Toast (${type}): ${message}`);
    }
  }
  
  /**
   * Get line colors for all lines
   */
  getAllLineColors() {
    if (!window.simState || !window.simState.lines) return {};
    
    const colors = {};
    for (const line of window.simState.lines) {
      colors[line.id] = line.color || this.getDefaultLineColor(line.id);
    }
    
    return colors;
  }
  
  /**
   * Get default color for a line
   */
  getDefaultLineColor(lineId) {
    // Generate a deterministic color based on line ID
    const hash = this.hashCode(lineId);
    const hue = Math.abs(hash) % 360;
    return this.hslToHex(hue, 70, 50);
  }
  
  /**
   * Simple hash function
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
  
  /**
   * Convert HSL to hex
   */
  hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  
  /**
   * Reset all line colors to defaults
   */
  resetAllLineColors() {
    if (!window.simState || !window.simState.lines) return;
    
    for (const line of window.simState.lines) {
      const defaultColor = this.getDefaultLineColor(line.id);
      this.updateLineColor(line.id, defaultColor);
    }
    
    this.showToast('All line colors reset to defaults');
  }
  
  /**
   * Export line color configuration
   */
  exportColorConfig() {
    const colors = this.getAllLineColors();
    
    const config = {
      version: '1.0',
      timestamp: Date.now(),
      colors: colors
    };
    
    return config;
  }
  
  /**
   * Import line color configuration
   */
  importColorConfig(config) {
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
}

/**
 * Global line color tool instance
 */
// Ensure the class is available globally
if (typeof window.LineColorTool === 'undefined') {
  window.LineColorTool = LineColorTool;
}

// Create instance only if class is available
if (typeof window.LineColorTool === 'function') {
  window.lineColorTool = new window.LineColorTool();
} else {
  console.error('LineColorTool class not available');
  window.lineColorTool = {
    selectLine: function() {
      if (window.showToast) {
        window.showToast('Line color tool not available', 'error');
      }
    },
    hide: function() {
      // No-op
    }
  };
}

/**
 * UI functions for line color tool
 */
window.ui_closeLineColorPicker = function() {
  window.lineColorTool.hide();
};

/**
 * Add line color button to line legend items
 */
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
