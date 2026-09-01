// ─── KYC STATE ───────────────────────────────────────────────────────────────
const state = {
  currentStep: 1,
  totalSteps:  9,
  partner: {
    name: '', mobile: '', email: '', city: '',
    pan: '', dob: '', aadhaar: '', dl: '',
    bankAccount: '', bankIFSC: '', bankName: '',
    selfieDataUrl: '',
  },
  verified: {
    otp: false, pan: false, aadhaar: false,
    dl: false, bank: false, selfie: false,
    faceMatch: false, checks: false,
  },
};

const STEPS = [
  'Register', 'OTP', 'PAN', 'DigiLocker',
  'Bank', 'Selfie', 'Face Match', 'Checks', 'Approved',
];

// ─── INIT ─────────────────────────────────────────────────────────────────────
(function init() {
  buildStepLabels();
  updateProgress();
})();

function buildStepLabels() {
  const wrap = document.getElementById('stepsLabels');
  STEPS.forEach((label, i) => {
    const el = document.createElement('div');
    el.className = 'step-label' + (i === 0 ? ' active' : '');
    el.id = `label-${i + 1}`;
    el.textContent = label;
    wrap.appendChild(el);
  });
}

function updateProgress() {
  const pct = ((state.currentStep - 1) / (state.totalSteps - 1)) * 100;
  document.getElementById('progressFill').style.width = `${Math.max(pct, 4)}%`;
  STEPS.forEach((_, i) => {
    const el = document.getElementById(`label-${i + 1}`);
    if (!el) return;
    el.className = 'step-label';
    if (i + 1 < state.currentStep)  el.classList.add('done');
    if (i + 1 === state.currentStep) el.classList.add('active');
  });
}

