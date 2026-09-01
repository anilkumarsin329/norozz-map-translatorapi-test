// ─── MAP MODULE ──────────────────────────────────────────────────────────────
// Handles: Autocomplete, Geocode, Reverse Geocode, Route/ETA, Leaflet Map

const API = '/api/location';

// ─── State ────────────────────────────────────────────────────────────────────
let map, routeLayer;
let originCoords = null;
let destCoords   = null;
const markers    = {};

// ─── Init Leaflet Map ─────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map').setView([20.5937, 78.9629], 5); // India center

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Geocoding by <a href="https://www.geoapify.com/">Geoapify</a>',
    maxZoom: 19,
  }).addTo(map);

  // Click on map → reverse geocode
  map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    showMapStatus('Fetching address for clicked location...', 'info');
    try {
      const data = await post(`${API}/reverse-geocode`, { latitude: lat, longitude: lng });
      if (data.success) {
        placeMarker('selected', lat, lng, '🟢', data.address);
        showSelectedAddress(data);
        showMapStatus('Address found!', 'success');
      }
    } catch {
      showMapStatus('Could not fetch address for this location.', 'error');
    }
  });
}

// ─── Marker Helper ────────────────────────────────────────────────────────────
function placeMarker(key, lat, lng, emoji, label) {
  if (markers[key]) map.removeLayer(markers[key]);
  const icon = L.divIcon({
    html: `<div class="map-marker">${emoji}</div>`,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
  markers[key] = L.marker([lat, lng], { icon })
    .addTo(map)
    .bindPopup(`<b>${label}</b>`)
    .openPopup();
}

// ─── Draw Route on Map ────────────────────────────────────────────────────────
function drawRoute(coords) {
  if (routeLayer) map.removeLayer(routeLayer);
  // Geoapify returns [lng, lat] pairs — flip to [lat, lng] for Leaflet
  const latlngs = coords.map(([lng, lat]) => [lat, lng]);
  routeLayer = L.polyline(latlngs, { color: '#667eea', weight: 5, opacity: 0.8 }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
}

// ─── Autocomplete (debounced) ─────────────────────────────────────────────────
function setupAutocomplete(inputId, suggestionsId, onSelect) {
  const input = document.getElementById(inputId);
  const list  = document.getElementById(suggestionsId);
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 3) { list.style.display = 'none'; return; }

    timer = setTimeout(async () => {
      try {
        const res  = await fetch(`${API}/autocomplete?text=${encodeURIComponent(text)}&limit=6`);
        const data = await res.json();
        if (!data.success || !data.results.length) { list.style.display = 'none'; return; }

        list.innerHTML = '';
        data.results.forEach((r) => {
          const li = document.createElement('li');
          li.textContent = r.label;
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = r.label;
            list.style.display = 'none';
            onSelect(r);
          });
          list.appendChild(li);
        });
        list.style.display = 'block';
      } catch {
        list.style.display = 'none';
      }
    }, 350); // 350ms debounce
  });

  // Hide on blur
  input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 200));
}

// ─── Show Selected Address Info ───────────────────────────────────────────────
function showSelectedAddress(data) {
  const box = document.getElementById('selectedAddress');
  box.innerHTML = `
    <div class="info-grid">
      <div><b>📍 Address</b><span>${data.address || '—'}</span></div>
      <div><b>🏙️ City</b><span>${data.city || '—'}</span></div>
      <div><b>🗺️ State</b><span>${data.state || '—'}</span></div>
      <div><b>📮 Pincode</b><span>${data.pincode || '—'}</span></div>
      <div><b>🌍 Country</b><span>${data.country || '—'}</span></div>
      <div><b>🔢 Lat/Lng</b><span>${data.latitude?.toFixed(5)}, ${data.longitude?.toFixed(5)}</span></div>
    </div>`;
  box.style.display = 'block';
}

