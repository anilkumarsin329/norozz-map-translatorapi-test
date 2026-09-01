import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// POST /api/translate
app.post('/api/translate', async (req, res) => {
  const { text, sourceLanguage, targetLanguage } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: 'Text is required' });
  }
  if (!sourceLanguage) {
    return res.status(400).json({ success: false, message: 'Source language is required' });
  }
  if (!targetLanguage) {
    return res.status(400).json({ success: false, message: 'Target language is required' });
  }

  try {
    const response = await fetch('https://api.sarvam.ai/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': process.env.SARVAM_API_KEY,
      },
      body: JSON.stringify({
        input: text.trim(),
        source_language_code: sourceLanguage,
        target_language_code: targetLanguage,
        speaker_gender: 'Male',
        mode: 'formal',
        model: 'mayura:v1',
        enable_preprocessing: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: data?.message || 'Sarvam API error',
      });
    }

    return res.json({
      success: true,
      translatedText: data.translated_text,
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ECONNRESET') {
      return res.status(504).json({ success: false, message: 'Request timed out' });
    }
    return res.status(500).json({ success: false, message: 'Network error. Please try again.' });
  }
});

// ─── LOCATION HELPERS ────────────────────────────────────────────────────────
const GEO_KEY = () => {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error('GEOAPIFY_API_KEY is not set in .env');
  return key;
};

const parsePlace = (props) => ({
  address:   props.formatted        || '',
  city:      props.city             || props.county || '',
  state:     props.state            || '',
  pincode:   props.postcode         || '',
  country:   props.country          || '',
  latitude:  props.lat,
  longitude: props.lon,
});

// ─── ADDRESS AUTOCOMPLETE ─────────────────────────────────────────────────────
// GET /api/location/autocomplete?text=...&limit=5
app.get('/api/location/autocomplete', async (req, res) => {
  const { text, limit = 5 } = req.query;
  if (!text || !text.trim())
    return res.status(400).json({ success: false, message: 'text query param is required' });

  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
    url.searchParams.set('text',    text.trim());
    url.searchParams.set('filter',  'countrycode:in');
    url.searchParams.set('limit',   String(limit));
    url.searchParams.set('format',  'json');
    url.searchParams.set('apiKey',  GEO_KEY());

    const r    = await fetch(url.toString());
    const data = await r.json();

    if (!r.ok) return res.status(r.status).json({ success: false, message: 'Geoapify error' });

    const results = (data.results || []).map((p) => ({
      label:     p.formatted,
      ...parsePlace(p),
    }));

    return res.json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GEOCODE ──────────────────────────────────────────────────────────────────
// POST /api/location/geocode  { address }
app.post('/api/location/geocode', async (req, res) => {
  const { address } = req.body;
  if (!address || !address.trim())
    return res.status(400).json({ success: false, message: 'address is required' });

  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.searchParams.set('text',   address.trim());
    url.searchParams.set('filter', 'countrycode:in');
    url.searchParams.set('limit',  '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('apiKey', GEO_KEY());

    const r    = await fetch(url.toString());
    const data = await r.json();

    if (!r.ok) return res.status(r.status).json({ success: false, message: 'Geoapify error' });
    if (!data.results?.length)
      return res.status(404).json({ success: false, message: 'No results found for this address' });

    return res.json({ success: true, ...parsePlace(data.results[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── REVERSE GEOCODE ──────────────────────────────────────────────────────────
// POST /api/location/reverse-geocode  { latitude, longitude }
app.post('/api/location/reverse-geocode', async (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null)
    return res.status(400).json({ success: false, message: 'latitude and longitude are required' });
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    return res.status(400).json({ success: false, message: 'Invalid coordinates' });

  try {
    const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
    url.searchParams.set('lat',    String(latitude));
    url.searchParams.set('lon',    String(longitude));
    url.searchParams.set('format', 'json');
    url.searchParams.set('apiKey', GEO_KEY());

    const r    = await fetch(url.toString());
    const data = await r.json();

    if (!r.ok) return res.status(r.status).json({ success: false, message: 'Geoapify error' });
    if (!data.results?.length)
      return res.status(404).json({ success: false, message: 'No address found for these coordinates' });

    return res.json({ success: true, ...parsePlace(data.results[0]) });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DRIVING ROUTE ────────────────────────────────────────────────────────────
// POST /api/location/route  { origin: {latitude,longitude}, destination: {latitude,longitude} }
app.post('/api/location/route', async (req, res) => {
  const { origin, destination } = req.body;
  if (!origin?.latitude || !origin?.longitude || !destination?.latitude || !destination?.longitude)
    return res.status(400).json({ success: false, message: 'origin and destination with latitude/longitude are required' });

  try {
    const url = new URL('https://api.geoapify.com/v1/routing');
    url.searchParams.set('waypoints', `${origin.latitude},${origin.longitude}|${destination.latitude},${destination.longitude}`);
    url.searchParams.set('mode',   'drive');
    url.searchParams.set('apiKey', GEO_KEY());

    const r    = await fetch(url.toString());
    const data = await r.json();

    if (!r.ok) return res.status(r.status).json({ success: false, message: 'Geoapify routing error' });

    const leg = data.features?.[0]?.properties?.legs?.[0];
    if (!leg) return res.status(404).json({ success: false, message: 'No route found' });

    const distanceMeters  = Math.round(leg.distance);
    const durationSeconds = Math.round(leg.time);
    const route           = data.features[0].geometry?.coordinates || [];

    return res.json({
      success:         true,
      distanceMeters,
      distanceKm:      parseFloat((distanceMeters / 1000).toFixed(2)),
      durationSeconds,
      durationMinutes: Math.round(durationSeconds / 60),
      route,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