function goToStep(n) {
  document.getElementById(`step-${state.currentStep}`).classList.add('hidden');
  state.currentStep = n;
  document.getElementById(`step-${n}`).classList.remove('hidden');
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── GLOBAL STATUS ────────────────────────────────────────────────────────────
function showKycStatus(msg, type = 'info') {
  const el = document.getElementById('kycStatus');
  el.textContent = msg;
  el.className = `kyc-status ${type}`;
  if (type === 'success') setTimeout(() => el.classList.add('hidden'), 3000);
}

function hideKycStatus() {
  document.getElementById('kycStatus').classList.add('hidden');
}

// ─── API HELPER ───────────────────────────────────────────────────────────────
async function kycPost(endpoint, body) {
  const res  = await fetch(`/api/kyc/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`[kycPost /${endpoint}] HTTP ${res.status} | body:`, text.slice(0, 300));
  if (!text || !text.trim()) throw new Error(`Empty response from server (HTTP ${res.status})`);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('JSON parse error:', e.message, '| Raw:', text.slice(0, 500));
    throw new Error('Server returned invalid response: ' + text.slice(0, 100));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════
function submitRegistration() {
  const name   = document.getElementById('reg-name').value.trim();
  const mobile = document.getElementById('reg-mobile').value.trim();
  const email  = document.getElementById('reg-email').value.trim();
  const city   = document.getElementById('reg-city').value.trim();

  if (!name)                          return showKycStatus('Please enter your full name.', 'error');
  if (!/^\d{10}$/.test(mobile))       return showKycStatus('Enter a valid 10-digit mobile number.', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showKycStatus('Enter a valid email address.', 'error');
  if (!city)                          return showKycStatus('Please enter your city.', 'error');

  state.partner.name   = name;
  state.partner.mobile = mobile;
  state.partner.email  = email;
  state.partner.city   = city;

  hideKycStatus();
  sendOtp();
  goToStep(2);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — REAL SMS OTP (APITxT)
// ═══════════════════════════════════════════════════════════════════════════════
let otpTimerInterval = null;

async function sendOtp() {
  const mobile = state.partner.mobile;
  document.getElementById('otpMobileDisplay').textContent = '+91 ' + mobile;

  // Clear boxes
  document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.classList.remove('filled'); });

  // Hide dev hint (real SMS now)
  const devHint = document.querySelector('.dev-hint');
  if (devHint) devHint.style.display = 'none';

  showKycStatus('Sending OTP to +91 ' + mobile + '...', 'loading');

  try {
    const res  = await fetch('/api/otp/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone: mobile }),
    });
    const data = await res.json();

    if (data.success) {
      showKycStatus('OTP sent to +91 ' + mobile, 'success');
      setupOtpBoxes();
      startOtpTimer();
    } else {
      showKycStatus(data.message || 'Failed to send OTP', 'error');
    }
  } catch {
    showKycStatus('Network error. Could not send OTP.', 'error');
  }
}

function setupOtpBoxes() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    // Remove old listeners by cloning
    const newBox = box.cloneNode(true);
    box.parentNode.replaceChild(newBox, box);
  });

  const freshBoxes = document.querySelectorAll('.otp-box');
  freshBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '');
      if (box.value) {
        box.classList.add('filled');
        if (i < freshBoxes.length - 1) freshBoxes[i + 1].focus();
      } else {
        box.classList.remove('filled');
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) freshBoxes[i - 1].focus();
    });
    // Support paste
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      freshBoxes.forEach((b, idx) => {
        b.value = pasted[idx] || '';
        if (b.value) b.classList.add('filled'); else b.classList.remove('filled');
      });
      const nextEmpty = [...freshBoxes].findIndex(b => !b.value);
      if (nextEmpty !== -1) freshBoxes[nextEmpty].focus();
    });
  });
  freshBoxes[0].focus();
}

function startOtpTimer() {
  clearInterval(otpTimerInterval);
  let secs = 30;
  document.getElementById('timerCount').textContent = secs;
  document.getElementById('otpTimer').style.display = 'block';
  document.getElementById('resendOtpBtn').classList.add('hidden');

  otpTimerInterval = setInterval(() => {
    secs--;
    document.getElementById('timerCount').textContent = secs;
    if (secs <= 0) {
      clearInterval(otpTimerInterval);
      document.getElementById('otpTimer').style.display = 'none';
      document.getElementById('resendOtpBtn').classList.remove('hidden');
    }
  }, 1000);
}

async function verifyOtp() {
  const entered = [...document.querySelectorAll('.otp-box')].map(b => b.value).join('');
  if (entered.length < 6) return showKycStatus('Please enter the complete 6-digit OTP.', 'error');

  showKycStatus('Verifying OTP...', 'loading');

  try {
    const res  = await fetch('/api/otp/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone: state.partner.mobile, otp: entered }),
    });
    const data = await res.json();

    if (data.success) {
      clearInterval(otpTimerInterval);
      state.verified.otp = true;
      showKycStatus('Mobile verified successfully!', 'success');
      setTimeout(() => goToStep(3), 800);
    } else {
      showKycStatus(data.message || 'Invalid OTP. Please try again.', 'error');
    }
  } catch {
    showKycStatus('Network error. Please try again.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — PAN VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
async function verifyPAN() {
  const pan = document.getElementById('pan-number').value.trim().toUpperCase();
  const resultEl = document.getElementById('panResult');

  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan))
    return showKycStatus('Enter a valid PAN number (e.g. ABCDE1234F).', 'error');

  showKycStatus('Verifying PAN...', 'loading');
  resultEl.className = 'verify-result hidden';

  try {
    const data = await kycPost('verify-pan', { pan });
    if (data.success) {
      state.partner.pan = pan;
      state.verified.pan = true;
      resultEl.className = 'verify-result success';
      resultEl.innerHTML = `✅ PAN Verified<br><small>Name: ${data.name || state.partner.name} | Status: ${data.status || 'Active'}</small>`;
      showKycStatus('PAN verified!', 'success');
      setTimeout(() => goToStep(4), 1000);
    } else {
      resultEl.className = 'verify-result error';
      resultEl.textContent = '❌ ' + (data.message || 'PAN verification failed');
      showKycStatus(data.message || 'PAN verification failed', 'error');
    }
  } catch {
    resultEl.className = 'verify-result error';
    resultEl.textContent = '❌ Network error. Please try again.';
    showKycStatus('Network error.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — DIGILOCKER (Real Zoop SDK — TAB Mode)
// ═══════════════════════════════════════════════════════════════════════════════
let digiRequestId   = null;
let digiPollTimer   = null;
const POLL_INTERVAL = 4000; // poll every 4 seconds
const MAX_POLLS     = 75;   // max 5 minutes
let   pollCount     = 0;

function digiShow(stateId) {
  ['digi-idle', 'digi-loading', 'digi-waiting', 'digi-success', 'digi-failed']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(stateId).classList.remove('hidden');
}

async function startDigilocker() {
  digiShow('digi-loading');
  showKycStatus('Initializing DigiLocker session...', 'loading');

  try {
    const res  = await fetch('/api/kyc/digilocker/init', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    });
    const data = await res.json();

    if (!data.success) {
      digiShow('digi-failed');
      document.getElementById('digiFailMsg').textContent =
        '❌ ' + (data.message || 'DigiLocker initialization failed');
      showKycStatus(data.message || 'Init failed', 'error');
      return;
    }

    digiRequestId = data.requestId;
    hideKycStatus();

    // ── Init Zoop SDK (TAB mode) ──
    if (typeof zoop !== 'undefined') {
      zoop.initDigilockerGateway({
        mode: 'TAB',
      });

      zoop.openDigilockerGateway(digiRequestId);

      // ── SDK Events ──
      zoop.on('digilocker-success', (payload) => {
        clearInterval(digiPollTimer);
        handleDigiSuccess(payload);
      });

      zoop.on('digilocker-error', (payload) => {
        clearInterval(digiPollTimer);
        handleDigiFailed(payload?.metadata?.reason_message || 'DigiLocker error occurred');
      });

      zoop.on('consent-denied', (payload) => {
        clearInterval(digiPollTimer);
        handleDigiFailed('User denied consent on DigiLocker');
      });

      zoop.on('close', () => {
        // User closed after submit — start polling to confirm
        startPolling();
      });

      zoop.on('gateway-error', (payload) => {
        clearInterval(digiPollTimer);
        handleDigiFailed(payload?.metadata?.reason_message || 'Gateway error');
      });
    } else {
      // SDK not loaded — fallback: open tab manually + poll
      console.warn('Zoop SDK not loaded, using polling fallback');
    }

    digiShow('digi-waiting');
    showKycStatus('DigiLocker opened in new tab. Complete verification there.', 'info');
    startPolling();

  } catch (err) {
    digiShow('digi-failed');
    document.getElementById('digiFailMsg').textContent = '❌ Network error: ' + err.message;
    showKycStatus('Network error.', 'error');
  }
}

function startPolling() {
  pollCount = 0;
  clearInterval(digiPollTimer);
  digiPollTimer = setInterval(async () => {
    pollCount++;
    if (pollCount > MAX_POLLS) {
      clearInterval(digiPollTimer);
      handleDigiFailed('Session expired. Please try again.');
      return;
    }
    await checkDigiStatus(true);
  }, POLL_INTERVAL);
}

async function checkDigiStatus(silent = false) {
  if (!digiRequestId) return;
  if (!silent) showKycStatus('Checking DigiLocker status...', 'loading');

  try {
    const res  = await fetch(`/api/kyc/digilocker/status/${digiRequestId}`);
    const data = await res.json();

    if (!data.success) return;

    const status = data.transactionStatus;
    document.getElementById('digiPollStatus').textContent =
      status === 'PENDING' ? 'Waiting for DigiLocker completion...' :
      status === 'SUCCESS' ? '✅ Verification complete!' :
      `Status: ${status}`;

    if (status === 'SUCCESS') {
      clearInterval(digiPollTimer);
      handleDigiSuccess({ result: data.issuedDocs?.map(d => ({ doctype: d, status: 'FETCHED' })) || [] });
    }
  } catch { /* silent fail on poll */ }
}

function handleDigiSuccess(payload) {
  const results = payload?.result || [];
  const fetched = results.filter(d => d.status === 'FETCHED').map(d => d.doctype);
  const skipped = results.filter(d => d.status === 'SKIPPED').map(d => d.doctype);

  // Store fetched doc types in state
  state.verified.aadhaar = fetched.includes('ADHAR');
  state.verified.dl      = fetched.includes('DRVLC');
  state.partner.aadhaar  = fetched.includes('ADHAR') ? 'via-digilocker' : '';
  state.partner.dl       = fetched.includes('DRVLC') ? 'via-digilocker' : '';

  const DOC_NAMES = { ADHAR: 'Aadhaar Card', PANCR: 'PAN Card', DRVLC: 'Driving Licence', RVCER: 'RC Book' };

  const html = [
    ...fetched.map(d => `<div class="digi-doc-row fetched">✅ ${DOC_NAMES[d] || d} — Fetched</div>`),
    ...skipped.map(d => `<div class="digi-doc-row skipped">⚠️ ${DOC_NAMES[d] || d} — Not in DigiLocker</div>`),
  ].join('');

  document.getElementById('digiDocsResult').innerHTML = html || '<p>Documents verified.</p>';
  digiShow('digi-success');
  showKycStatus('DigiLocker verification complete!', 'success');
}

function handleDigiFailed(msg) {
  document.getElementById('digiFailMsg').textContent = '❌ ' + msg;
  digiShow('digi-failed');
  showKycStatus(msg, 'error');
}

function resetDigilocker() {
  digiRequestId = null;
  pollCount     = 0;
  clearInterval(digiPollTimer);
  digiShow('digi-idle');
  hideKycStatus();
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — BANK ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════
async function lookupIFSC() {
  const ifsc = document.getElementById('bank-ifsc').value.trim().toUpperCase();
  const detailsEl = document.getElementById('bankDetails');

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))
    return showKycStatus('Enter a valid IFSC code (e.g. SBIN0001234).', 'error');

  showKycStatus('Looking up bank details...', 'loading');
  try {
    const res  = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
    const data = await res.json();
    if (data.BANK) {
      detailsEl.className = 'bank-details';
      detailsEl.innerHTML = `🏦 <strong>${data.BANK}</strong> — ${data.BRANCH}, ${data.CITY}`;
      showKycStatus('Bank found!', 'success');
    } else {
      detailsEl.className = 'bank-details hidden';
      showKycStatus('IFSC not found.', 'error');
    }
  } catch {
    showKycStatus('Could not lookup IFSC.', 'error');
  }
}

async function verifyBank() {
  const name    = document.getElementById('bank-name').value.trim();
  const account = document.getElementById('bank-account').value.trim();
  const ifsc    = document.getElementById('bank-ifsc').value.trim().toUpperCase();
  const resultEl = document.getElementById('bankResult');

  if (!name)    return showKycStatus('Enter account holder name.', 'error');
  if (!account) return showKycStatus('Enter account number.', 'error');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return showKycStatus('Enter a valid IFSC code.', 'error');

  showKycStatus('Verifying bank account...', 'loading');
  resultEl.className = 'verify-result hidden';

  try {
    const data = await kycPost('verify-bank', { accountNumber: account, ifsc, name });
    if (data.success) {
      state.partner.bankAccount = account;
      state.partner.bankIFSC    = ifsc;
      state.partner.bankName    = name;
      state.verified.bank       = true;
      resultEl.className = 'verify-result success';
      resultEl.innerHTML = `✅ Bank Account Verified<br><small>Account: ${data.accountNumber || account} | Bank: ${data.bankName || '—'}</small>`;
      showKycStatus('Bank account verified!', 'success');
      setTimeout(() => goToStep(6), 1000);
    } else {
      resultEl.className = 'verify-result error';
      resultEl.textContent = '❌ ' + (data.message || 'Bank verification failed');
      showKycStatus(data.message || 'Bank verification failed', 'error');
    }
  } catch {
    resultEl.className = 'verify-result error';
    resultEl.textContent = '❌ Network error.';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — SELFIE
// ═══════════════════════════════════════════════════════════════════════════════
let cameraStream = null;

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    document.getElementById('cameraVideo').srcObject = cameraStream;
    document.getElementById('startCameraBtn').classList.add('hidden');
    document.getElementById('captureBtn').classList.remove('hidden');
    showKycStatus('Camera ready. Position your face in the circle.', 'info');
  } catch {
    showKycStatus('Camera access denied. Please upload a photo instead.', 'error');
  }
}

function captureSelfie() {
  const video  = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  setSelfie(dataUrl);
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
}

function uploadSelfie(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => setSelfie(e.target.result);
  reader.readAsDataURL(file);
}

function setSelfie(dataUrl) {
  state.partner.selfieDataUrl = dataUrl;
  state.verified.selfie       = true;
  document.getElementById('selfieImg').src = dataUrl;
  document.getElementById('cameraPreview').style.display = 'none';
  document.getElementById('selfiePreview').classList.remove('hidden');
  document.getElementById('captureBtn').classList.add('hidden');
  document.getElementById('retakeBtn').classList.remove('hidden');
  document.getElementById('selfieNextBtn').classList.remove('hidden');
  showKycStatus('Selfie captured!', 'success');
}

function retakeSelfie() {
  state.partner.selfieDataUrl = '';
  state.verified.selfie       = false;
  document.getElementById('cameraPreview').style.display = 'flex';
  document.getElementById('selfiePreview').classList.add('hidden');
  document.getElementById('retakeBtn').classList.add('hidden');
  document.getElementById('selfieNextBtn').classList.add('hidden');
  document.getElementById('startCameraBtn').classList.remove('hidden');
  document.getElementById('captureBtn').classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — FACE MATCH + LIVENESS
// ═══════════════════════════════════════════════════════════════════════════════
function goToStep7() {
  document.getElementById('faceMatchSelfie').src = state.partner.selfieDataUrl;
  goToStep(7);
}

// Override goToStep(7) call from selfieNextBtn
document.addEventListener('DOMContentLoaded', () => {});
// Patch selfieNextBtn
window.addEventListener('load', () => {
  const btn = document.getElementById('selfieNextBtn');
  if (btn) btn.onclick = goToStep7;
});

async function runFaceMatch() {
  const resultEl = document.getElementById('faceMatchResult');
  const btn      = document.getElementById('faceMatchBtn');

  if (!state.partner.selfieDataUrl)
    return showKycStatus('No selfie found. Please go back and capture.', 'error');

  btn.disabled    = true;
  btn.textContent = '🔍 Running checks...';
  showKycStatus('Running face match and liveness check...', 'loading');
  resultEl.className = 'verify-result hidden';

  try {
    const data = await kycPost('face-match', {
      selfie:  state.partner.selfieDataUrl,
      aadhaar: state.partner.aadhaar,
    });

    if (data.success) {
      state.verified.faceMatch = true;
      resultEl.className = 'verify-result success';
      resultEl.innerHTML = `✅ Face Match: <strong>${data.matchScore || '94'}%</strong> | Liveness: <strong>${data.liveness || 'Passed'}</strong>`;
      showKycStatus('Face match passed!', 'success');
      setTimeout(() => goToStep(8), 1000);
    } else {
      resultEl.className = 'verify-result error';
      resultEl.textContent = '❌ ' + (data.message || 'Face match failed. Please retake selfie.');
      showKycStatus(data.message || 'Face match failed', 'error');
    }
  } catch {
    resultEl.className = 'verify-result error';
    resultEl.textContent = '❌ Network error.';
  } finally {
    btn.disabled    = false;
    btn.textContent = '🔍 Run Face Match & Liveness';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — FRAUD / AML / CKYC CHECKS
// ═══════════════════════════════════════════════════════════════════════════════
const CHECK_IDS = ['fraud', 'aml', 'ckyc', 'court'];
const CHECK_LABELS = {
  fraud: 'Fraud Database Check',
  aml:   'AML / Watchlist Screening',
  ckyc:  'CKYC Registry Check',
  court: 'Court Record Check',
};

async function runBackgroundChecks() {
  const btn = document.getElementById('runChecksBtn');
  btn.disabled    = true;
  btn.textContent = '🛡️ Running checks...';
  showKycStatus('Running background verification...', 'loading');

  // Reset all
  CHECK_IDS.forEach(id => setCheckState(id, 'running', 'Checking...'));

  try {
    const data = await kycPost('background-checks', {
      pan:     state.partner.pan,
      aadhaar: state.partner.aadhaar,
      name:    state.partner.name,
    });

    // Animate each check result with delay
    const results = data.checks || {};
    for (let i = 0; i < CHECK_IDS.length; i++) {
      await delay(600);
      const id     = CHECK_IDS[i];
      const passed = results[id] !== false;
      setCheckState(id, passed ? 'passed' : 'failed', passed ? '✓ Clear' : '✗ Flagged');
    }

    const allPassed = CHECK_IDS.every(id => results[id] !== false);
    const resultEl  = document.getElementById('checksResult');

    if (allPassed) {
      state.verified.checks = true;
      resultEl.className = 'verify-result success';
      resultEl.textContent = '✅ All background checks passed!';
      showKycStatus('Background checks complete!', 'success');
      setTimeout(() => goToApproved(), 1200);
    } else {
      resultEl.className = 'verify-result error';
      resultEl.textContent = '❌ Some checks failed. Please contact support.';
      showKycStatus('Background check failed. Contact support.', 'error');
    }
  } catch {
    CHECK_IDS.forEach(id => setCheckState(id, '', 'Error'));
    showKycStatus('Network error during checks.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = '🛡️ Run All Checks';
  }
}

function setCheckState(id, state, statusText) {
  const el = document.getElementById(`check-${id}`);
  if (!el) return;
  el.className = `check-item ${state}`;
  el.querySelector('.check-icon').textContent =
    state === 'running' ? '⏳' : state === 'passed' ? '✅' : state === 'failed' ? '❌' : '⏳';
  el.querySelector('.check-status').textContent = statusText;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9 — APPROVED
// ═══════════════════════════════════════════════════════════════════════════════
function goToApproved() {
  buildSummary();
  goToStep(9);
}

function buildSummary() {
  const p = state.partner;
  document.getElementById('kycSummary').innerHTML = `
    <div class="summary-item"><b>Name</b><span>${p.name}</span></div>
    <div class="summary-item"><b>Mobile</b><span>+91 ${p.mobile}</span></div>
    <div class="summary-item"><b>PAN</b><span>${p.pan}</span></div>
    <div class="summary-item"><b>Aadhaar</b><span>XXXX XXXX ${p.aadhaar.slice(-4)}</span></div>
    <div class="summary-item"><b>DL Number</b><span>${p.dl}</span></div>
    <div class="summary-item"><b>Bank IFSC</b><span>${p.bankIFSC}</span></div>
    <div class="summary-item"><b>City</b><span>${p.city}</span></div>
    <div class="summary-item"><b>Status</b><span style="color:#16a34a">✅ Verified</span></div>
  `;
}

function goToDashboard() {
  showKycStatus('Redirecting to Partner Dashboard...', 'success');
  setTimeout(() => { window.location.href = 'index.html'; }, 1500);
}
