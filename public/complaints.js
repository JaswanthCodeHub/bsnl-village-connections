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
  const password = $('#customerPassword').value;

  if (!landlineNo) {
    showToast('Please enter your landline number.', true);
    return;
  }
  if (!password) {
    showToast('Please enter your password.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging in…';

  try {
    const res = await fetch('/api/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landlineNo, password })
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
  const name = customerInfo.customerName || 'Customer';
  $('#customerWelcome').textContent = name;
  $('#custInfoName').textContent = name;
  $('#custInfoLandline').textContent = customerInfo.landlineNo;
  $('#custInfoArea').textContent = customerInfo.area;
  $('#custInfoUserId').textContent = customerInfo.userId;
  // Banner
  const avatar = $('#custAvatar');
  if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
  const bannerName = $('#custBannerName');
  if (bannerName) bannerName.textContent = name;
  // Status pill
  const statusEl = $('#custInfoStatus');
  if (statusEl) {
    const s = (customerInfo.status || 'active').toLowerCase();
    const isActive = s === 'active';
    statusEl.innerHTML = `<span class="status-pill ${isActive ? 'active' : 'inactive'}">${isActive ? '● Active' : '● Inactive'}</span>`;
  }
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
  // Update tab badge
  const tabBadge = $('#complaintTabBadge');
  if (tabBadge) {
    if (complaints.length > 0) {
      tabBadge.textContent = complaints.length;
      tabBadge.style.display = 'inline-flex';
    } else {
      tabBadge.style.display = 'none';
    }
  }

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
   Customer Registration
   =========================== */
async function handleRegister(e) {
  e.preventDefault();
  const area = $('#regArea').value;
  const customerName = $('#regCustomerName').value.trim();
  const landlineNo = $('#regLandlineNo').value.trim();
  const userIdPrefix = $('#regUserIdPrefix').value.trim();
  const password = $('#regPassword')?.value?.trim() || '';
  const btn = $('#submitRegisterBtn');

  if (!area) {
    showToast('Please select your area/village.', true);
    return;
  }
  if (!customerName) {
    showToast('Please enter your name.', true);
    return;
  }
  if (!landlineNo) {
    showToast('Please enter your landline number.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating Account…';

  try {
    const res = await fetch('/api/customer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area, customerName, landlineNo, userIdPrefix, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    $('#registerDialog').close();
    customerInfo = data.customer;
    populateInfo();
    showToast('Account created successfully! Welcome, ' + customerInfo.customerName + '!');
    showDashboard();
    loadComplaints();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account & Login';
  }
}

/* ===========================
   Edit Profile
   =========================== */
function openEditProfile() {
  if (!customerInfo) return;
  $('#editName').value = customerInfo.customerName || '';
  $('#editArea').value = customerInfo.area || '';
  $('#editLandline').value = customerInfo.landlineNo || '';
  // Extract userId prefix (remove _sid@ftth.bsnl.in)
  const uid = (customerInfo.userId || '').replace(/_?sid@.*$/i, '');
  $('#editUserId').value = uid;
  $('#editNewPassword').value = '';
  $('#editConfirmPassword').value = '';
  $('#editProfileDialog').showModal();
  $('#editName').focus();
}

async function handleEditProfile(e) {
  e.preventDefault();
  const btn = $('#saveProfileBtn');
  const customerName = $('#editName').value.trim();
  const area = $('#editArea').value;
  const userIdPrefix = $('#editUserId').value.trim();
  const newPassword = $('#editNewPassword').value;
  const confirmPassword = $('#editConfirmPassword').value;

  if (!customerName) {
    showToast('Name is required.', true);
    return;
  }
  if (newPassword && newPassword !== confirmPassword) {
    showToast('Passwords do not match!', true);
    return;
  }
  if (newPassword && newPassword.length < 4) {
    showToast('Password must be at least 4 characters.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const body = { customerName, area, userIdPrefix };
    if (newPassword) body.newPassword = newPassword;

    const res = await fetch('/api/customer/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update failed');

    customerInfo = data.customer;
    populateInfo();
    $('#editProfileDialog').close();
    showToast('Profile updated successfully!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

/* ===========================
   Event Listeners
   =========================== */
$('#customerLoginForm').addEventListener('submit', handleLogin);
$('#customerRegisterForm')?.addEventListener('submit', handleRegister);
$('#editProfileForm')?.addEventListener('submit', handleEditProfile);
$('#customerLogoutBtn').addEventListener('click', handleLogout);

$('#editProfileBtn')?.addEventListener('click', openEditProfile);
$('#closeEditProfileBtn')?.addEventListener('click', () => $('#editProfileDialog').close());
$('#cancelEditProfileBtn')?.addEventListener('click', () => $('#editProfileDialog').close());

$('#openRegisterModalBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  $('#registerDialog').showModal();
  $('#regArea').focus();
});

$('#closeRegisterDialogBtn')?.addEventListener('click', () => $('#registerDialog').close());
$('#cancelRegisterBtn')?.addEventListener('click', () => $('#registerDialog').close());
$('#closeDialogBtn')?.addEventListener('click', () => $('#complaintDialog').close());
$('#cancelComplaintBtn')?.addEventListener('click', () => $('#complaintDialog').close());

$('#newComplaintBtn')?.addEventListener('click', () => {
  $('#complaintDialog').showModal();
  $('#complaintCategory').focus();
});
$('#submitComplaintBtn').addEventListener('click', submitComplaint);

/* ===========================
   Customer Tab Switching
   =========================== */
document.querySelectorAll('.cust-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.cust-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    const accountTab = $('#accountTab');
    const complaintsTab = $('#complaintsTab');
    if (accountTab) accountTab.style.display = target === 'account' ? 'block' : 'none';
    if (complaintsTab) complaintsTab.style.display = target === 'complaints' ? 'block' : 'none';
    if (target === 'complaints') loadComplaints();
  });
});

/* ===========================
   Quick Action Buttons
   =========================== */
$('#quickComplaintBtn')?.addEventListener('click', () => {
  // Switch to complaints tab and open dialog
  document.querySelectorAll('.cust-tab').forEach(t => t.classList.remove('active'));
  $('#tabMyComplaints')?.classList.add('active');
  const accountTab = $('#accountTab');
  const complaintsTab = $('#complaintsTab');
  if (accountTab) accountTab.style.display = 'none';
  if (complaintsTab) complaintsTab.style.display = 'block';
  loadComplaints();
  setTimeout(() => {
    $('#complaintDialog')?.showModal();
    $('#complaintCategory')?.focus();
  }, 200);
});

$('#quickEditBtn')?.addEventListener('click', openEditProfile);
$('#quickPasswordBtn')?.addEventListener('click', () => {
  openEditProfile();
  // Focus password field after a tick
  setTimeout(() => $('#editNewPassword')?.focus(), 300);
});

/* ===========================
   Init
   =========================== */
checkAuth();
