/* ===========================
   Fetch Interceptor for Auth Gating
   =========================== */
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
  if (response.status === 401 && !url.includes('/api/login') && !url.includes('/api/auth-check')) {
    clearSessionTimer();
    showLoginView();
  }
  return response;
};

/* ===========================
   Selectors & Constants
   =========================== */
const $ = (selector) => document.querySelector(selector);
const USER_ID_SUFFIX = '_sid@ftth.bsnl.in';
const formFields = ['area', 'vlanNo', 'customerName', 'landlineNo', 'notes'];
let connections = [];
let toastTimer;

/* ===========================
   Utility Functions
   =========================== */
const escapeHtml = (value = '') =>
  String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
    '"': '&quot;',
  }[character]));

const display = (value, fallback = '—') =>
  value ? escapeHtml(value) : fallback;

/* dateDisplay() removed — not currently used */

/* ===========================
   Toast Notification
   =========================== */
function showToast(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
}

/* ===========================
   Filter & Search
   =========================== */
function visibleConnections() {
  const query = $('#searchInput').value.trim().toLowerCase();
  const area = $('#areaFilter').value;

  return connections.filter((item) => {
    const searchable = [
      item.area,
      item.vlanNo,
      item.customerName,
      item.landlineNo,
      item.userId,
      item.notes,
    ].join(' ').toLowerCase();

    return (!query || searchable.includes(query))
      && (!area || item.area === area);
  });
}

/* ===========================
   Render Table
   =========================== */
function render() {
  const filtered = visibleConnections();
  const selectedArea = $('#areaFilter').value;

  $('#resultCount').textContent =
    `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}`;

  const exportButton = $('#exportButton');
  exportButton.href = selectedArea
    ? `/api/export?area=${encodeURIComponent(selectedArea)}`
    : '/api/export';
  exportButton.textContent = selectedArea
    ? `Download ${selectedArea} Excel`
    : 'Download all Excel';

  $('#replaceLabel').textContent = selectedArea
    ? `↻ Replace ${selectedArea} Excel`
    : '↻ Replace selected Excel';

  $('#connectionsBody').innerHTML = filtered.map((item) => `
    <tr>
      <td><strong>${display(item.area)}</strong></td>
      <td><strong>${display(item.vlanNo)}</strong></td>
      <td class="name-column">
        <span class="customer-name">${display(item.customerName)}</span>
        <span class="subtext">${display(item.notes, '')}</span>
      </td>
      <td>${display(item.landlineNo)}</td>
      <td>${display(item.userId)}</td>
      <td>
        <div class="row-actions">
          <button class="action" data-action="edit" data-id="${item.id}" type="button">
            Edit
          </button>
          <button class="action delete" data-action="delete" data-id="${item.id}" type="button">
            Delete
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  $('#mobileCards').innerHTML = filtered.map((item) => `
    <div class="mobile-card">
      <div class="mobile-card-header">
        <div>
          <div class="mobile-card-name">${display(item.customerName)}</div>
          <div class="mobile-card-area">${display(item.area)}</div>
        </div>
      </div>
      <div class="mobile-card-fields">
        <div class="mobile-card-field">
          <span class="mobile-card-label">VLAN No</span>
          <div class="mobile-card-value">${display(item.vlanNo)}</div>
        </div>
        <div class="mobile-card-field">
          <span class="mobile-card-label">Landline No</span>
          <div class="mobile-card-value">${display(item.landlineNo)}</div>
        </div>
        <div class="mobile-card-field full-width">
          <span class="mobile-card-label">User ID</span>
          <div class="mobile-card-value">${display(item.userId)}</div>
        </div>
        ${item.notes ? `
        <div class="mobile-card-field full-width">
          <span class="mobile-card-label">Notes</span>
          <div class="mobile-card-value mobile-card-notes">${display(item.notes)}</div>
        </div>
        ` : ''}
      </div>
      <div class="mobile-card-actions">
        <button class="action" data-action="edit" data-id="${item.id}" type="button">Edit</button>
        <button class="action delete" data-action="delete" data-id="${item.id}" type="button">Delete</button>
      </div>
    </div>
  `).join('');

  $('#emptyState').hidden = connections.length !== 0;
  $('.table-scroll').hidden = connections.length === 0;
  $('#mobileCards').hidden = connections.length === 0;
}

/* ===========================
   Load Connections from API
   =========================== */
async function loadConnections() {
  try {
    const response = await fetch('/api/connections');
    if (!response.ok) throw new Error('Could not load data');
    const data = await response.json();
    connections = data.connections;
    render();
  } catch (error) {
    showToast('Could not load data. Please check that the server is running.', true);
  }
}

/* ===========================
   Open Add / Edit Form
   =========================== */
function openForm(item = null) {
  $('#connectionForm').reset();
  $('#connectionId').value = item?.id || '';

  $('#modalEyebrow').textContent = item ? 'EDIT CUSTOMER' : 'NEW CUSTOMER';
  $('#modalTitle').textContent = item ? 'Edit customer details' : 'Add a customer';
  $('#saveButton').textContent = item ? 'Save changes' : 'Save customer';

  for (const field of formFields) {
    $(`#${field}`).value = item?.[field] || '';
  }

  if (!item) {
    $('#landlineNo').value = '08643-';
  }

  const currentUserId = item?.userId || '';
  $('#userIdPrefix').value = currentUserId.replace(/_?sid@.*$/i, '');

  $('#connectionDialog').showModal();
  setTimeout(() => $('#customerName').focus(), 50);
}