// ─── Route Result Display ─────────────────────────────────────────────────────
function showRouteResult(data) {
  const box = document.getElementById('routeResult');
  box.innerHTML = `
    <div class="info-grid route-info">
      <div><b>📏 Distance</b><span>${data.distanceKm} km (${data.distanceMeters} m)</span></div>
      <div><b>⏱️ ETA</b><span>${data.durationMinutes} min (${data.durationSeconds} sec)</span></div>
    </div>`;
  box.style.display = 'block';
}

// ─── Status Messages ──────────────────────────────────────────────────────────
function showMapStatus(msg, type) {
  const el = document.getElementById('mapStatus');
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.style.display = 'block';
  if (type === 'success' || type === 'info') setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ─── Fetch Helpers ────────────────────────────────────────────────────────────
async function post(url, body) {
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  return res.json();
}

// ─── Wire Up: Address Search Autocomplete ─────────────────────────────────────
setupAutocomplete('addressInput', 'suggestions', (place) => {
  showSelectedAddress(place);
  placeMarker('selected', place.latitude, place.longitude, '🟢', place.address);
  map.setView([place.latitude, place.longitude], 14);
  showMapStatus('Location selected!', 'success');
});

// ─── Wire Up: Origin Autocomplete ────────────────────────────────────────────
setupAutocomplete('originInput', 'originSuggestions', (place) => {
  originCoords = { latitude: place.latitude, longitude: place.longitude };
  placeMarker('origin', place.latitude, place.longitude, '🔵', 'Origin: ' + place.address);
  map.setView([place.latitude, place.longitude], 12);
});

// ─── Wire Up: Destination Autocomplete ───────────────────────────────────────
setupAutocomplete('destInput', 'destSuggestions', (place) => {
  destCoords = { latitude: place.latitude, longitude: place.longitude };
  placeMarker('dest', place.latitude, place.longitude, '🔴', 'Destination: ' + place.address);
});

// ─── Use My Location ─────────────────────────────────────────────────────────
document.getElementById('useMyLocationBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    showMapStatus('Geolocation is not supported by your browser.', 'error');
    return;
  }
  showMapStatus('Getting your location...', 'info');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      originCoords = { latitude, longitude };
      placeMarker('origin', latitude, longitude, '🔵', 'My Location');
      map.setView([latitude, longitude], 13);

      // Reverse geocode to fill origin input
      try {
        const data = await post(`${API}/reverse-geocode`, { latitude, longitude });
        if (data.success) {
          document.getElementById('originInput').value = data.address;
          showMapStatus('Your location detected: ' + data.city, 'success');
        }
      } catch {
        showMapStatus('Location detected but address lookup failed.', 'error');
      }
    },
    (err) => {
      const msgs = {
        1: 'Location permission denied.',
        2: 'Location unavailable.',
        3: 'Location request timed out.',
      };
      showMapStatus(msgs[err.code] || 'Could not get location.', 'error');
    },
    { timeout: 10000 }
  );
});

// ─── Calculate Route ─────────────────────────────────────────────────────────
document.getElementById('calcRouteBtn').addEventListener('click', async () => {
  if (!originCoords) {
    showMapStatus('Please select or enter an origin address.', 'error');
    return;
  }
  if (!destCoords) {
    showMapStatus('Please select or enter a destination address.', 'error');
    return;
  }

  const btn = document.getElementById('calcRouteBtn');
  btn.disabled    = true;
  btn.textContent = 'Calculating...';
  showMapStatus('Calculating route...', 'info');

  try {
    const data = await post(`${API}/route`, { origin: originCoords, destination: destCoords });

    if (!data.success) {
      showMapStatus(data.message || 'Route calculation failed.', 'error');
      return;
    }

    showRouteResult(data);
    if (data.route?.length) drawRoute(data.route);
    showMapStatus(`Route found: ${data.distanceKm} km, ~${data.durationMinutes} min`, 'success');
  } catch (err) {
    showMapStatus('Network error. Please try again.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Calculate Route';
  }
});

// ─── Init on DOM Ready ────────────────────────────────────────────────────────
initMap();
