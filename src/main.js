import L from 'leaflet';
import { fetchOSMData, GOTHENBURG_BBOX } from './overpass.js';
import { buildGraph, findNearestNode } from './graph.js';
import { findRoute } from './router.js';
import { formatTime, formatDistance } from './utils.js';

// ── State ──────────────────────────────────────────────────────────────

let graph = null;           // { nodes, adjacency, trafficSignalIds }
let startMarker = null;
let endMarker = null;
let routeLine = null;
let trafficLightMarkers = [];
let startNodeId = null;
let endNodeId = null;

// ── Map Setup ──────────────────────────────────────────────────────────

const map = L.map('map').setView([57.7089, 11.9746], 13); // Gothenburg center

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

// Custom icons
const startIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background:#4CAF50;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const endIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background:#F44336;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const trafficLightIcon = L.divIcon({
  className: 'custom-marker',
  html: '<div style="background:#e53935;width:8px;height:8px;border-radius:50%;opacity:0.7;"></div>',
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

// ── UI References ──────────────────────────────────────────────────────

const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');
const btnLoad = document.getElementById('btn-load');
const btnClear = document.getElementById('btn-clear');
const routeInfo = document.getElementById('route-info');
const routeDistance = document.getElementById('route-distance');
const routeTime = document.getElementById('route-time');
const routeLights = document.getElementById('route-lights');
const routeLightPenalty = document.getElementById('route-light-penalty');
const lightPenaltyInput = document.getElementById('light-penalty');
const showLightsCheckbox = document.getElementById('show-lights');

// ── Status Updates ─────────────────────────────────────────────────────

function setStatus(text, type = '') {
  statusBar.className = type;
  statusText.textContent = text;
}

// ── Network Loading ────────────────────────────────────────────────────

btnLoad.addEventListener('click', async () => {
  if (graph) {
    setStatus('Network already loaded. Clear route or reload the page.', 'success');
    return;
  }

  btnLoad.disabled = true;

  try {
    setStatus('Fetching bike network from OpenStreetMap...', 'loading');

    const elements = await fetchOSMData(GOTHENBURG_BBOX, (msg) => {
      setStatus(msg, 'loading');
    });

    setStatus(`Received ${elements.length.toLocaleString()} elements. Building graph...`, 'loading');

    graph = buildGraph(elements, (msg) => {
      setStatus(msg, 'loading');
    });

    setStatus(
      `Ready! ${graph.trafficSignalIds.size.toLocaleString()} traffic lights loaded. ` +
      `Click the map to set start point.`,
      'success'
    );

    // Show traffic lights on the map
    if (showLightsCheckbox.checked) {
      showTrafficLights();
    }
  } catch (err) {
    console.error('Failed to load network:', err);
    setStatus(`Error: ${err.message}`, 'error');
    btnLoad.disabled = false;
  }
});

// ── Traffic Light Display ──────────────────────────────────────────────

function showTrafficLights() {
  clearTrafficLightMarkers();
  if (!graph) return;

  for (const id of graph.trafficSignalIds) {
    const node = graph.nodes.get(id);
    if (node) {
      const marker = L.marker([node.lat, node.lon], {
        icon: trafficLightIcon,
        interactive: false,
      });
      marker.addTo(map);
      trafficLightMarkers.push(marker);
    }
  }
}

function clearTrafficLightMarkers() {
  for (const m of trafficLightMarkers) {
    map.removeLayer(m);
  }
  trafficLightMarkers = [];
}

showLightsCheckbox.addEventListener('change', () => {
  if (showLightsCheckbox.checked) {
    showTrafficLights();
  } else {
    clearTrafficLightMarkers();
  }
});

// ── Map Click → Set Start / End ────────────────────────────────────────

map.on('click', (e) => {
  if (!graph) {
    setStatus('Load the network first by clicking "Load Network".', 'error');
    return;
  }

  const { lat, lng } = e.latlng;

  if (!startMarker) {
    // Set start point
    const nearest = findNearestNode(graph.nodes, graph.adjacency, lat, lng);
    if (!nearest.id || nearest.distance > 1000) {
      setStatus('No road found nearby. Try clicking closer to a street.', 'error');
      return;
    }

    startNodeId = nearest.id;
    const node = graph.nodes.get(startNodeId);
    startMarker = L.marker([node.lat, node.lon], { icon: startIcon })
      .addTo(map)
      .bindPopup('Start')
      .openPopup();

    setStatus('Start set. Click the map to set destination.', 'success');
  } else if (!endMarker) {
    // Set end point and compute route
    const nearest = findNearestNode(graph.nodes, graph.adjacency, lat, lng);
    if (!nearest.id || nearest.distance > 1000) {
      setStatus('No road found nearby. Try clicking closer to a street.', 'error');
      return;
    }

    endNodeId = nearest.id;
    const node = graph.nodes.get(endNodeId);
    endMarker = L.marker([node.lat, node.lon], { icon: endIcon })
      .addTo(map)
      .bindPopup('Destination');

    computeRoute();
  }
});

// ── Route Computation ──────────────────────────────────────────────────

function computeRoute() {
  if (!graph || startNodeId === null || endNodeId === null) return;

  setStatus('Computing route...', 'loading');

  const penalty = parseInt(lightPenaltyInput.value, 10) || 60;

  // Use setTimeout to let the UI update before heavy computation
  setTimeout(() => {
    const t0 = performance.now();
    const result = findRoute(graph.nodes, graph.adjacency, startNodeId, endNodeId, penalty);
    const t1 = performance.now();

    if (!result) {
      setStatus('No route found between these points.', 'error');
      return;
    }

    // Draw route on the map
    if (routeLine) map.removeLayer(routeLine);

    const latlngs = result.path.map((p) => [p.lat, p.lon]);
    routeLine = L.polyline(latlngs, {
      color: '#2196F3',
      weight: 5,
      opacity: 0.85,
    }).addTo(map);

    map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

    // Update route info
    routeInfo.classList.remove('hidden');
    routeDistance.textContent = formatDistance(result.distance);
    routeTime.textContent = formatTime(result.cost);
    routeLights.textContent = result.trafficLights.toString();
    routeLightPenalty.textContent = formatTime(result.trafficLights * penalty);

    setStatus(
      `Route found in ${(t1 - t0).toFixed(0)}ms. ` +
      `${formatDistance(result.distance)}, ~${formatTime(result.cost)}`,
      'success'
    );
  }, 10);
}

// ── Recompute on penalty change ────────────────────────────────────────

lightPenaltyInput.addEventListener('change', () => {
  if (startNodeId !== null && endNodeId !== null && graph) {
    computeRoute();
  }
});

// ── Clear Route ────────────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
  if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
  if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }

  startNodeId = null;
  endNodeId = null;
  routeInfo.classList.add('hidden');

  if (graph) {
    setStatus('Route cleared. Click the map to set a new start point.', 'success');
  } else {
    setStatus('Click "Load Network" to get started.', '');
  }
});
