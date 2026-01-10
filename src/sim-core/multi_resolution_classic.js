// src/sim-core/multi_resolution_classic.js
// Multi-resolution Nodes [4.2-4.4] - Clustering for performance

/**
 * Multi-resolution manager for handling different node detail levels
 */
function MultiResolutionManager() {
  this.nodes = new Map();
  this.clusters = new Map();
  this.resolutionLevels = ['L0', 'L1', 'L2']; // L0=finest, L2=coarsest
  this.activeLevel = 'L0';
  this.maxNodesPerCluster = 10;
  this.clusterHierarchy = new Map();
}

MultiResolutionManager.prototype.addNode = function(node, level) {
  level = level || 'L0';
  
  const nodeData = {
    ...node,
    level,
    children: new Set(),
    parent: null,
    clusterId: null,
    isActive: level === this.activeLevel
  };
  
  this.nodes.set(node.id, nodeData);
  
  if (level === 'L0') {
    this.updateClusters();
  }
  
  return nodeData;
};

MultiResolutionManager.prototype.updateClusters = function() {
  // Clear existing clusters
  this.clusters.clear();
  this.clusterHierarchy.clear();
  
  // Get all L0 nodes
  const l0Nodes = Array.from(this.nodes.values()).filter(n => n.level === 'L0');
  
  // Create L1 clusters
  const l1Clusters = this.createClusters(l0Nodes, 'L1');
  
  // Create L2 clusters from L1 clusters
  const l1ClusterNodes = l1Clusters.map(cluster => this.createClusterNode(cluster, 'L1'));
  const l2Clusters = this.createClusters(l1ClusterNodes, 'L2');
  
  // Build hierarchy
  this.buildHierarchy(l0Nodes, l1Clusters, l2Clusters);
};

MultiResolutionManager.prototype.createClusters = function(nodes, targetLevel) {
  const clusters = [];
  const unclustered = [...nodes];
  
  while (unclustered.length > 0) {
    const cluster = {
      id: `cluster_${targetLevel}_${clusters.length}`,
      level: targetLevel,
      nodes: [],
      center: { lat: 0, lng: 0 },
      totalWeight: 0
    };
    
    // Fill cluster up to max size
    while (cluster.nodes.length < this.maxNodesPerCluster && unclustered.length > 0) {
      const node = unclustered.shift();
      cluster.nodes.push(node);
      node.clusterId = cluster.id;
      node.parent = cluster.id;
      
      // Update center (weighted average)
      const weight = node.population || 1;
      cluster.center.lat = (cluster.center.lat * cluster.totalWeight + node.lat * weight) / (cluster.totalWeight + weight);
      cluster.center.lng = (cluster.center.lng * cluster.totalWeight + node.lng * weight) / (cluster.totalWeight + weight);
      cluster.totalWeight += weight;
    }
    
    clusters.push(cluster);
    this.clusters.set(cluster.id, cluster);
  }
  
  return clusters;
};

MultiResolutionManager.prototype.createClusterNode = function(cluster, level) {
  return {
    id: cluster.id,
    lat: cluster.center.lat,
    lng: cluster.center.lng,
    level: level,
    population: cluster.totalWeight,
    name: `Cluster ${cluster.id}`,
    type: 'cluster',
    clusterId: level === 'L1' ? null : cluster.parent,
    children: new Set(cluster.nodes.map(n => n.id)),
    parent: null,
    isActive: level === this.activeLevel
  };
};

MultiResolutionManager.prototype.buildHierarchy = function(l0Nodes, l1Clusters, l2Clusters) {
  // Build L0 -> L1 relationships
  for (const l0Node of l0Nodes) {
    if (l0Node.clusterId) {
      const l1Cluster = this.clusters.get(l0Node.clusterId);
      if (l1Cluster) {
        l0Node.parent = l1Cluster.id;
        l1Cluster.children = l1Cluster.children || new Set();
        l1Cluster.children.add(l0Node.id);
      }
    }
  }
  
  // Build L1 -> L2 relationships
  for (const l1Cluster of l1Clusters) {
    if (l1Cluster.clusterId) {
      const l2Cluster = this.clusters.get(l1Cluster.clusterId);
      if (l2Cluster) {
        l1Cluster.parent = l2Cluster.id;
        l2Cluster.children = l2Cluster.children || new Set();
        l2Cluster.children.add(l1Cluster.id);
      }
    }
  }
  
  this.clusterHierarchy.set('L0', new Map(l0Nodes.map(n => [n.id, n])));
  this.clusterHierarchy.set('L1', new Map(l1Clusters.map(c => [c.id, c])));
  this.clusterHierarchy.set('L2', new Map(l2Clusters.map(c => [c.id, c])));
};

