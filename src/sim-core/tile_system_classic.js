// src/sim-core/tile_system_classic.js
// Tile Loading System [3.4-3.5] - Progressive world expansion

/**
 * Tile System for managing world tiles
 */
function TileSystem() {
  this.tileSize = 256; // pixels per tile
  this.zoomLevels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  this.maxZoom = 10;
}

TileSystem.prototype.latLngToTile = function(lat, lng, zoom) {
  const x = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  
  return { x, y, zoom };
};

TileSystem.prototype.tileToLatLng = function(x, y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, zoom);
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  const lng = x / Math.pow(2, zoom) * 360 - 180;
  
  return { lat, lng };
};

TileSystem.prototype.getTileBounds = function(x, y, zoom) {
  const nw = this.tileToLatLng(x, y, zoom);
  const se = this.tileToLatLng(x + 1, y + 1, zoom);
  
  return {
    north: nw.lat,
    south: se.lat,
    west: nw.lng,
    east: se.lng
  };
};

/**
 * Tile Loader for progressive loading
 */
function TileLoader(tileSystem) {
  this.tileSystem = tileSystem;
  this.loadedTiles = new Map();
  this.loadingTiles = new Set();
  this.tileCache = new Map();
  this.maxCacheSize = 100;
  this.loadQueue = [];
  this.isLoading = false;
}

TileLoader.prototype.loadTile = function(x, y, zoom) {
  const tileId = `${x}:${y}:${zoom}`;
  
  // Return from cache if available
  if (this.tileCache.has(tileId)) {
    return Promise.resolve(this.tileCache.get(tileId));
  }
  
  // Add to load queue if not already loading
  if (!this.loadingTiles.has(tileId)) {
    this.loadQueue.push({ x, y, zoom, tileId });
    this.loadingTiles.add(tileId);
  }
  
  // Start loading if not already loading
  if (!this.isLoading) {
    this.processLoadQueue();
  }
  
  return new Promise((resolve, reject) => {
    // Store resolver for when tile loads
    if (!this.tileCache.has(tileId)) {
      this.tileCache.set(tileId, { resolve, reject, loading: true });
    }
  });
};

TileLoader.prototype.processLoadQueue = function() {
  if (this.loadQueue.length === 0) {
    this.isLoading = false;
    return;
  }
  
  this.isLoading = true;
  const tile = this.loadQueue.shift();
  
  // Simulate tile loading (in real implementation, this would fetch data)
  setTimeout(() => {
    const tileData = this.generateTileData(tile.x, tile.y, tile.zoom);
    this.tileCache.set(tile.tileId, tileData);
    this.loadingTiles.delete(tile.tileId);
    
    // Emit progress event
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('tileLoadProgress', {
        detail: {
          loaded: this.loadedTiles.size,
          total: this.loadedTiles.size + this.loadQueue.length,
          progress: this.loadedTiles.size / (this.loadedTiles.size + this.loadQueue.length)
        }
      }));
    }
    
    // Process next tile
    this.processLoadQueue();
  }, 100); // Simulate network delay
};

TileLoader.prototype.generateTileData = function(x, y, zoom) {
  // Generate mock tile data
  const bounds = this.tileSystem.getTileBounds(x, y, zoom);
  
  return {
    id: `${x}:${y}:${zoom}`,
    x, y, zoom,
    bounds,
    data: {
      nodes: this.generateMockNodes(bounds, zoom),
      tracks: this.generateMockTracks(bounds, zoom),
      timestamp: Date.now()
    },
    loaded: true
  };
};

TileLoader.prototype.generateMockNodes = function(bounds, zoom) {
  // Generate mock nodes based on zoom level
  const nodeCount = Math.max(1, Math.floor(Math.pow(2, zoom) / 10));
  const nodes = [];
  
  for (let i = 0; i < nodeCount; i++) {
    const lat = bounds.south + Math.random() * (bounds.north - bounds.south);
    const lng = bounds.west + Math.random() * (bounds.east - bounds.west);
    
    nodes.push({
      id: `node_${zoom}_${i}`,
      lat,
      lng,
      name: `Node ${i}`,
      population: Math.floor(Math.random() * 100000),
      type: Math.random() > 0.7 ? 'city' : 'town'
    });
  }
  
  return nodes;
};

TileLoader.prototype.generateMockTracks = function(bounds, zoom) {
  // Generate mock tracks
  const trackCount = Math.max(0, Math.floor(Math.pow(2, zoom) / 20));
  const nodePool = Math.max(1, Math.floor(Math.pow(2, zoom) / 10));
  const tracks = [];
  
  for (let i = 0; i < trackCount; i++) {
    const startLat = bounds.south + Math.random() * (bounds.north - bounds.south);
    const startLng = bounds.west + Math.random() * (bounds.east - bounds.west);
    const endLat = bounds.south + Math.random() * (bounds.north - bounds.south);
    const endLng = bounds.west + Math.random() * (bounds.east - bounds.west);
    
    tracks.push({
      id: `track_${zoom}_${i}`,
      from: `node_${zoom}_${Math.floor(Math.random() * nodePool)}`,
      to: `node_${zoom}_${Math.floor(Math.random() * nodePool)}`,
      startLat,
      startLng,
      endLat,
      endLng,
      lanes: Math.floor(Math.random() * 4) + 1
    });
  }
  
  return tracks;
};

