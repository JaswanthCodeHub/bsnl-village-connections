/* ===========================
   BSNL Customer Complaint Portal — Client JS
   =========================== */
const $ = (sel) => document.querySelector(sel);

const escapeHtml = (v = '') =>
  String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));

let customerInfo = null;
let toastTimer;

/* ===========================
   Toast
   =========================== */
function showToast(msg, isError = false) {
  const t = $('#customerToast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3800);
}

/* ===========================
   Views
   =========================== */
function showLogin() {
  $('#customerLoginShell').style.display = 'flex';
  $('#customerDashboard').style.display = 'none';
}

function showDashboard() {
  $('#customerLoginShell').style.display = 'none';
  $('#customerDashboard').style.display = 'block';
}

/* ===========================
   Auth
   =========================== */
async function checkAuth() {
  try {
    const res = await fetch('/api/customer/auth-check');
    const data = await res.json();
    if (data.authenticated) {
      customerInfo = data.customer;
      populateInfo();
      showDashboard();
      loadComplaints();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('#customerLoginBtn');
  const landlineNo = $('#customerLandline').value.trim();

  if (!landlineNo) {
    showToast('Please enter your landline number.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in…';

  try {
    const res = await fetch('/api/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landlineNo })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    customerInfo = data.customer;
    populateInfo();
    showToast('Welcome, ' + customerInfo.customerName + '!');
    showDashboard();
    loadComplaints();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/customer/logout', { method: 'POST' });
    customerInfo = null;
    showToast('Logged out.');
    showLogin();
  } catch {
    showToast('Error logging out.', true);
  }
}

function populateInfo() {
  if (!customerInfo) return;
  $('#customerWelcome').textContent = customerInfo.customerName;
  $('#custInfoName').textContent = customerInfo.customerName;
  $('#custInfoLandline').textContent = customerInfo.landlineNo;
  $('#custInfoArea').textContent = customerInfo.area;
  $('#custInfoUserId').textContent = customerInfo.userId;
}

/* ===========================
   Complaints
   =========================== */
const statusLabels = {
  'open': 'Open',
  'in-progress': 'In Progress',
  'resolved': 'Resolved',
  'closed': 'Closed'
};

const statusClasses = {
  'open': 'badge-open',
  'in-progress': 'badge-progress',
  'resolved': 'badge-resolved',
  'closed': 'badge-closed'
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

async function loadComplaints() {
  try {
    const res = await fetch('/api/customer/complaints');
    if (!res.ok) return;
    const data = await res.json();
    renderComplaints(data.complaints);
  } catch {
    showToast('Could not load complaints.', true);
  }
}

function renderComplaints(complaints) {
  const list = $('#complaintsList');
  const empty = $('#complaintsEmpty');
  const count = $('#complaintsCount');

  count.textContent = `${complaints.length} complaint${complaints.length === 1 ? '' : 's'}`;

  if (!complaints.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = complaints.map(c => `
    <div class="complaint-card">
      <div class="complaint-card-header">
        <span class="complaint-category">${escapeHtml(c.category)}</span>
        <span class="complaint-badge ${statusClasses[c.status]}">${statusLabels[c.status]}</span>
      </div>
      <div class="complaint-card-date">${formatDate(c.createdAt)}</div>
      <div class="complaint-card-desc">${escapeHtml(c.description)}</div>
      ${c.adminNote ? `
        <div class="complaint-card-reply">
          <strong>BSNL Response:</strong>
          <p>${escapeHtml(c.adminNote)}</p>
        </div>
      ` : ''}
      ${c.resolvedAt ? `<div class="complaint-card-resolved">Resolved on ${formatDate(c.resolvedAt)}</div>` : ''}
    </div>
  `).join('');
}

/* ===========================
   New Complaint
   =========================== */
async function submitComplaint() {
  const category = $('#complaintCategory').value;
  const description = $('#complaintDescription').value.trim();
  const btn = $('#submitComplaintBtn');

  if (!category) {
    showToast('Please select a category.', true);
    return;
  }
  if (!description) {
    showToast('Please describe your issue.', true);
    $('#complaintDescription').focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/customer/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, description })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit');

    $('#complaintDialog').close();
    $('#complaintCategory').value = '';
    $('#complaintDescription').value = '';
    showToast('Complaint registered successfully!');
    loadComplaints();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Complaint';
  }
}

/* ===========================
   Event Listeners
   =========================== */
$('#customerLoginForm').addEventListener('submit', handleLogin);
$('#customerLogoutBtn').addEventListener('click', handleLogout);
$('#newComplaintBtn').addEventListener('click', () => {
  $('#complaintDialog').showModal();
  $('#complaintCategory').focus();
});
$('#submitComplaintBtn').addEventListener('click', submitComplaint);

// Close dialog on cancel
$('#complaintDialog').addEventListener('click', (e) => {
  if (e.target.matches('[value="cancel"]')) {
    $('#complaintDialog').close();
  }
});

/* ===========================
   Init
   =========================== */
checkAuth();