MultiResolutionManager.prototype.setActiveLevel = function(level) {
  if (!this.resolutionLevels.includes(level)) {
    throw new Error(`Invalid resolution level: ${level}`);
  }
  
  this.activeLevel = level;
  
  // Update active status for all nodes
  for (const node of this.nodes.values()) {
    node.isActive = node.level === level;
  }
  
  // Update active status for clusters
  for (const cluster of this.clusters.values()) {
    cluster.isActive = cluster.level === level;
  }
};

MultiResolutionManager.prototype.getActiveNodes = function() {
  const activeNodes = [];
  
  if (this.activeLevel === 'L0') {
    // Return all L0 nodes
    for (const node of this.nodes.values()) {
      if (node.level === 'L0') {
        activeNodes.push(node);
      }
    }
  } else {
    // Return clusters at active level
    for (const cluster of this.clusters.values()) {
      if (cluster.level === this.activeLevel) {
        activeNodes.push(this.createClusterNode(cluster, this.activeLevel));
      }
    }
  }
  
  return activeNodes;
};

MultiResolutionManager.prototype.getNodeAtLevel = function(nodeId, targetLevel) {
  const node = this.nodes.get(nodeId);
  if (!node) return null;
  
  if (node.level === targetLevel) {
    return node;
  }
  
  // Navigate up or down the hierarchy
  if (targetLevel > node.level) {
    // Go up to coarser level
    return this.getParentNode(nodeId, targetLevel);
  } else {
    // Go down to finer level
    return this.getChildNodes(nodeId, targetLevel);
  }
};

MultiResolutionManager.prototype.getParentNode = function(nodeId, targetLevel) {
  const node = this.nodes.get(nodeId);
  if (!node || !node.parent) return null;
  
  const parent = this.clusters.get(node.parent);
  if (!parent) return null;
  
  if (parent.level === targetLevel) {
    return this.createClusterNode(parent, targetLevel);
  } else {
    return this.getParentNode(parent.id, targetLevel);
  }
};

MultiResolutionManager.prototype.getChildNodes = function(nodeId, targetLevel) {
  const node = this.nodes.get(nodeId) || this.clusters.get(nodeId);
  if (!node || !node.children) return [];
  
  const children = [];
  for (const childId of node.children) {
    const child = this.nodes.get(childId) || this.clusters.get(childId);
    if (child) {
      if (child.level === targetLevel) {
        children.push(child);
      } else if (child.level > targetLevel) {
        children.push(...this.getChildNodes(childId, targetLevel));
      } else {
        children.push(this.getChildNodes(childId, targetLevel));
      }
    }
  }
  
  return children;
};

/**
 * OD Matrix Manager for origin-destination matrices
 */
function ODMatrixManager(multiResolutionManager) {
  this.multiResolutionManager = multiResolutionManager;
  this.odMatrix = new Map();
  this.gravityParams = {
    alpha: 1.0,  // Distance decay
    beta: 0.5,   // Population size exponent
    gamma: 0.3   // Economic activity exponent
  };
}

ODMatrixManager.prototype.generateODMatrix = function(level) {
  const activeNodes = this.multiResolutionManager.getActiveNodes();
  const matrix = new Map();
  
  for (const origin of activeNodes) {
    const row = new Map();
    
    for (const destination of activeNodes) {
      if (origin.id === destination.id) {
        row.set(destination.id, 0);
        continue;
      }
      
      const flow = this.calculateFlow(origin, destination);
      row.set(destination.id, flow);
    }
    
    matrix.set(origin.id, row);
  }
  
  this.odMatrix.set(level, matrix);
  return matrix;
};

