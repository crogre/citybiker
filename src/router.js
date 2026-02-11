import { haversine } from './utils.js';

/**
 * Min-heap priority queue for Dijkstra's algorithm.
 * Stores { id, cost } entries ordered by cost.
 */
class MinHeap {
  constructor() {
    this.heap = [];
  }

  push(id, cost) {
    this.heap.push({ id, cost });
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() {
    return this.heap.length;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].cost < this.heap[parent].cost) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;

      if (left < n && this.heap[left].cost < this.heap[smallest].cost) {
        smallest = left;
      }
      if (right < n && this.heap[right].cost < this.heap[smallest].cost) {
        smallest = right;
      }

      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }
}

/**
 * Custom cost function for bike routing.
 *
 * @param {object} edge - { target, distance (meters), speed (km/h) }
 * @param {object} targetNode - { lat, lon, isTrafficSignal }
 * @param {number} trafficLightPenalty - Penalty in seconds for traffic lights
 * @returns {number} Cost in seconds
 */
function edgeCost(edge, targetNode, trafficLightPenalty) {
  // Travel time in seconds: distance(m) / speed(m/s)
  const speedMs = (edge.speed * 1000) / 3600;
  let cost = edge.distance / speedMs;

  // Add traffic light penalty if the target node is a traffic signal
  if (targetNode && targetNode.isTrafficSignal) {
    cost += trafficLightPenalty;
  }

  return cost;
}

/**
 * A* heuristic: straight-line travel time at max bike speed (20 km/h).
 */
function heuristic(nodeA, nodeB) {
  const dist = haversine(nodeA.lat, nodeA.lon, nodeB.lat, nodeB.lon);
  const maxSpeedMs = (20 * 1000) / 3600; // 20 km/h in m/s
  return dist / maxSpeedMs;
}

/**
 * Find the shortest path using A* with custom bike cost function.
 *
 * @param {Map} nodes - Map<nodeId, { lat, lon, isTrafficSignal }>
 * @param {Map} adjacency - Map<nodeId, Array<{ target, distance, speed }>>
 * @param {number} startId - Start node ID
 * @param {number} endId - End node ID
 * @param {number} trafficLightPenalty - Penalty in seconds (default 60)
 * @returns {object|null} { path: [nodeId, ...], cost, distance, trafficLights }
 */
export function findRoute(nodes, adjacency, startId, endId, trafficLightPenalty = 60) {
  const endNode = nodes.get(endId);
  if (!endNode) return null;

  const gScore = new Map();
  const prev = new Map();
  const visited = new Set();
  const pq = new MinHeap();

  gScore.set(startId, 0);
  pq.push(startId, heuristic(nodes.get(startId), endNode));

  while (pq.size > 0) {
    const { id: current } = pq.pop();

    if (current === endId) {
      // Reconstruct path
      return reconstructRoute(nodes, prev, startId, endId, gScore.get(endId));
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const edges = adjacency.get(current);
    if (!edges) continue;

    const currentG = gScore.get(current);

    for (const edge of edges) {
      if (visited.has(edge.target)) continue;

      const targetNode = nodes.get(edge.target);
      if (!targetNode) continue;

      const cost = edgeCost(edge, targetNode, trafficLightPenalty);
      const tentativeG = currentG + cost;

      if (!gScore.has(edge.target) || tentativeG < gScore.get(edge.target)) {
        gScore.set(edge.target, tentativeG);
        prev.set(edge.target, { from: current, distance: edge.distance });

        const f = tentativeG + heuristic(targetNode, endNode);
        pq.push(edge.target, f);
      }
    }
  }

  return null; // No route found
}

/**
 * Reconstruct the path and gather route statistics.
 */
function reconstructRoute(nodes, prev, startId, endId, totalCost) {
  const path = [];
  let current = endId;
  let totalDistance = 0;
  let trafficLights = 0;
  const trafficLightNodes = [];

  while (current !== undefined) {
    const node = nodes.get(current);
    path.push({ id: current, lat: node.lat, lon: node.lon });

    if (node.isTrafficSignal && current !== startId) {
      trafficLights++;
      trafficLightNodes.push({ lat: node.lat, lon: node.lon });
    }

    const prevEntry = prev.get(current);
    if (prevEntry) {
      totalDistance += prevEntry.distance;
      current = prevEntry.from;
    } else {
      break;
    }
  }

  path.reverse();
  trafficLightNodes.reverse();

  return {
    path,
    cost: totalCost,
    distance: totalDistance,
    trafficLights,
    trafficLightNodes,
  };
}
