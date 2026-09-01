import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fetch from 'node-fetch';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── OTP STORE (in-memory, 5 min expiry) ──────────────────────────────────────────────────
const otpStore = {}; // { phone: { otp, expiry, attempts } }

// POST /api/otp/send  { phone }
app.post('/api/otp/send', async (req, res) => {
  const { phone } = req.body;

  if (!phone || !/^\d{10}$/.test(phone))
    return res.status(400).json({ success: false, message: 'Valid 10-digit phone number is required' });

  // Rate limit: max 3 OTPs per number per minute
  const existing = otpStore[phone];
  if (existing && Date.now() - (existing.sentAt || 0) < 20 * 1000)
    return res.status(429).json({ success: false, message: 'Please wait 20 seconds before requesting another OTP' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[phone] = { otp, expiry: Date.now() + 5 * 60 * 1000, sentAt: Date.now(), attempts: 0 };

  try {
    const response = await axios.post(
      'https://apitxt.com/api/sendOTP',
      new URLSearchParams({
        authkey: process.env.APITXT_API_KEY,
        mobile:  phone,
        otp,
        channel: 'sms',
        country: '91',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    if (response.data?.status === 'success') {
      return res.json({ success: true, message: 'OTP sent successfully' });
    }
    // APITxT returned non-success
    return res.status(400).json({ success: false, message: response.data?.message || 'Failed to send OTP' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.response?.data?.message || err.message });
  }
});

// POST /api/otp/verify  { phone, otp }
app.post('/api/otp/verify', (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp)
    return res.status(400).json({ success: false, message: 'Phone and OTP are required' });

  const record = otpStore[phone];
  if (!record)              return res.status(400).json({ success: false, message: 'OTP not found. Please request a new OTP.' });
  if (Date.now() > record.expiry) {
    delete otpStore[phone];
    return res.status(400).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
  }

  record.attempts = (record.attempts || 0) + 1;
  if (record.attempts > 5) {
    delete otpStore[phone];
    return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new OTP.' });
  }

  if (record.otp !== String(otp))
    return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });

  delete otpStore[phone]; // one-time use
  return res.json({ success: true, message: 'OTP verified successfully!' });
});

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

// ─── ZOOP KYC HELPER ────────────────────────────────────────────────────────
const ZOOP_KEY = () => {
  const key = process.env.ZOOP_API_KEY;
  if (!key) throw new Error('ZOOP_API_KEY is not set in .env');
  return key;
};

async function safeJson(res) {
  const text = await res.text();
  if (!text || !text.trim()) {
    console.error(`[Zoop] Empty response body (HTTP ${res.status}) for ${res.url}`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[Zoop] JSON parse error: ${e.message}\nRaw response: ${text.slice(0, 500)}`);
    return { _raw: text, _parseError: e.message };
  }
}

function zoopBase() {
  const base = process.env.ZOOP_BASE_URL || 'https://test.zoop.one';
  return base.replace(/\/api\/v1\/?$/, '') + '/api/v1';
}

function zoopTaskId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function zoopPost(endpoint, body) {
  const url = `${zoopBase()}${endpoint}`;
  const payload = { mode: 'sync', task_id: zoopTaskId(), ...body };
  console.log(`[Zoop POST] ${url}`);
  console.log(`[Zoop REQ]`, JSON.stringify(payload));
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'app-id':       process.env.ZOOP_APP_ID || 'norozz',
      'api-key':      ZOOP_KEY(),
    },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(res);
  console.log(`[Zoop RES] HTTP ${res.status}`, JSON.stringify(data).slice(0, 1000));
  return { status: res.status, data };
}

async function zoopGet(endpoint) {
  const res = await fetch(`${zoopBase()}${endpoint}`, {
    method:  'GET',
    headers: {
      'app-id':  process.env.ZOOP_APP_ID || 'norozz',
      'api-key': ZOOP_KEY(),
    },
  });
  return { status: res.status, data: await safeJson(res) };
}

// In-memory store for webhook_security_key per request_id
// In production: use Redis or MongoDB
const digilockerSessions = new Map();

// ─── DIGILOCKER: INIT ────────────────────────────────────────────────────────
// POST /api/kyc/digilocker/init
// Calls Zoop init, returns request_id + webhook_security_key to backend only
app.post('/api/kyc/digilocker/init', async (req, res) => {
  try {
    const webhookUrl  = `${req.protocol}://${req.get('host')}/api/kyc/digilocker/webhook`;
    const redirectUrl = `${req.protocol}://${req.get('host')}/kyc-digilocker-redirect.html`;

    const r = await fetch(`${zoopBase()}/in/identity/digilocker/v1/init`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'app-id':       process.env.ZOOP_APP_ID || 'norozz',
        'api-key':      ZOOP_KEY(),
      },
      body: JSON.stringify({
        docs:         ['ADHAR', 'PANCR', 'DRVLC'],
        purpose:      'Partner KYC verification for Norozz platform',
        response_url: webhookUrl,
        redirect_url: redirectUrl,
        fast_track:   'N',
        pinless:      false,
      }),
    });

    const data = await safeJson(r);
    console.log('[DigiLocker init]', r.status, JSON.stringify(data).slice(0, 500));

    if (!r.ok || !data.success) {
      return res.status(r.status).json({
        success: false,
        message: data?.response_message || 'DigiLocker init failed',
      });
    }

    // Store webhook_security_key securely on backend — never send to frontend
    digilockerSessions.set(data.request_id, {
      webhookSecurityKey: data.webhook_security_key,
      status:             'PENDING',
      createdAt:          new Date(),
      result:             null,
    });

    // Return only request_id and expiry to frontend
    return res.json({
      success:    true,
      requestId:  data.request_id,
      expiresAt:  data.expires_at,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DIGILOCKER: FETCH STATUS ────────────────────────────────────────────────
// GET /api/kyc/digilocker/status/:requestId
app.get('/api/kyc/digilocker/status/:requestId', async (req, res) => {
  const { requestId } = req.params;
  if (!requestId)
    return res.status(400).json({ success: false, message: 'requestId is required' });

  // First check in-memory session (webhook may have already updated it)
  const session = digilockerSessions.get(requestId);
  if (session?.status === 'SUCCESS' && session.result) {
    return res.json({
      success:            true,
      transactionStatus:  'SUCCESS',
      issuedDocs:         session.result.issuedDocs  || [],
      pendingDocs:        session.result.pendingDocs || [],
      fetchedDocTypes:    session.result.fetchedDocTypes || [],
    });
  }

  // Fallback: call Zoop fetch API
  try {
    const { status, data } = await zoopGet(`/identity/digilocker/v1/fetch/${requestId}`);

    if (!status || status >= 400)
      return res.status(status || 500).json({ success: false, message: 'Fetch failed' });

    const txStatus = data.transaction_status || 'PENDING';

    // Update session
    if (session) {
      session.status = txStatus;
      if (txStatus === 'SUCCESS') {
        session.result = {
          issuedDocs:      data.issued_docs  || [],
          pendingDocs:     data.pending_docs || [],
          fetchedDocTypes: data.issued_docs  || [],
        };
      }
    }

    return res.json({
      success:           true,
      transactionStatus: txStatus,
      issuedDocs:        data.issued_docs  || [],
      pendingDocs:       data.pending_docs || [],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DIGILOCKER: WEBHOOK ─────────────────────────────────────────────────────
// POST /api/kyc/digilocker/webhook  (called by Zoop after transaction)
app.post('/api/kyc/digilocker/webhook', express.json(), async (req, res) => {
  const receivedKey = req.headers['webhook_security_key'] || req.headers['webhook-security-key'];
  const payload     = req.body;
  const requestId   = payload?.request_id;

  if (!requestId)
    return res.status(400).json({ success: false, message: 'Missing request_id' });

  const session = digilockerSessions.get(requestId);

  // Security: validate webhook_security_key
  if (session && receivedKey && session.webhookSecurityKey !== receivedKey) {
    console.warn(`⚠️ DigiLocker webhook security key mismatch for ${requestId}`);
    return res.status(401).json({ success: false, message: 'Invalid webhook security key' });
  }

  if (payload.success && payload.response_code === '100') {
    const fetchedDocs = (payload.result || [])
      .filter(d => d.status === 'FETCHED')
      .map(d => d.doctype);

    if (session) {
      session.status = 'SUCCESS';
      session.result = {
        issuedDocs:      fetchedDocs,
        pendingDocs:     (payload.result || []).filter(d => d.status === 'SKIPPED').map(d => d.doctype),
        fetchedDocTypes: fetchedDocs,
        rawResult:       payload.result,
      };
    }
    console.log(`✅ DigiLocker webhook SUCCESS for ${requestId} — docs: ${fetchedDocs.join(', ')}`);
  } else {
    if (session) session.status = 'FAILED';
    console.log(`❌ DigiLocker webhook FAILED for ${requestId} — ${payload.response_message}`);
  }

  // Always respond 200 to Zoop
  return res.status(200).json({ success: true });
});

// ─── KYC: VERIFY PAN ─────────────────────────────────────────────────────────
// POST /api/kyc/verify-pan  { pan }
app.post('/api/kyc/verify-pan', async (req, res) => {
  const { pan } = req.body;
  if (!pan || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan))
    return res.status(400).json({ success: false, message: 'Valid PAN number is required' });

  try {
    const { status, data } = await zoopPost('/in/identity/pan/advance', {
      data: {
        customer_pan_number: pan,
        consent:             'Y',
        consent_text:        'I hereby declare my consent for fetching my information via ZOOP API',
      },
    });

    if (status === 200 && data?.response_code === '100') {
      const result = data?.result || {};
      return res.json({
        success: true,
        name:    result.name_on_card || result.user_full_name || result.user_first_name || '',
        status:  result.pan_status || 'VALID',
      });
    }
    if (data?._parseError) {
      return res.status(500).json({ success: false, message: 'Invalid response from Zoop: ' + data._parseError });
    }
    return res.json({
      success: false,
      message: data?.response_message || `PAN verification failed (code: ${data?.response_code || status})`,
    });
  } catch (err) {
    console.error('[verify-pan error]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KYC: VERIFY AADHAAR ─────────────────────────────────────────────────────
// POST /api/kyc/verify-aadhaar  { aadhaar }
app.post('/api/kyc/verify-aadhaar', async (req, res) => {
  const { aadhaar } = req.body;
  if (!aadhaar || !/^\d{12}$/.test(aadhaar))
    return res.status(400).json({ success: false, message: 'Valid 12-digit Aadhaar is required' });

  try {
    const { status, data } = await zoopPost('/in/identity/aadhaar/advance', {
      data: {
        aadhaar_number: aadhaar,
        consent:        'Y',
        consent_text:   'I hereby declare my consent for fetching my information via ZOOP API',
      },
    });

    if (status === 200 && data?.response_code === '100') {
      return res.json({
        success: true,
        name:    data?.result?.name || '',
        state:   data?.result?.address?.state || '',
      });
    }
    return res.json({ success: false, message: data?.response_message || 'Aadhaar verification failed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KYC: VERIFY DRIVING LICENCE ─────────────────────────────────────────────
// POST /api/kyc/verify-dl  { dl, dob }
app.post('/api/kyc/verify-dl', async (req, res) => {
  const { dl, dob } = req.body;
  if (!dl)  return res.status(400).json({ success: false, message: 'DL number is required' });
  if (!dob) return res.status(400).json({ success: false, message: 'Date of birth is required' });

  try {
    const { status, data } = await zoopPost('/in/identity/dl/advance', {
      data: {
        customer_dl_number: dl,
        customer_dob:       dob,
        consent:            'Y',
        consent_text:       'I hereby declare my consent for fetching my information via ZOOP API',
      },
    });

    if (status === 200 && data?.response_code === '100') {
      return res.json({
        success:   true,
        name:      data?.result?.user_full_name || '',
        validTill: data?.result?.non_transport_validity?.to || '',
      });
    }
    return res.json({ success: false, message: data?.response_message || 'DL verification failed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KYC: VERIFY BANK ACCOUNT ────────────────────────────────────────────────
// POST /api/kyc/verify-bank  { accountNumber, ifsc, name }
app.post('/api/kyc/verify-bank', async (req, res) => {
  const { accountNumber, ifsc, name } = req.body;
  if (!accountNumber) return res.status(400).json({ success: false, message: 'Account number is required' });
  if (!ifsc)          return res.status(400).json({ success: false, message: 'IFSC code is required' });

  try {
    const { status, data } = await zoopPost('/in/financial/bav/advance', {
      data: {
        account_number: accountNumber,
        ifsc:           ifsc,
        name_to_match:  name,
        consent:        'Y',
        consent_text:   'I hereby declare my consent for fetching my information via ZOOP API',
      },
    });

    if (status === 200 && data?.response_code === '100') {
      return res.json({
        success:       true,
        accountNumber: accountNumber,
        bankName:      data?.result?.beneficiary_name || '',
        nameMatch:     data?.result?.name_match_score || '',
      });
    }
    return res.json({ success: false, message: data?.response_message || 'Bank verification failed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KYC: FACE MATCH + LIVENESS ──────────────────────────────────────────────
// POST /api/kyc/face-match  { selfie (base64), aadhaar }
app.post('/api/kyc/face-match', async (req, res) => {
  const { selfie, aadhaar } = req.body;
  if (!selfie)  return res.status(400).json({ success: false, message: 'Selfie image is required' });
  if (!aadhaar) return res.status(400).json({ success: false, message: 'Aadhaar number is required' });

  try {
    const { status, data } = await zoopPost('/in/identity/face/match', {
      data: {
        selfie_image:   selfie.replace(/^data:image\/\w+;base64,/, ''),
        aadhaar_number: aadhaar,
      },
    });

    if (status === 200 && data?.response_code === '101') {
      return res.json({
        success:    true,
        matchScore: data?.result?.match_score || 95,
        liveness:   data?.result?.liveness || 'Passed',
      });
    }
    return res.json({ success: false, message: data?.message || 'Face match failed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── KYC: BACKGROUND CHECKS (Fraud + AML + CKYC + Court) ─────────────────────
// POST /api/kyc/background-checks  { pan, aadhaar, name }
app.post('/api/kyc/background-checks', async (req, res) => {
  const { pan, aadhaar, name } = req.body;
  if (!pan || !aadhaar)
    return res.status(400).json({ success: false, message: 'PAN and Aadhaar are required' });

  try {
    // Run all checks in parallel
    const [fraudRes, amlRes, ckycRes, courtRes] = await Promise.allSettled([
      zoopPost('/in/identity/fraud/check',  { data: { pan, aadhaar } }),
      zoopPost('/in/identity/aml/check',    { data: { name, pan } }),
      zoopPost('/in/identity/ckyc/search',  { data: { pan } }),
      zoopPost('/in/identity/court/check',  { data: { name, pan } }),
    ]);

    const passed = (r) =>
      r.status === 'fulfilled' && r.value?.status === 200 && r.value?.data?.response_code === '101';

    return res.json({
      success: true,
      checks: {
        fraud: passed(fraudRes),
        aml:   passed(amlRes),
        ckyc:  passed(ckycRes),
        court: passed(courtRes),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
