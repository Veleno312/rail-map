// src/sim-core/tile_system.js
// Tile Loading System [3.4-3.5] - Progressive world expansion

/**
 * Tile ID scheme and utilities
 */
export class TileSystem {
  constructor(tileSize = 1.0) { // tileSize in degrees
    this.tileSize = tileSize;
    this.loadedTiles = new Map();
    this.tileIndex = null;
    this.countryIndex = null;
  }
  
  /**
   * Convert lat/lng to tile coordinates
   */
  latLngToTile(lat, lng) {
    const x = Math.floor((lng + 180) / this.tileSize);
    const y = Math.floor((lat + 90) / this.tileSize);
    return { x, y };
  }
  
  /**
   * Convert tile coordinates to lat/lng bounds
   */
  tileToLatLngBounds(x, y) {
    const west = x * this.tileSize - 180;
    const east = (x + 1) * this.tileSize - 180;
    const south = y * this.tileSize - 90;
    const north = (y + 1) * this.tileSize - 90;
    
    return { west, east, south, north };
  }
  
  /**
   * Generate tile ID
   */
  getTileId(x, y) {
    return `${x}_${y}`;
  }
  
  /**
   * Get neighboring tiles
   */
  getNeighborTiles(x, y) {
    return [
      { x: x - 1, y: y - 1 }, { x: x, y: y - 1 }, { x: x + 1, y: y - 1 },
      { x: x - 1, y: y },     { x: x + 1, y: y },
      { x: x - 1, y: y + 1 }, { x: x, y: y + 1 }, { x: x + 1, y: y + 1 }
    ];
  }
  
  /**
   * Get tiles needed for a bounding box
   */
  getTilesForBounds(bounds) {
    const { north, south, east, west } = bounds;
    
    const minTile = this.latLngToTile(south, west);
    const maxTile = this.latLngToTile(north, east);
    
    const tiles = [];
    for (let x = minTile.x; x <= maxTile.x; x++) {
      for (let y = minTile.y; y <= maxTile.y; y++) {
        tiles.push({ x, y, id: this.getTileId(x, y) });
      }
    }
    
    return tiles;
  }
}

/**
 * Tile loader with caching and progressive loading
 */
export class TileLoader {
  constructor(tileSystem, maxTiles = 100) {
    this.tileSystem = tileSystem;
    this.maxTiles = maxTiles;
    this.cache = new Map();
    this.loadPromises = new Map();
    this.loadedTileIds = new Set();
  }
  
  /**
   * Load tiles into state (merge/dedupe)
   */
  async loadWorldTiles({ version, tileIds, onProgress }) {
    const startTime = Date.now();
    const results = {
      loaded: [],
      failed: [],
      merged: 0,
      duplicates: 0
    };
    
    // Check memory constraints
    if (this.loadedTileIds.size + tileIds.length > this.maxTiles) {
      const tilesToUnload = this.loadedTileIds.size + tileIds.length - this.maxTiles;
      await this.unloadOldestTiles(tilesToUnload);
    }
    
    // Load tiles in parallel with batching
    const batchSize = 10;
    for (let i = 0; i < tileIds.length; i += batchSize) {
      const batch = tileIds.slice(i, i + batchSize);
      const batchPromises = batch.map(tileId => this.loadSingleTile(tileId, version));
      
      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          const tileId = batch[index];
          if (result.status === 'fulfilled') {
            if (result.value) {
              if (this.loadedTileIds.has(tileId)) {
                results.duplicates++;
              } else {
                results.loaded.push(result.value);
                this.loadedTileIds.add(tileId);
              }
            }
          } else {
            results.failed.push({ tileId, error: result.reason });
          }
        });
        
