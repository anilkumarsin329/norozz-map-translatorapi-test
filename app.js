const inputText = document.getElementById('inputText');
const outputText = document.getElementById('outputText');
const sourceLang = document.getElementById('sourceLang');
const targetLang = document.getElementById('targetLang');
const translateBtn = document.getElementById('translateBtn');
const swapBtn = document.getElementById('swapBtn');
const copyBtn = document.getElementById('copyBtn');
const charCount = document.getElementById('charCount');
const statusMsg = document.getElementById('statusMsg');

// Character counter
inputText.addEventListener('input', () => {
  charCount.textContent = inputText.value.length;
});

// Swap languages
swapBtn.addEventListener('click', () => {
  const temp = sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = temp;

  // Also swap text if output has content
  const currentOutput = outputText.dataset.translated;
  if (currentOutput) {
    inputText.value = currentOutput;
    charCount.textContent = inputText.value.length;
    outputText.innerHTML = '<span class="placeholder">Translation will appear here...</span>';
    outputText.dataset.translated = '';
    copyBtn.style.display = 'none';
  }
});

// Copy translation
copyBtn.addEventListener('click', () => {
  const text = outputText.dataset.translated;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '✅ Copied!';
    setTimeout(() => (copyBtn.textContent = '📋 Copy'), 2000);
  });
});

// Translate
translateBtn.addEventListener('click', translate);
inputText.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') translate();
});

async function translate() {
  const text = inputText.value.trim();

  if (!text) {
    showStatus('Please enter some text to translate.', 'error');
    return;
  }

  if (sourceLang.value === targetLang.value) {
    showStatus('Source and target languages cannot be the same.', 'error');
    return;
  }

  // Loading state
  setLoading(true);
  outputText.innerHTML = '<div class="spinner">Translating...</div>';
  outputText.dataset.translated = '';
  copyBtn.style.display = 'none';
  hideStatus();

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sourceLanguage: sourceLang.value,
        targetLanguage: targetLang.value,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Translation failed');
    }

    outputText.textContent = data.translatedText;
    outputText.dataset.translated = data.translatedText;
    copyBtn.style.display = 'inline-block';
    showStatus('Translation successful!', 'success');
  } catch (err) {
    outputText.innerHTML = '<span class="placeholder">Translation will appear here...</span>';
    showStatus(err.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  translateBtn.disabled = isLoading;
  translateBtn.textContent = isLoading ? 'Translating...' : 'Translate';
}

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg ${type}`;
  statusMsg.style.display = 'block';
  if (type === 'success') {
    setTimeout(hideStatus, 3000);
  }
}

function hideStatus() {
  statusMsg.style.display = 'none';
}

// ─── TAB SWITCHER ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    // Invalidate Leaflet map size when switching to map tab
    if (btn.dataset.tab === 'map' && typeof map !== 'undefined' && map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  });
});
