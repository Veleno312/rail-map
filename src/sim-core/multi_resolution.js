// src/sim-core/multi_resolution.js
// Multi-resolution Nodes [4.2-4.4] - Clustering for performance

/**
 * Multi-resolution node manager
 */
export class MultiResolutionManager {
  constructor(options = {}) {
    this.options = {
      // Population thresholds for different resolution levels
      L0_threshold: 500,      // Minimum population for L0 (highest detail)
      L1_threshold: 50000,    // Minimum for L1 (medium detail)  
      L2_threshold: 500000,    // Minimum for L2 (low detail)
      // Clustering parameters
      clusterRadius: 10000,    // 10km clustering radius
      maxNodesPerCluster: 50,  // Maximum nodes in a cluster
      // Performance parameters
      maxActiveNodes: 10000,   // Maximum nodes to keep in memory
      ...options
    };
    
    this.nodeLevels = new Map(); // L0, L1, L2 node sets
    this.clusters = new Map();
    this.activeLevel = 'L0';
    this.nodeLookup = new Map(); // Fast node ID lookup
  }
  
  /**
   * Initialize multi-resolution node sets from raw data
   */
  initializeNodes(rawNodes) {
    console.log(`Initializing ${rawNodes.length} nodes for multi-resolution`);
    
    // Clear existing data
    this.nodeLevels.clear();
    this.clusters.clear();
    this.nodeLookup.clear();
    
    // Filter and categorize nodes by population
    const L0_nodes = [];
    const L1_nodes = [];
    const L2_nodes = [];
    
    for (const node of rawNodes) {
      if (!node.population) continue;
      
      // Create node with resolution metadata
      const resolutionNode = {
        ...node,
        resolution: this.getResolutionLevel(node.population),
        children: [],
        parent: null,
        clusterId: null
      };
      
      // Categorize by resolution level
      switch (resolutionNode.resolution) {
        case 'L0':
          L0_nodes.push(resolutionNode);
          break;
        case 'L1':
          L1_nodes.push(resolutionNode);
          break;
        case 'L2':
          L2_nodes.push(resolutionNode);
          break;
      }
      
      this.nodeLookup.set(node.id, resolutionNode);
    }
    
    // Create clusters for each level
    this.nodeLevels.set('L0', this.createClusters(L0_nodes, 'L0'));
    this.nodeLevels.set('L1', this.createClusters(L1_nodes, 'L1'));
    this.nodeLevels.set('L2', this.createClusters(L2_nodes, 'L2'));
    
    // Build hierarchical relationships
    this.buildHierarchy();
    
    console.log(`Multi-resolution initialized: L0=${L0_nodes.length}, L1=${L1_nodes.length}, L2=${L2_nodes.length}`);
  }
  
  /**
   * Determine resolution level based on population
   */
  getResolutionLevel(population) {
    if (population >= this.options.L2_threshold) return 'L2';
    if (population >= this.options.L1_threshold) return 'L1';
    if (population >= this.options.L0_threshold) return 'L0';
    return null; // Below minimum threshold
  }
  
  /**
   * Create clusters for a given resolution level
   */
  createClusters(nodes, level) {
    if (nodes.length === 0) return [];
    
    console.log(`Creating ${level} clusters for ${nodes.length} nodes`);
    
    const clusters = [];
    const unassigned = new Set(nodes);
    const clusterRadius = this.getClusterRadius(level);
    
    while (unassigned.size > 0) {
      const cluster = this.createCluster(unassigned, clusterRadius);
      if (cluster.nodes.length > 0) {
        clusters.push(cluster);
        this.clusters.set(cluster.id, cluster);
        
        // Mark nodes as assigned
        cluster.nodes.forEach(node => {
          node.clusterId = cluster.id;
          unassigned.delete(node);
        });
      } else {
        // Safety break
        break;
      }
    }
    
    return clusters;
  }
  