        if (onProgress) {
          onProgress({
            loaded: results.loaded.length,
            total: tileIds.length,
            progress: (i + batchSize) / tileIds.length
          });
        }
        
      } catch (error) {
        console.error('Batch loading error:', error);
      }
    }
    
    const loadTime = Date.now() - startTime;
    console.log(`Loaded ${results.loaded.length} tiles in ${loadTime}ms`);
    
    return results;
  }
  
  /**
   * Load a single tile with caching
   */
  async loadSingleTile(tileId, version) {
    // Check cache first
    const cacheKey = `${tileId}_${version}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    // Check if already loading
    if (this.loadPromises.has(cacheKey)) {
      return this.loadPromises.get(cacheKey);
    }
    
    // Start loading
    const loadPromise = this.fetchTileData(tileId, version);
    this.loadPromises.set(cacheKey, loadPromise);
    
    try {
      const tileData = await loadPromise;
      
      // Cache the result
      this.cache.set(cacheKey, tileData);
      this.loadPromises.delete(cacheKey);
      
      return tileData;
    } catch (error) {
      this.loadPromises.delete(cacheKey);
      throw error;
    }
  }
  
  /**
   * Fetch tile data (implementation-specific)
   */
  async fetchTileData(tileId, version) {
    // This would be implemented based on your data source
    // For now, return mock data
    const [x, y] = tileId.split('_').map(Number);
    const bounds = this.tileSystem.tileToLatLngBounds(x, y);
    
    return {
      id: tileId,
      version,
      bounds,
      nodes: [], // Would contain actual node data
      edges: [], // Would contain actual edge data
      metadata: {
        loadTime: Date.now(),
        source: 'mock',
        size: 0
      }
    };
  }
  
  /**
   * Load neighbor tiles on demand
   */
  async loadNeighborTiles(centerTileIds, version) {
    const neighborTileIds = new Set();
    
    for (const tileId of centerTileIds) {
      const [x, y] = tileId.split('_').map(Number);
      const neighbors = this.tileSystem.getNeighborTiles(x, y);
      
      neighbors.forEach(neighbor => {
        const neighborId = this.tileSystem.getTileId(neighbor.x, neighbor.y);
        if (!this.loadedTileIds.has(neighborId)) {
          neighborTileIds.add(neighborId);
        }
      });
    }
    
    if (neighborTileIds.size > 0) {
      return this.loadWorldTiles({
        version,
        tileIds: Array.from(neighborTileIds)
      });
    }
    
    return { loaded: [], failed: [], merged: 0, duplicates: 0 };
  }
  
  /**
   * Unload oldest tiles to free memory
   */
  async unloadOldestTiles(count) {
    const tilesToUnload = Array.from(this.loadedTileIds).slice(0, count);
    
    for (const tileId of tilesToUnload) {
      this.loadedTileIds.delete(tileId);
      
      // Remove from cache (all versions)
      for (const cacheKey of this.cache.keys()) {
        if (cacheKey.startsWith(tileId)) {
          this.cache.delete(cacheKey);
        }
      }
    }
    
    console.log(`Unloaded ${tilesToUnload.length} tiles`);
  }
  
  /**
   * Get memory usage statistics
   */
  getMemoryStats() {
    return {
      loadedTiles: this.loadedTileIds.size,
      maxTiles: this.maxTiles,
      cacheSize: this.cache.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }
  
  /**
   * Estimate memory usage (rough approximation)
   */
  estimateMemoryUsage() {
    let totalSize = 0;
    for (const tileData of this.cache.values()) {
      totalSize += JSON.stringify(tileData).length;
    }
    return totalSize;
  }
}

/**
 * Start-anywhere UI helper
 */
export class StartAnywhereUI {
  constructor(tileSystem, tileLoader) {
    this.tileSystem = tileSystem;
    this.tileLoader = tileLoader;
  }
  
  /**
   * Get available countries/regions
   */
  async getAvailableCountries() {
    // This would load from countries.json
    return [
      { id: 'es', name: 'Spain', bbox: { north: 44, south: 36, east: 4, west: -9 } },
      { id: 'fr', name: 'France', bbox: { north: 51, south: 42, east: 10, west: -5 } },
      { id: 'de', name: 'Germany', bbox: { north: 55, south: 47, east: 15, west: 5 } }
    ];
  }
  
  /**
   * Get tiles needed for a country
   */
  getTilesForCountry(countryId) {
    const countries = this.getAvailableCountries();
    const country = countries.find(c => c.id === countryId);
    
    if (!country) {
      throw new Error(`Country ${countryId} not found`);
    }
    
    return this.tileSystem.getTilesForBounds(country.bbox);
  }
  
  /**
   * Start game at specific location
   */
  async startAtLocation({ countryId, cityId, version }) {
    let tiles;
    
    if (countryId) {
      tiles = this.getTilesForCountry(countryId);
    } else if (cityId) {
      // Would look up city bounds and get tiles
      throw new Error('City-based start not implemented yet');
    } else {
      throw new Error('Must specify countryId or cityId');
    }
    
    const tileIds = tiles.map(tile => tile.id);
    
    return this.tileLoader.loadWorldTiles({
      version,
      tileIds,
      onProgress: (progress) => {
        console.log(`Loading progress: ${Math.round(progress.progress * 100)}%`);
      }
    });
  }
}

/**
 * Tile index format validator
 */
export function validateTileIndex(tileIndex) {
  const errors = [];
  
  if (!tileIndex || typeof tileIndex !== 'object') {
    errors.push('Tile index must be an object');
    return { valid: false, errors };
  }
  
  // Check required fields
  const requiredFields = ['version', 'tiles'];
  for (const field of requiredFields) {
    if (!(field in tileIndex)) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate tiles array
  if (tileIndex.tiles && !Array.isArray(tileIndex.tiles)) {
    errors.push('tiles must be an array');
  }
  
  // Validate individual tiles
  if (Array.isArray(tileIndex.tiles)) {
    tileIndex.tiles.forEach((tile, index) => {
      const tileErrors = validateTile(tile);
      if (tileErrors.length > 0) {
        errors.push(`Tile ${index}: ${tileErrors.join(', ')}`);
      }
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate individual tile
 */
function validateTile(tile) {
  const errors = [];
  
  if (!tile.id || typeof tile.id !== 'string') {
    errors.push('tile must have string id');
  }
  
  if (!tile.bounds || typeof tile.bounds !== 'object') {
    errors.push('tile must have bounds object');
  } else {
    const { north, south, east, west } = tile.bounds;
    if (typeof north !== 'number' || typeof south !== 'number' ||
        typeof east !== 'number' || typeof west !== 'number') {
      errors.push('bounds must contain numeric coordinates');
    }
  }
  
  if (!Array.isArray(tile.nodes)) {
    errors.push('tile must have nodes array');
  }
  
  if (!Array.isArray(tile.edges)) {
    errors.push('tile must have edges array');
  }
  
  return errors;
}
