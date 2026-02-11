import { haversine } from './utils.js';

/**
 * Bike-friendliness speed factors for different highway types.
 * Higher speed = more preferred by the router (lower cost per meter).
 * Values represent comfortable cycling speed on each road type in km/h.
 */
const HIGHWAY_SPEEDS = {
  cycleway: 18,
  path: 14,
  track: 12,
  living_street: 16,
  residential: 16,
  pedestrian: 10,
  unclassified: 15,
  service: 12,
  tertiary: 15,
  tertiary_link: 14,
  secondary: 13,
  secondary_link: 12,
  primary: 11,
  primary_link: 10,
  trunk: 8,
  trunk_link: 8,
};

const DEFAULT_SPEED = 14;

/**
 * Speed bonus multiplier when a way has dedicated cycling infrastructure.
 */
const CYCLEWAY_TAG_BONUS = {
  lane: 1.2,
  track: 1.3,
  shared_lane: 1.1,
  opposite_lane: 1.15,
  opposite_track: 1.25,
};

/**
 * Build a routing graph from raw OSM elements.
 *
 * Returns:
 *   nodes: Map<nodeId, { lat, lon, isTrafficSignal }>
 *   adjacency: Map<nodeId, Array<{ target, distance, speed }>>
 *   trafficSignalIds: Set<nodeId>
 */
export function buildGraph(elements, onProgress) {
  if (onProgress) onProgress('Building routing graph...');

  // Index nodes
  const nodes = new Map();
  const trafficSignalIds = new Set();

  for (const el of elements) {
    if (el.type === 'node') {
      const isSignal =
        el.tags && el.tags.highway === 'traffic_signals';
      nodes.set(el.id, {
        lat: el.lat,
        lon: el.lon,
        isTrafficSignal: !!isSignal,
      });
      if (isSignal) {
        trafficSignalIds.add(el.id);
      }
    }
  }

  // Build adjacency list from ways
  const adjacency = new Map();

  function addEdge(from, to, distance, speed) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ target: to, distance, speed });
  }

  let wayCount = 0;
  let edgeCount = 0;

  for (const el of elements) {
    if (el.type !== 'way' || !el.tags || !el.nodes || el.nodes.length < 2) continue;

    const highway = el.tags.highway;
    if (!highway) continue;

    // Check if cycling is explicitly forbidden
    const bicycle = el.tags.bicycle;
    if (bicycle === 'no' || bicycle === 'dismount') continue;

    // Determine base speed for this way type
    let baseSpeed = HIGHWAY_SPEEDS[highway] || DEFAULT_SPEED;

    // Apply cycleway bonus
    const cycleway = el.tags.cycleway;
    if (cycleway && CYCLEWAY_TAG_BONUS[cycleway]) {
      baseSpeed *= CYCLEWAY_TAG_BONUS[cycleway];
    }

    // Check for bicycle=designated or cycleway=* tags on the way
    if (bicycle === 'designated' || bicycle === 'yes') {
      baseSpeed *= 1.1;
    }

    // Determine if the way is one-way for bikes
    const oneway = el.tags.oneway;
    const onewayBicycle = el.tags['oneway:bicycle'];
    const isOneway =
      onewayBicycle === 'yes' ||
      (oneway === 'yes' && onewayBicycle !== 'no');
    const isReverseOneway = oneway === '-1';

    // Create edges between consecutive nodes in the way
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const fromId = el.nodes[i];
      const toId = el.nodes[i + 1];

      const fromNode = nodes.get(fromId);
      const toNode = nodes.get(toId);

      if (!fromNode || !toNode) continue;

      const dist = haversine(fromNode.lat, fromNode.lon, toNode.lat, toNode.lon);

      if (isReverseOneway) {
        // Reverse one-way: only backward
        addEdge(toId, fromId, dist, baseSpeed);
      } else if (isOneway) {
        // Forward one-way only
        addEdge(fromId, toId, dist, baseSpeed);
      } else {
        // Bidirectional
        addEdge(fromId, toId, dist, baseSpeed);
        addEdge(toId, fromId, dist, baseSpeed);
      }

      edgeCount++;
    }

    wayCount++;
  }

  // Remove nodes that have no edges (not part of the routing graph)
  // Keep only nodes referenced in adjacency
  const reachableNodes = new Set();
  for (const [from, edges] of adjacency) {
    reachableNodes.add(from);
    for (const e of edges) {
      reachableNodes.add(e.target);
    }
  }

  if (onProgress) {
    onProgress(
      `Graph built: ${reachableNodes.size.toLocaleString()} nodes, ` +
      `${edgeCount.toLocaleString()} edges, ` +
      `${trafficSignalIds.size.toLocaleString()} traffic lights`
    );
  }

  return { nodes, adjacency, trafficSignalIds };
}

/**
 * Find the nearest graph node to a given lat/lon.
 */
export function findNearestNode(nodes, adjacency, lat, lon) {
  let bestId = null;
  let bestDist = Infinity;

  for (const [id, node] of nodes) {
    // Only consider nodes that are part of the routing graph
    if (!adjacency.has(id)) continue;

    const d = haversine(lat, lon, node.lat, node.lon);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }

  return { id: bestId, distance: bestDist };
}