/* ===========================
   Save Connection
   =========================== */
async function saveConnection() {
  const id = $('#connectionId').value;
  const payload = Object.fromEntries(
    formFields.map((field) => [field, $(`#${field}`).value])
  );
  payload.userId =
    `${$('#userIdPrefix').value.trim().replace(/_?sid@.*$/i, '')}${USER_ID_SUFFIX}`;

  // Validate required fields
  if (!payload.area.trim()) {
    $('#area').focus();
    showToast('Please select an area or route.', true);
    return;
  }

  if (!payload.customerName.trim()) {
    $('#customerName').focus();
    showToast('Customer name is required.', true);
    return;
  }

  const landlineDigits = payload.landlineNo.replace(/\D/g, '');
  if (!landlineDigits.startsWith('08643')) {
    $('#landlineNo').focus();
    showToast('Landline number must start with 08643.', true);
    return;
  }

  if (landlineDigits.length !== 11) {
    $('#landlineNo').focus();
    showToast('Enter the full 11-digit landline number.', true);
    return;
  }

  if (!$('#userIdPrefix').value.trim()) {
    $('#userIdPrefix').focus();
    showToast('Enter the User ID number before the fixed suffix.', true);
    return;
  }

  // Send to API
  const saveButton = $('#saveButton');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';

  try {
    const response = await fetch(
      id ? `/api/connections/${id}` : '/api/connections',
      {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');

    $('#connectionDialog').close();
    showToast(id ? 'Customer details updated.' : 'New customer added.');
    await loadConnections();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = id ? 'Save changes' : 'Save customer';
  }
}

/* ===========================
   Import Excel / CSV File
   =========================== */
async function importFile(file) {
  if (!file) return;

  const selectedArea = $('#areaFilter').value;
  if (!selectedArea) {
    $('#excelFile').value = '';
    showToast('Please select an Area / Route before replacing data.', true);
    return;
  }

  const areaRecords = connections.filter((item) => item.area === selectedArea).length;
  if (areaRecords && !confirm(
    `Importing "${file.name}" will remove only the ${areaRecords} current ${selectedArea} ` +
    `record${areaRecords === 1 ? '' : 's'}. Other areas will not change. Continue?`
  )) {
    $('#excelFile').value = '';
    return;
  }

  const dialog = $('#importDialog');
  $('#importMessage').textContent = `Reading ${file.name}…`;
  dialog.showModal();

  const body = new FormData();
  body.append('file', file);
  body.append('area', selectedArea);

  try {
    const response = await fetch('/api/import', { method: 'POST', body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Import failed');

    $('#importMessage').textContent =
      `${data.added} ${data.area} record${data.added === 1 ? '' : 's'} imported ` +
      `and ${data.replaced} old ${data.area} record${data.replaced === 1 ? '' : 's'} removed. ` +
      `Other areas are unchanged.` +
      (data.skipped
        ? ` ${data.skipped} row${data.skipped === 1 ? '' : 's'} skipped because customer name was missing.`
        : '');

    await loadConnections();
    setTimeout(() => { if (dialog.open) dialog.close(); }, 1700);
  } catch (error) {
    dialog.close();
    showToast(error.message, true);
  } finally {
    $('#excelFile').value = '';
  }
}

/* ===========================
   Event Listeners
   =========================== */
$('#addButton').addEventListener('click', () => openForm());
$('#emptyAddButton').addEventListener('click', () => openForm());
$('#saveButton').addEventListener('click', saveConnection);
let searchDebounce;
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(render, 150);
});
$('#areaFilter').addEventListener('change', render);

$('#clearFilters').addEventListener('click', () => {
  $('#searchInput').value = '';
  $('#areaFilter').value = '';
  render();
});

$('#excelFile').addEventListener('change', (event) =>
  importFile(event.target.files[0])
);

async function handleActionClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const item = connections.find((connection) => connection.id === button.dataset.id);
  if (!item) return;

  if (button.dataset.action === 'edit') {
    return openForm(item);
  }

  if (confirm(`Delete the record for "${item.customerName}"?`)) {
    try {
      const response = await fetch(`/api/connections/${item.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      showToast('Record deleted.');
      await loadConnections();
    } catch {
      showToast('Could not delete the record.', true);
    }
  }
}

$('#connectionsBody').addEventListener('click', handleActionClick);
$('#mobileCards').addEventListener('click', handleActionClick);

/* ===========================
   Voice Search
   =========================== */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-IN';

  const voiceBtn = $('#voiceSearchBtn');
  let isListening = false;

  voiceBtn.addEventListener('click', () => {
    if (isListening) {
      recognition.stop();
      return;
    }
    recognition.start();
  });

  recognition.addEventListener('start', () => {
    isListening = true;
    voiceBtn.classList.add('listening');
    voiceBtn.title = 'Listening… tap to stop';
    $('#searchInput').placeholder = '🎤 Listening…';
  });

  recognition.addEventListener('result', (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    $('#searchInput').value = transcript;
    render();
  });

  recognition.addEventListener('end', () => {
    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceBtn.title = 'Search by voice';
    $('#searchInput').placeholder = 'VLAN number, name, landline or user ID…';
  });

  recognition.addEventListener('error', (event) => {
    isListening = false;
    voiceBtn.classList.remove('listening');
    voiceBtn.title = 'Search by voice';
    $('#searchInput').placeholder = 'VLAN number, name, landline or user ID…';
    if (event.error === 'not-allowed') {
      showToast('Microphone access denied. Please allow it in browser settings.', true);
    }
  });
} else {
  // Hide mic button if browser doesn't support Speech API
  const voiceBtn = $('#voiceSearchBtn');
  if (voiceBtn) voiceBtn.style.display = 'none';
}

/* ===========================
   Authentication Handlers & Views
   =========================== */
function showLoginView() {
  $('#appShell').style.display = 'none';
  $('#loginShell').style.display = 'flex';
  $('#loginPassword').value = '';
}

function showDashboardView() {
  $('#loginShell').style.display = 'none';
  $('#appShell').style.display = 'block';
}

/* checkAuth() removed — init() handles this */

async function handleLogin(event) {
  event.preventDefault();
  const username = $('#loginUsername').value.trim();
  const password = $('#loginPassword').value;
  const submitBtn = $('#loginSubmitBtn');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    
    showToast('Logged in successfully.');
    showDashboardView();
    startSessionTimer(data.sessionMaxAge || 1800);
    await loadConnections();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
}

async function handleLogout() {
  try {
    clearSessionTimer();
    const response = await fetch('/api/logout', { method: 'POST' });
    if (response.ok) {
      showToast('Logged out successfully.');
      showLoginView();
    }
  } catch {
    showToast('Error logging out.', true);
  }
}

/* ===========================
   Session Expiry Timer
   =========================== */
let sessionTimerId = null;
let sessionWarningId = null;
let sessionCountdownId = null;
const SESSION_WARNING_BEFORE_SEC = 120; // Show warning 2 min before expiry

function startSessionTimer(maxAgeSec) {
  clearSessionTimer();

  const expiryMs = maxAgeSec * 1000;
  const warningMs = Math.max(expiryMs - (SESSION_WARNING_BEFORE_SEC * 1000), 0);

  // Show warning banner 2 minutes before expiry
  sessionWarningId = setTimeout(() => {
    showSessionWarning(SESSION_WARNING_BEFORE_SEC);
  }, warningMs);

  // Auto-logout on expiry
  sessionTimerId = setTimeout(() => {
    clearSessionTimer();
    showToast('Session expired. Please login again.', true);
    showLoginView();
  }, expiryMs);
}

function clearSessionTimer() {
  clearTimeout(sessionTimerId);
  clearTimeout(sessionWarningId);
  clearInterval(sessionCountdownId);
  sessionTimerId = null;
  sessionWarningId = null;
  sessionCountdownId = null;
  hideSessionWarning();
}

function showSessionWarning(secondsLeft) {
  let remaining = secondsLeft;
  let banner = document.getElementById('sessionWarningBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'sessionWarningBanner';
    banner.className = 'session-warning-banner';
    banner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>
      <span id="sessionWarningText"></span>
      <button id="sessionExtendBtn" onclick="extendSession()">Stay logged in</button>
    `;
    document.body.appendChild(banner);
  }
  banner.style.display = 'flex';

  function updateText() {
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    const textEl = document.getElementById('sessionWarningText');
    if (textEl) textEl.textContent = `Session expires in ${timeStr}.`;
    remaining--;
    if (remaining < 0) clearInterval(sessionCountdownId);
  }

  updateText();
  sessionCountdownId = setInterval(updateText, 1000);
}

function hideSessionWarning() {
  const banner = document.getElementById('sessionWarningBanner');
  if (banner) banner.style.display = 'none';
}

async function extendSession() {
  try {
    const username = $('#loginUsername').value.trim();
    const password = $('#loginPassword').value;
    if (!username || !password) {
      showToast('Session expired. Please login again.', true);
      clearSessionTimer();
      showLoginView();
      return;
    }
    const loginRes = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const loginData = await loginRes.json();
    if (loginRes.ok) {
      clearSessionTimer();
      startSessionTimer(loginData.sessionMaxAge || 1800);
      showToast('Session extended.');
    } else {
      showToast('Session expired. Please login again.', true);
      showLoginView();
    }
  } catch {
    showToast('Could not extend session.', true);
  }
}

$('#loginForm').addEventListener('submit', handleLogin);
$('#logoutButton').addEventListener('click', handleLogout);

const eyeToggle = document.querySelector('.eye-toggle');
if (eyeToggle) {
  eyeToggle.addEventListener('click', () => {
    const pwInput = $('#loginPassword');
    const isPass = pwInput.type === 'password';
    pwInput.type = isPass ? 'text' : 'password';
    eyeToggle.setAttribute('aria-pressed', String(isPass));
    eyeToggle.innerHTML = isPass 
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  });
}

/* ===========================
   Initialize
   =========================== */
async function init() {
  try {
    const response = await fetch('/api/auth-check');
    const data = await response.json();
    if (data.authenticated) {
      showDashboardView();
      startSessionTimer(data.sessionMaxAge || 1800);
      await loadConnections();
    } else {
      showLoginView();
    }
  } catch (err) {
    showLoginView();
  }
}
init();

