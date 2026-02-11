/**
 * Fetch the bike-relevant road network for a bounding box from the Overpass API.
 * Returns raw OSM elements (nodes and ways).
 */

// Gothenburg bounding box (generous, covers the central/urban area)
export const GOTHENBURG_BBOX = '57.65,11.85,57.78,12.10';

/**
 * Build the Overpass QL query for bike-relevant infrastructure.
 * Fetches:
 *   - Ways tagged with highway types relevant to cycling
 *   - Nodes tagged as traffic_signals within the bbox
 */
function buildQuery(bbox) {
  return `
[out:json][timeout:60];
(
  way["highway"~"^(cycleway|residential|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|trunk|trunk_link|living_street|pedestrian|path|track|unclassified|service)$"](${bbox});
  node["highway"="traffic_signals"](${bbox});
);
out body;
>;
out skel qt;
`.trim();
}

/**
 * Fetch OSM data from the Overpass API.
 * @param {string} bbox - Bounding box as "south,west,north,east"
 * @param {function} onProgress - Optional progress callback
 * @returns {Promise<Array>} Array of OSM elements
 */
export async function fetchOSMData(bbox = GOTHENBURG_BBOX, onProgress) {
  const query = buildQuery(bbox);
  const url = 'https://overpass-api.de/api/interpreter';

  if (onProgress) onProgress('Fetching bike network from OpenStreetMap...');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
  }

  if (onProgress) onProgress('Parsing response...');

  const data = await response.json();
  return data.elements;
}