  /**
   * Create a single cluster using spatial proximity
   */
  createCluster(unassignedNodes, radius) {
    if (unassignedNodes.size === 0) return { id: '', nodes: [], center: null };
    
    // Pick a seed node
    const seedNode = unassignedNodes.values().next().value;
    const clusterNodes = [seedNode];
    
    // Find nearby nodes
    const nearbyNodes = [];
    for (const node of unassignedNodes) {
      if (node === seedNode) continue;
      
      const distance = this.calculateDistance(seedNode, node);
      if (distance <= radius) {
        nearbyNodes.push({ node, distance });
      }
    }
    
    // Sort by distance and add closest nodes up to limit
    nearbyNodes.sort((a, b) => a.distance - b.distance);
    const maxNodes = Math.min(this.options.maxNodesPerCluster, nearbyNodes.length + 1);
    
    for (let i = 0; i < maxNodes - 1 && i < nearbyNodes.length; i++) {
      clusterNodes.push(nearbyNodes[i].node);
    }
    
    // Calculate cluster center
    const center = this.calculateClusterCenter(clusterNodes);
    
    return {
      id: `cluster_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      nodes: clusterNodes,
      center,
      radius,
      level: clusterNodes[0].resolution,
      totalPopulation: clusterNodes.reduce((sum, node) => sum + (node.population || 0), 0)
    };
  }
  
  /**
   * Calculate distance between two nodes (Haversine formula)
   */
  calculateDistance(node1, node2) {
    const R = 6371000; // Earth radius in meters
    const lat1 = node1.lat * Math.PI / 180;
    const lat2 = node2.lat * Math.PI / 180;
    const deltaLat = (node2.lat - node1.lat) * Math.PI / 180;
    const deltaLng = (node2.lng - node1.lng) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }
  
  /**
   * Calculate cluster center (weighted by population)
   */
  calculateClusterCenter(nodes) {
    if (nodes.length === 0) return null;
    
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLng = 0;
    
    for (const node of nodes) {
      const weight = node.population || 1;
      totalWeight += weight;
      weightedLat += node.lat * weight;
      weightedLng += node.lng * weight;
    }
    
    return {
      lat: weightedLat / totalWeight,
      lng: weightedLng / totalWeight,
      weight: totalWeight
    };
  }
  
  /**
   * Get cluster radius for resolution level
   */
  getClusterRadius(level) {
    switch (level) {
      case 'L0': return this.options.clusterRadius * 0.5;  // 5km
      case 'L1': return this.options.clusterRadius;        // 10km  
      case 'L2': return this.options.clusterRadius * 2;   // 20km
      default: return this.options.clusterRadius;
    }
  }
  
  /**
   * Build hierarchical relationships between levels
   */
  buildHierarchy() {
    // L2 nodes can be parents of L1 clusters
    // L1 nodes can be parents of L0 clusters
    
    for (const [level, clusters] of this.nodeLevels) {
      for (const cluster of clusters) {
        for (const node of cluster.nodes) {
          // Find potential parent at higher level
          const parentLevel = this.getParentLevel(level);
          if (parentLevel) {
            const parent = this.findParentNode(node, parentLevel);
            if (parent) {
              node.parent = parent.id;
              parent.children.push(node.id);
            }
          }
        }
      }
    }
  }
  
  /**
   * Get parent level for given level
   */
  getParentLevel(level) {
    switch (level) {
      case 'L0': return 'L1';
      case 'L1': return 'L2';
      case 'L2': return null;
      default: return null;
    }
  }
  
  /**
   * Find parent node at higher level
   */
  findParentNode(childNode, parentLevel) {
    const parentClusters = this.nodeLevels.get(parentLevel) || [];
    
    let bestParent = null;
    let minDistance = Infinity;
    
    for (const cluster of parentClusters) {
      for (const parentNode of cluster.nodes) {
        const distance = this.calculateDistance(childNode, parentNode);
        if (distance < minDistance) {
          minDistance = distance;
          bestParent = parentNode;
        }
      }
    }
    
    return bestParent;
  }
  
  /**
   * Get active nodes based on zoom level and selection
   */
  getActiveNodes(zoomLevel, bounds = null) {
    const level = this.getLevelForZoom(zoomLevel);
    const clusters = this.nodeLevels.get(level) || [];
    
    let activeNodes = [];
    
    for (const cluster of clusters) {
      // Filter by bounds if provided
      if (bounds && !this.isClusterInBounds(cluster, bounds)) {
        continue;
      }
      
      // Add cluster representative node
      const representative = this.createRepresentativeNode(cluster);
      activeNodes.push(representative);
    }
    
    // Apply node count limits
    if (activeNodes.length > this.options.maxActiveNodes) {
      activeNodes = this.sampleNodes(activeNodes, this.options.maxActiveNodes);
    }
    
    return activeNodes;
  }
  
  /**
   * Get resolution level for zoom level
   */
  getLevelForZoom(zoomLevel) {
    if (zoomLevel >= 10) return 'L0';  // High detail
    if (zoomLevel >= 7) return 'L1';   // Medium detail
    return 'L2';                        // Low detail
  }
  
  /**
   * Check if cluster intersects bounds
   */
  isClusterInBounds(cluster, bounds) {
    if (!cluster.center) return false;
    
    const { north, south, east, west } = bounds;
    const { lat, lng } = cluster.center;
    
    return lat <= north && lat >= south && lng <= east && lng >= west;
  }
  
  /**
   * Create representative node for cluster
   */
  createRepresentativeNode(cluster) {
    return {
      id: `rep_${cluster.id}`,
      type: 'cluster_representative',
      lat: cluster.center.lat,
      lng: cluster.center.lng,
      population: cluster.totalPopulation,
      name: this.generateClusterName(cluster),
      clusterId: cluster.id,
      level: cluster.level,
      nodeCount: cluster.nodes.length,
      originalNodes: cluster.nodes.map(n => n.id)
    };
  }
  
  /**
   * Generate cluster name
   */
  generateClusterName(cluster) {
    if (cluster.nodes.length === 1) {
      return cluster.nodes[0].name || 'Unknown';
    }
    
    const mainCity = cluster.nodes.reduce((prev, current) => 
      (prev.population > current.population) ? prev : current
    );
    
    return `${mainCity.name || 'Unknown'} Area (${cluster.nodes.length} places)`;
  }
  
  /**
   * Sample nodes to stay within limits
   */
  sampleNodes(nodes, maxCount) {
    if (nodes.length <= maxCount) return nodes;
    
    // Sort by population (keep most important)
    nodes.sort((a, b) => (b.population || 0) - (a.population || 0));
    
    return nodes.slice(0, maxCount);
  }
  
  /**
   * Get detailed nodes for a cluster (when zooming in)
   */
  getClusterNodes(clusterId) {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return [];
    
    return cluster.nodes;
  }
  
  /**
   * Get statistics about multi-resolution system
   */
  getStatistics() {
    const stats = {
      totalNodes: 0,
      clusters: {},
      memoryUsage: 0
    };
    
    for (const [level, clusters] of this.nodeLevels) {
      const nodeCount = clusters.reduce((sum, cluster) => sum + cluster.nodes.length, 0);
      stats.clusters[level] = {
        clusterCount: clusters.length,
        nodeCount,
        avgNodesPerCluster: nodeCount / clusters.length || 0
      };
      stats.totalNodes += nodeCount;
    }
    
    // Rough memory estimate
    stats.memoryUsage = stats.totalNodes * 200; // ~200 bytes per node
    
    return stats;
  }
}

/**
 * OD matrix manager for multi-resolution
 */
export class ODMatrixManager {
  constructor(multiResManager) {
    this.multiRes = multiResManager;
    this.odMatrices = new Map(); // level -> OD matrix
    this.samplingPolicy = 'uniform';
  }
  
  /**
   * Generate OD matrix for given resolution level
   */
  generateODMatrix(level, bounds = null) {
    const activeNodes = this.multiRes.getActiveNodes(this.getZoomForLevel(level), bounds);
    
    const odMatrix = new Map();
    
    for (const origin of activeNodes) {
      const destinations = new Map();
      
      for (const destination of activeNodes) {
        if (origin.id === destination.id) continue;
        
        // Calculate demand based on gravity model
        const demand = this.calculateDemand(origin, destination);
        if (demand > 0) {
          destinations.set(destination.id, {
            demand,
            distance: this.multiRes.calculateDistance(origin, destination),
            destination: destination
          });
        }
      }
      
      odMatrix.set(origin.id, destinations);
    }
    
    this.odMatrices.set(level, odMatrix);
    return odMatrix;
  }
  
  /**
   * Calculate demand between two nodes (gravity model)
   */
  calculateDemand(origin, destination) {
    const population1 = origin.population || 1;
    const population2 = destination.population || 1;
    const distance = this.multiRes.calculateDistance(origin, destination);
    
    // Gravity model: Demand = k * P1 * P2 / distance^2
    const k = 0.001; // Calibration constant
    const friction = Math.pow(distance / 1000 + 1, 2); // Distance in km
    
    return k * population1 * population2 / friction;
  }
  
  /**
   * Get zoom level for resolution level
   */
  getZoomForLevel(level) {
    switch (level) {
      case 'L0': return 12;
      case 'L1': return 9;
      case 'L2': return 6;
      default: return 6;
    }
  }
  
  /**
   * Apply sampling policy to reduce OD matrix size
   */
  applySampling(odMatrix, maxOrigins = 1000, maxDestinations = 50) {
    const origins = Array.from(odMatrix.keys());
    
    if (origins.length <= maxOrigins) {
      return odMatrix;
    }
    
    // Sample origins by importance (population)
    const sampledOrigins = this.sampleByImportance(origins, maxOrigins);
    const sampledMatrix = new Map();
    
    for (const originId of sampledOrigins) {
      const destinations = odMatrix.get(originId);
      const destArray = Array.from(destinations.entries());
      
      // Sample destinations by demand
      const sampledDests = this.sampleByDemand(destArray, maxDestinations);
      sampledMatrix.set(originId, new Map(sampledDests));
    }
    
    return sampledMatrix;
  }
  
  /**
   * Sample by importance (population)
   */
  sampleByImportance(items, maxCount) {
    // Sort by population (descending)
    items.sort((a, b) => {
      const nodeA = this.multiRes.nodeLookup.get(a);
      const nodeB = this.multiRes.nodeLookup.get(b);
      return (nodeB?.population || 0) - (nodeA?.population || 0);
    });
    
    return items.slice(0, maxCount);
  }
  
  /**
   * Sample by demand
   */
  sampleByDemand(destArray, maxCount) {
    // Sort by demand (descending)
    destArray.sort((a, b) => b[1].demand - a[1].demand);
    return destArray.slice(0, maxCount);
  }
}
