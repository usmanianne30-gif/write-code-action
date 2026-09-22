/**
 * dashboard.js — WCA Member Workspace
 * Handles:
 *  - Authentication verification and profile rendering
 *  - Primary tab switching: Write, Code, Action
 *  - Action sub-view switching: Theatre Script vs Anime Composition Notebook
 *  - Debounced auto-save per user
 *  - Theatre formatting tools
 *  - Director Console (exclusive to usmanianne30): member directory, daily activity log, and draft inspection
 *  - Sign Out
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

let currentUser = null;
const loadedSections = new Set();
const saveTimers = {};

// ─── DOM References ──────────────────────────────────────────────────────────

const userAvatar = document.getElementById('user-avatar');
const userRealName = document.getElementById('user-real-name');
const userId = document.getElementById('user-id');
const btnLogout = document.getElementById('btn-logout');
const btnAdminToggle = document.getElementById('btn-admin-toggle');

// Main navigation tabs & panels
const primaryTabs = document.querySelectorAll('.db-tab');
const primaryPanels = document.querySelectorAll('.db-panel');

// Save indicators
const saveStatus = {
  write: document.getElementById('save-write'),
  action: document.getElementById('save-action')
};

// Editors
const editorWrite = document.getElementById('editor-write');
const editorTheatre = document.getElementById('editor-theatre');
const editorAnime = document.getElementById('editor-anime');

// Counters
const wordsWrite = document.getElementById('words-write');
const wordsTheatre = document.getElementById('words-theatre');
const wordsAnime = document.getElementById('words-anime');

// Action sub-navigation
const subBtnTheatre = document.getElementById('sub-btn-theatre');
const subBtnAnime = document.getElementById('sub-btn-anime');
const viewTheatre = document.getElementById('action-view-theatre');
const viewAnime = document.getElementById('action-view-anime');
let activeActionSubTab = 'theatre'; // 'theatre' | 'anime'

// Admin Drawer
const adminDrawer = document.getElementById('admin-drawer');
const adminOverlay = document.getElementById('admin-overlay');
const btnAdminClose = document.getElementById('btn-admin-close');
const btnTabRoster = document.getElementById('btn-tab-roster');
const btnTabActivity = document.getElementById('btn-tab-activity');
const viewRoster = document.getElementById('admin-view-roster');
const viewActivity = document.getElementById('admin-view-activity');
const rosterList = document.getElementById('admin-roster-list');
const activityList = document.getElementById('admin-activity-list');
const countMembers = document.getElementById('count-members');
const countActivity = document.getElementById('count-activity');

// Inspect Modal
const inspectModal = document.getElementById('admin-inspect-modal');
const btnInspectClose = document.getElementById('btn-inspect-close');
const inspectMemberName = document.getElementById('inspect-member-name');
const inspectContentText = document.getElementById('inspect-content-text');
const inspectTabs = document.querySelectorAll('.inspect-tab-btn');
let currentInspectUsername = null;
let currentInspectSection = 'write';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function updateWordCounters() {
  if (wordsWrite) wordsWrite.textContent = `${countWords(editorWrite.value)} words`;
  if (wordsTheatre) wordsTheatre.textContent = `${countWords(editorTheatre.value)} words`;
  if (wordsAnime) wordsAnime.textContent = `${countWords(editorAnime.value)} words`;
}

function setStatus(panelKey, state, text) {
  const el = saveStatus[panelKey];
  if (!el) return;
  el.textContent = text;
  el.className = `db-save-status ${state}`;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ─── Profile & Auth ──────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // Not logged in -> redirect to login page
      window.location.href = '/login';
      return;
    }
    currentUser = await res.json();

    // Render user details
    userRealName.textContent = currentUser.name || currentUser.username;
    userId.textContent = `@${currentUser.username}`;
    userAvatar.textContent = (currentUser.name || currentUser.username).charAt(0).toUpperCase();

    // If usmanianne30, show admin console trigger
    if (currentUser.username === 'usmanianne30' || currentUser.isAdmin) {
      btnAdminToggle.hidden = false;
    }

    // Set today's date stamp on old paper
    const writeDateEl = document.getElementById('write-current-date');
    if (writeDateEl) {
      const now = new Date();
      writeDateEl.textContent = now.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).toUpperCase();
    }

    // Load initial content
    loadSectionContent('write');
  } catch (err) {
    console.error('Auth verification failed:', err);
    window.location.href = '/login';
  }
}

btnLogout.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login';
  }
});

// ─── Content Load & Auto-Save ────────────────────────────────────────────────

async function loadSectionContent(section) {
  if (loadedSections.has(section)) return;
  try {
    const res = await fetch(`/api/content?section=${section}`);
    if (!res.ok) return;
    const data = await res.json();

    if (section === 'write') {
      editorWrite.value = data.body || '';
    } else if (section === 'action_theatre') {
      editorTheatre.value = data.body || '';
    } else if (section === 'action_anime') {
      editorAnime.value = data.body || '';
    }

    loadedSections.add(section);
    updateWordCounters();
  } catch (err) {
    console.error(`Failed to load ${section}:`, err);
  }
}

async function saveContent(section, text, panelKey) {
  setStatus(panelKey, 'saving', 'saving…');
  try {
    const res = await fetch('/api/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, body: text })
    });
    if (!res.ok) throw new Error();
    setStatus(panelKey, 'saved', 'saved ✓');
    setTimeout(() => {
      if (saveStatus[panelKey]?.textContent === 'saved ✓') {
        setStatus(panelKey, '', '');
      }
    }, 2000);
  } catch (_) {
    setStatus(panelKey, 'error', 'error saving');
  }
}

function scheduleSave(section, text, panelKey) {
  clearTimeout(saveTimers[section]);
  saveTimers[section] = setTimeout(() => {
    saveContent(section, text, panelKey);
  }, 1200);
}

// ─── Primary Tab Navigation (Write, Code, Action) ────────────────────────────

function switchPrimaryTab(targetPanel) {
  primaryTabs.forEach(tab => {
    const isTarget = tab.dataset.panel === targetPanel;
    tab.classList.toggle('active', isTarget);
    tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  primaryPanels.forEach(panel => {
    const isTarget = panel.id === `panel-${targetPanel}`;
    panel.classList.toggle('active', isTarget);
    panel.hidden = !isTarget;
  });

  if (targetPanel === 'write') {
    loadSectionContent('write');
  } else if (targetPanel === 'action') {
    loadSectionContent(activeActionSubTab === 'theatre' ? 'action_theatre' : 'action_anime');
  }
}

primaryTabs.forEach(tab => {
  tab.addEventListener('click', () => switchPrimaryTab(tab.dataset.panel));
});

// ─── Action Sub-Views (Theatre Script vs Anime Notebook) ─────────────────────

function switchActionSubView(mode) {
  activeActionSubTab = mode;
  const isTheatre = mode === 'theatre';

  subBtnTheatre.classList.toggle('active', isTheatre);
  subBtnTheatre.setAttribute('aria-selected', isTheatre ? 'true' : 'false');
  viewTheatre.classList.toggle('active', isTheatre);
  viewTheatre.hidden = !isTheatre;

  subBtnAnime.classList.toggle('active', !isTheatre);
  subBtnAnime.setAttribute('aria-selected', !isTheatre ? 'true' : 'false');
  viewAnime.classList.toggle('active', !isTheatre);
  viewAnime.hidden = isTheatre;

  if (isTheatre) {
    loadSectionContent('action_theatre');
  } else {
    loadSectionContent('action_anime');
  }
}

subBtnTheatre.addEventListener('click', () => switchActionSubView('theatre'));
subBtnAnime.addEventListener('click', () => switchActionSubView('anime'));

// ─── Editor Input Listeners ──────────────────────────────────────────────────

editorWrite.addEventListener('input', () => {
  updateWordCounters();
  scheduleSave('write', editorWrite.value, 'write');
});

editorTheatre.addEventListener('input', () => {
  updateWordCounters();
  scheduleSave('action_theatre', editorTheatre.value, 'action');
});

editorAnime.addEventListener('input', () => {
  updateWordCounters();
  scheduleSave('action_anime', editorAnime.value, 'action');
});

// ─── Theatre Script Formatting Chips ─────────────────────────────────────────

document.querySelectorAll('.script-tag-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const textToInsert = btn.dataset.insert;
    if (!textToInsert) return;

    editorTheatre.focus();
    const start = editorTheatre.selectionStart;
    const end = editorTheatre.selectionEnd;
    const val = editorTheatre.value;

    // Insert with clean line break context
    const prefix = (start > 0 && val[start - 1] !== '\n') ? '\n\n' : '';
    const insertion = prefix + textToInsert;

    editorTheatre.value = val.slice(0, start) + insertion + val.slice(end);
    const newPos = start + insertion.length;
    editorTheatre.selectionStart = editorTheatre.selectionEnd = newPos;

    updateWordCounters();
    scheduleSave('action_theatre', editorTheatre.value, 'action');
  });
});

// ─── Director's Console (Exclusive to usmanianne30) ──────────────────────────

async function fetchAdminOverview() {
  try {
    const res = await fetch('/api/admin/overview');
    if (!res.ok) return;
    const data = await res.json();

    countMembers.textContent = data.members.length;
    countActivity.textContent = data.activities.length;

    renderRoster(data.members);
    renderActivities(data.activities);
  } catch (err) {
    console.error('Failed to load admin overview:', err);
  }
}

function renderRoster(members) {
  if (!members || !members.length) {
    rosterList.innerHTML = '<p class="admin-empty-text">No members registered yet.</p>';
    return;
  }

  rosterList.innerHTML = members.map(m => `
    <div class="roster-card">
      <div class="roster-top-row">
        <span class="roster-member-name">${escapeHtml(m.name)}</span>
        <span class="roster-member-id">@${escapeHtml(m.username)}</span>
      </div>
      <div class="roster-meta-row">
        <span>Joined: ${formatDate(m.joined_at)}</span>
        <span>Active: ${formatDate(m.last_active_at)}</span>
      </div>
      <div class="roster-actions">
        <span class="roster-stats-pill">${m.stats.totalWords} total words</span>
        <button type="button" class="btn-inspect-member" data-username="${escapeHtml(m.username)}" data-name="${escapeHtml(m.name)}">
          Inspect Drafts ↗
        </button>
      </div>
    </div>
  `).join('');

  // Wire inspect buttons
  rosterList.querySelectorAll('.btn-inspect-member').forEach(btn => {
    btn.addEventListener('click', () => {
      openInspectModal(btn.dataset.username, btn.dataset.name);
    });
  });
}

function renderActivities(activities) {
  if (!activities || !activities.length) {
    activityList.innerHTML = '<p class="admin-empty-text">No activity recorded yet.</p>';
    return;
  }

  activityList.innerHTML = activities.map(a => `
    <div class="activity-item">
      <div class="activity-time">${formatDate(a.timestamp)}</div>
      <div class="activity-desc">
        <strong>${escapeHtml(a.name)}</strong> (@${escapeHtml(a.username)}): ${escapeHtml(a.action)}
      </div>
      ${a.details ? `<div class="activity-detail">${escapeHtml(a.details)}</div>` : ''}
    </div>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Admin Drawer Open / Close
btnAdminToggle.addEventListener('click', () => {
  adminDrawer.classList.add('open');
  adminDrawer.setAttribute('aria-hidden', 'false');
  fetchAdminOverview();
});

function closeAdminDrawer() {
  adminDrawer.classList.remove('open');
  adminDrawer.setAttribute('aria-hidden', 'true');
}

btnAdminClose.addEventListener('click', closeAdminDrawer);
adminOverlay.addEventListener('click', closeAdminDrawer);

// Admin Drawer Tabs
btnTabRoster.addEventListener('click', () => {
  btnTabRoster.classList.add('active');
  btnTabActivity.classList.remove('active');
  viewRoster.classList.add('active');
  viewRoster.hidden = false;
  viewActivity.classList.remove('active');
  viewActivity.hidden = true;
});

btnTabActivity.addEventListener('click', () => {
  btnTabActivity.classList.add('active');
  btnTabRoster.classList.remove('active');
  viewActivity.classList.add('active');
  viewActivity.hidden = false;
  viewRoster.classList.remove('active');
  viewRoster.hidden = true;
});

// ─── Inspect Modal (usmanianne30 viewing member drafts) ──────────────────────

async function openInspectModal(username, name) {
  currentInspectUsername = username;
  inspectMemberName.textContent = `${name} (@${username})`;
  inspectModal.showModal();
  loadInspectContent();
}

async function loadInspectContent() {
  inspectContentText.textContent = 'Loading draft…';
  try {
    const res = await fetch(`/api/content?section=${currentInspectSection}&user=${encodeURIComponent(currentInspectUsername)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    inspectContentText.textContent = data.body || '(This member has not written in this section yet)';
  } catch (_) {
    inspectContentText.textContent = 'Could not load member draft.';
  }
}

inspectTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    inspectTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentInspectSection = tab.dataset.inspectSection;
    loadInspectContent();
  });
});

btnInspectClose.addEventListener('click', () => inspectModal.close());
inspectModal.addEventListener('click', e => { if (e.target === inspectModal) inspectModal.close(); });

// ─── Boot ────────────────────────────────────────────────────────────────────

checkAuth();