TileLoader.prototype.getLoadedTiles = function() {
  return Array.from(this.tileCache.values()).filter(tile => tile.loaded);
};

TileLoader.prototype.clearCache = function() {
  this.tileCache.clear();
  this.loadedTiles.clear();
  this.loadingTiles.clear();
  this.loadQueue = [];
};

/**
 * Start Anywhere UI helper
 */
function StartAnywhereUI(tileLoader, map) {
  this.tileLoader = tileLoader;
  this.map = map;
  this.isActive = false;
}

StartAnywhereUI.prototype.enable = function() {
  this.isActive = true;
  
  if (this.map) {
    // Add click handler to map
    this.map.on('click', this.handleMapClick.bind(this));
    
    // Add UI controls
    this.addUIControls();
  }
};

StartAnywhereUI.prototype.disable = function() {
  this.isActive = false;
  
  if (this.map) {
    this.map.off('click', this.handleMapClick.bind(this));
    this.removeUIControls();
  }
};

StartAnywhereUI.prototype.handleMapClick = function(event) {
  if (!this.isActive) return;
  
  const latlng = event.latlng;
  const zoom = this.map.getZoom();
  const tile = this.tileLoader.tileSystem.latLngToTile(latlng.lat, latlng.lng, zoom);
  
  // Load tiles around clicked location
  this.loadTilesAround(tile.x, tile.y, tile.zoom, 3); // 3x3 area
  
  // Show loading indicator
  this.showLoadingIndicator();
};

StartAnywhereUI.prototype.loadTilesAround = function(centerX, centerY, zoom, radius) {
  const tiles = [];
  
  for (let x = centerX - radius; x <= centerX + radius; x++) {
    for (let y = centerY - radius; y <= centerY + radius; y++) {
      tiles.push(this.tileLoader.loadTile(x, y, zoom));
    }
  }
  
  return Promise.all(tiles);
};

StartAnywhereUI.prototype.addUIControls = function() {
  // Add UI controls to map
  const controlDiv = document.createElement('div');
  controlDiv.style.cssText = `
    position: absolute;
    top: 10px;
    right: 10px;
    background: white;
    padding: 10px;
    border-radius: 5px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    z-index: 1000;
  `;
  
  controlDiv.innerHTML = `
    <h4>Start Anywhere</h4>
    <p>Click on the map to load tiles</p>
    <button id="clearCacheBtn">Clear Cache</button>
  `;
  
  document.body.appendChild(controlDiv);
  
  // Add event listeners
  document.getElementById('clearCacheBtn').addEventListener('click', () => {
    this.tileLoader.clearCache();
  });
};

StartAnywhereUI.prototype.removeUIControls = function() {
  const controlDiv = document.querySelector('[style*="position: absolute"]');
  if (controlDiv) {
    controlDiv.remove();
  }
};

StartAnywhereUI.prototype.showLoadingIndicator = function() {
  // Show loading indicator
  const indicator = document.createElement('div');
  indicator.id = 'loadingIndicator';
  indicator.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.8);
    color: white;
    padding: 20px;
    border-radius: 5px;
    z-index: 10000;
  `;
  indicator.textContent = 'Loading tiles...';
  
  document.body.appendChild(indicator);
  
  // Hide after 2 seconds
  setTimeout(() => {
    const el = document.getElementById('loadingIndicator');
    if (el) el.remove();
  }, 2000);
};

/**
 * Validation functions
 */
function validateTileIndex(tileIndex) {
  const errors = [];
  
  if (!tileIndex.x || typeof tileIndex.x !== 'number') {
    errors.push('Invalid x coordinate');
  }
  
  if (!tileIndex.y || typeof tileIndex.y !== 'number') {
    errors.push('Invalid y coordinate');
  }
  
  if (!tileIndex.zoom || typeof tileIndex.zoom !== 'number') {
    errors.push('Invalid zoom level');
  }
  
  if (tileIndex.zoom < 0 || tileIndex.zoom > 20) {
    errors.push('Zoom level out of range');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

function validateTile(tile) {
  const errors = [];
  
  if (!tile.id) errors.push('Missing tile ID');
  if (!tile.bounds) errors.push('Missing tile bounds');
  if (!tile.data) errors.push('Missing tile data');
  
  if (tile.bounds) {
    if (typeof tile.bounds.north !== 'number') errors.push('Invalid north bound');
    if (typeof tile.bounds.south !== 'number') errors.push('Invalid south bound');
    if (typeof tile.bounds.east !== 'number') errors.push('Invalid east bound');
    if (typeof tile.bounds.west !== 'number') errors.push('Invalid west bound');
    
    if (tile.bounds.north <= tile.bounds.south) errors.push('Invalid latitude bounds');
    if (tile.bounds.east <= tile.bounds.west) errors.push('Invalid longitude bounds');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Make functions globally available
window.TileSystem = TileSystem;
window.TileLoader = TileLoader;
window.StartAnywhereUI = StartAnywhereUI;
window.validateTileIndex = validateTileIndex;
window.validateTile = validateTile;