ODMatrixManager.prototype.calculateFlow = function(origin, destination) {
  // Gravity model: Flow = k * (Pop_i^beta * Pop_j^gamma) / Distance^alpha
  
  const originPop = origin.population || 1;
  const destPop = destination.population || 1;
  const distance = this.calculateDistance(origin, destination);
  
  const attraction = Math.pow(originPop, this.gravityParams.beta) * 
                    Math.pow(destPop, this.gravityParams.gamma);
  const friction = Math.pow(distance + 1, this.gravityParams.alpha);
  
  return attraction / friction;
};

ODMatrixManager.prototype.calculateDistance = function(origin, destination) {
  // Simple Euclidean distance (in real implementation, use network distance)
  const latDiff = origin.lat - destination.lat;
  const lngDiff = origin.lng - destination.lng;
  
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // Rough conversion to meters
};

ODMatrixManager.prototype.getTotalFlow = function(level) {
  const matrix = this.odMatrix.get(level);
  if (!matrix) return 0;
  
  let totalFlow = 0;
  
  for (const [originId, row] of matrix) {
    for (const [destId, flow] of row) {
      if (originId !== destId) {
        totalFlow += flow;
      }
    }
  }
  
  return totalFlow;
};

ODMatrixManager.prototype.getTopFlows = function(level, limit) {
  limit = limit || 10;
  const matrix = this.odMatrix.get(level);
  if (!matrix) return [];
  
  const flows = [];
  
  for (const [originId, row] of matrix) {
    for (const [destId, flow] of row) {
      if (originId !== destId && flow > 0) {
        flows.push({
          origin: originId,
          destination: destId,
          flow: flow
        });
      }
    }
  }
  
  return flows.sort((a, b) => b.flow - a.flow).slice(0, limit);
};

/**
 * Sampling policies for multi-resolution rendering
 */
function SamplingPolicy() {
  this.policies = {
    'uniform': this.uniformSampling.bind(this),
    'importance': this.importanceSampling.bind(this),
    'adaptive': this.adaptiveSampling.bind(this)
  };
}

SamplingPolicy.prototype.uniformSampling = function(nodes, targetCount) {
  if (nodes.length <= targetCount) return nodes;
  
  const step = Math.floor(nodes.length / targetCount);
  const sampled = [];
  
  for (let i = 0; i < nodes.length; i += step) {
    sampled.push(nodes[i]);
  }
  
  return sampled.slice(0, targetCount);
};

SamplingPolicy.prototype.importanceSampling = function(nodes, targetCount) {
  if (nodes.length <= targetCount) return nodes;
  
  // Sort by importance (population, economic activity, etc.)
  const sorted = nodes.sort((a, b) => {
    const importanceA = (a.population || 0) + (a.economicActivity || 0);
    const importanceB = (b.population || 0) + (b.economicActivity || 0);
    return importanceB - importanceA;
  });
  
  return sorted.slice(0, targetCount);
};

SamplingPolicy.prototype.adaptiveSampling = function(nodes, targetCount, viewport) {
  if (!viewport) {
    return this.importanceSampling(nodes, targetCount);
  }
  
  // Prioritize nodes in viewport
  const inViewport = nodes.filter(node => 
    node.lat >= viewport.south && node.lat <= viewport.north &&
    node.lng >= viewport.west && node.lng <= viewport.east
  );
  
  const outViewport = nodes.filter(node => !inViewport.includes(node));
  
  // Take all in-viewport nodes (up to target count)
  let sampled = inViewport.slice(0, targetCount);
  
  // Fill remaining slots with most important out-of-viewport nodes
  if (sampled.length < targetCount) {
    const remaining = targetCount - sampled.length;
    const importantOut = this.importanceSampling(outViewport, remaining);
    sampled = sampled.concat(importantOut);
  }
  
  return sampled;
};

// Make functions globally available
window.MultiResolutionManager = MultiResolutionManager;
window.ODMatrixManager = ODMatrixManager;
window.SamplingPolicy = SamplingPolicy;
