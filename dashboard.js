/**
 * dashboard.js — WCA Member Workspace
 * Handles:
 *  - Authentication verification and profile rendering
 *  - Primary tab switching: Write, Code, Action
 *  - Action sub-view switching: Theatre Script vs Anime Composition Notebook
 *  - AI Coding Workspace (Section 2: Code):
 *    - Ace Code Editor with multi-language syntax highlighting
 *    - Sandboxed execution (JS Web Worker, Python Pyodide WASM, and Piston remote runner)
 *    - Output terminal with execution timing and error detection
 *    - AI Coding Assistant (Gemini Flash integration, markdown, smart code blocks)
 *    - Action bridge: "Insert into Editor ↗", "Copy", quick prompt chips, terminal error fix
 *  - Debounced auto-save per user
 *  - Director Console (exclusive to usmanianne30)
 *  - Sign Out
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

let currentUser = null;
const loadedSections = new Set();
const saveTimers = {};

let currentSection = 'write'; // 'write' | 'code' | 'action'
let currentWorks = [];        // pre-existing works array
let activeWork = null;         // currently open work object, or null (gallery view)
let worksSaveTimer = null;

// PRESIDENT_USERNAME (mirrored from server, client-side only for UI gating)
const PRESIDENT_USERNAME_CLIENT = 'scatherinexx';

const SECTION_CONFIG = {
  write: {
    number: '01',
    label: 'WRITE',
    title: 'Your Stories & Worlds',
    desc: 'Every game begins in the margins. Revisit, continue, or create new stories.',
    createLabel: 'Create New Story',
    worksTitle: 'SAVED STORIES',
    defaultTitle: 'Untitled Story',
    defaultBody: '',
    defaultLang: 'plaintext'
  },
  code: {
    number: '02',
    label: 'CODE',
    title: 'Your Code & Systems',
    desc: 'Turn ideas into logic and living rules. Pick up where you left off.',
    createLabel: 'Create New Code',
    worksTitle: 'SAVED CODE',
    defaultTitle: 'Untitled Script',
    defaultBody: '# Write Code Action — Python Sandbox\n\ndef main():\n    print("Welcome to WCA Code Studio")\n\nif __name__ == "__main__":\n    main()\n',
    defaultLang: 'python'
  },
  action: {
    number: '03',
    label: 'ACTION',
    title: 'Your Scripts & Screenplays',
    desc: 'Stage your scenes, format your dialogue, and bring your visions alive.',
    createLabel: 'Create New Script',
    worksTitle: 'SAVED SCRIPTS',
    defaultTitle: 'Untitled Scene',
    defaultBody: 'ACT I\n\nSCENE 1\n\n[AT RISE: Spotlight illuminates the empty stage.]\n\nMARCUS\nWe build what we imagine.\n',
    defaultLang: 'plaintext'
  }
};

// ─── DOM References ──────────────────────────────────────────────────────────

const userAvatar = document.getElementById('user-avatar');
const userRealName = document.getElementById('user-real-name');
const userId = document.getElementById('user-id');
const btnLogout = document.getElementById('btn-logout');
const btnAdminToggle = document.getElementById('btn-admin-toggle');

// Main navigation tabs & panels
const primaryTabs = document.querySelectorAll('.db-side-tab, .db-tab');
const primaryPanels = document.querySelectorAll('.db-panel');

// Sidebar Works elements
const btnSidebarCreate = document.getElementById('btn-sidebar-create');
const btnCreateLabel = document.getElementById('btn-create-label');
const sidebarWorksHeading = document.getElementById('sidebar-works-heading');
const sidebarWorksCount = document.getElementById('sidebar-works-count');
const sidebarWorksList = document.getElementById('sidebar-works-list');

// Gallery View elements
const galleryView = document.getElementById('gallery-view');

// Members Roster View (president only)
const membersView = document.getElementById('members-view');
const membersRosterList = document.getElementById('members-roster-list');
const membersCount = document.getElementById('members-count');
const galleryEyebrow = document.getElementById('gallery-eyebrow');
const galleryTitle = document.getElementById('gallery-title');
const galleryDesc = document.getElementById('gallery-desc');
const btnGalleryCreate = document.getElementById('btn-gallery-create');
const galleryCreateLabel = document.getElementById('gallery-create-label');
const worksGrid = document.getElementById('works-grid');

// Editor View elements
const editorView = document.getElementById('editor-view');
const btnBackToGallery = document.getElementById('btn-back-to-gallery');
const workTitleInput = document.getElementById('work-title-input');
const workSaveStatus = document.getElementById('work-save-status');
const btnDeleteWork = document.getElementById('btn-delete-work');

// Save indicators
const saveStatus = {
  write: document.getElementById('save-write'),
  code: document.getElementById('save-code'),
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

// ─── Code Workspace & AI Assistant Elements ─────────────────────────────────

const codeLangSelect = document.getElementById('code-lang-select');
const btnRunCode = document.getElementById('btn-run-code');
const btnClearCode = document.getElementById('btn-clear-code');
const terminalStatusBadge = document.getElementById('terminal-status-badge');
const terminalOutputText = document.getElementById('terminal-output-text');
const btnClearTerminal = document.getElementById('btn-clear-terminal');
const btnFixWithAI = document.getElementById('btn-fix-with-ai');

const aiModelTag = document.getElementById('ai-model-tag');
const btnClearChat = document.getElementById('btn-clear-chat');
const contextLangPill = document.getElementById('context-lang-pill');
const contextDesc = document.getElementById('context-desc');
const aiChatThread = document.getElementById('ai-chat-thread');
const aiChatForm = document.getElementById('ai-chat-form');
const aiPromptInput = document.getElementById('ai-prompt-input');
const btnAiSubmit = document.getElementById('btn-ai-submit');
const quickChips = document.querySelectorAll('.chip-btn');

let aceEditor = null;
let pyodideInstance = null;
let pyodideLoading = false;
let lastTerminalOutput = '';
let chatHistory = [];

const aceModeMap = {
  python: 'ace/mode/python',
  javascript: 'ace/mode/javascript',
  typescript: 'ace/mode/typescript',
  cpp: 'ace/mode/c_cpp',
  c: 'ace/mode/c_cpp',
  java: 'ace/mode/java',
  go: 'ace/mode/golang',
  rust: 'ace/mode/rust',
  html: 'ace/mode/html',
  css: 'ace/mode/css',
  sql: 'ace/mode/sql'
};

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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Profile & Auth ──────────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      window.location.href = '/login';
      return;
    }
    currentUser = await res.json();

    userRealName.textContent = currentUser.name || currentUser.username;
    userId.textContent = `@${currentUser.username}`;
    userAvatar.textContent = (currentUser.name || currentUser.username).charAt(0).toUpperCase();

    if (currentUser.username === 'usmanianne30' || currentUser.isAdmin) {
      btnAdminToggle.hidden = false;
    }
    // Reveal 04 MEMBERS tab only for the president account
    if (currentUser.isPresident) {
      const membersTab = document.getElementById('tab-btn-members');
      if (membersTab) membersTab.hidden = false;
    }

    const writeDateEl = document.getElementById('write-current-date');
    if (writeDateEl) {
      const now = new Date();
      writeDateEl.textContent = now.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).toUpperCase();
    }

    // Initialize Ace Code Editor
    initAceEditor();

    // Load initial section and pre-existing works
    switchPrimaryTab('write');
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

const lastSavedContent = {};
const pendingSaves = {};
const retryTimers = {};

async function loadSectionContent(section) {
  if (loadedSections.has(section)) return;
  try {
    const res = await fetch(`/api/content?section=${section}`);
    if (!res.ok) return;
    const data = await res.json();
    const savedBody = data.body || '';

    if (section === 'write') {
      editorWrite.value = savedBody;
      lastSavedContent['write'] = savedBody;
    } else if (section === 'code') {
      const codeVal = savedBody || '# Write or paste code here\nprint("Write Code Action initialized.")\n';
      if (aceEditor) {
        aceEditor.setValue(codeVal, -1);
      }
      lastSavedContent['code'] = codeVal;
      if (data.language && codeLangSelect) {
        codeLangSelect.value = data.language;
        setAceMode(data.language);
      }
      updateContextDesc();
    } else if (section === 'action_theatre') {
      editorTheatre.value = savedBody;
      lastSavedContent['action_theatre'] = savedBody;
    } else if (section === 'action_anime') {
      editorAnime.value = savedBody;
      lastSavedContent['action_anime'] = savedBody;
    }

    loadedSections.add(section);
    updateWordCounters();
  } catch (err) {
    console.error(`Failed to load ${section}:`, err);
  }
}

async function saveContent(section, text, panelKey, language = 'plaintext', isRetry = false) {
  // Avoid redundant network requests if content has not changed
  if (lastSavedContent[section] === text && !isRetry && !pendingSaves[section]) {
    return;
  }

  clearTimeout(retryTimers[section]);
  setStatus(panelKey, 'saving', 'SAVING...');

  try {
    const res = await fetch('/api/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, body: text, language })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    lastSavedContent[section] = text;
    delete pendingSaves[section];
    setStatus(panelKey, 'saved', 'SAVED ✓');

    setTimeout(() => {
      if (saveStatus[panelKey]?.textContent === 'SAVED ✓') {
        setStatus(panelKey, '', '');
      }
    }, 2500);
  } catch (err) {
    console.warn(`Save failed for ${section}:`, err);
    setStatus(panelKey, 'error', 'SAVE FAILED');
    pendingSaves[section] = { text, panelKey, language };

    // Graceful automatic retry after 3.5s while preserving local editor state
    retryTimers[section] = setTimeout(() => {
      if (pendingSaves[section]) {
        saveContent(section, pendingSaves[section].text, panelKey, language, true);
      }
    }, 3500);
  }
}

function scheduleSave(section, text, panelKey, language) {
  // If text is unchanged from last saved version and no failure pending, skip
  if (lastSavedContent[section] === text && !pendingSaves[section]) {
    return;
  }
  clearTimeout(saveTimers[section]);
  clearTimeout(retryTimers[section]);
  saveTimers[section] = setTimeout(() => {
    saveContent(section, text, panelKey, language);
  }, 1000);
}

// ─── Pre-Existing Saved Works Management (Write, Code, Action) ───────────────

function timeAgo(dateString) {
  if (!dateString) return 'Just now';
  const now = new Date();
  const past = new Date(dateString);
  const diffSec = Math.floor((now - past) / 1000);
  if (diffSec < 30) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return past.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function fetchWorksForSection(section) {
  if (sidebarWorksList) sidebarWorksList.innerHTML = '<div class="db-sidebar-empty">Loading saved works…</div>';
  if (worksGrid) worksGrid.innerHTML = '<div class="db-sidebar-empty" style="grid-column: 1/-1;">Loading pre-existing works…</div>';

  try {
    const res = await fetch(`/api/works?section=${section}`);
    if (!res.ok) throw new Error('Could not load works');
    const data = await res.json();
    currentWorks = data.works || [];

    renderSidebarWorksList();
    renderGalleryGrid();
  } catch (err) {
    console.error('fetchWorksForSection error:', err);
    if (sidebarWorksList) sidebarWorksList.innerHTML = '<div class="db-sidebar-empty">No saved works yet</div>';
    if (worksGrid) worksGrid.innerHTML = '<div class="db-sidebar-empty" style="grid-column: 1/-1;">No pre-existing works saved yet. Click "+ Create New" to begin!</div>';
  }
}

function renderSidebarWorksList() {
  if (!sidebarWorksList) return;
  if (sidebarWorksCount) sidebarWorksCount.textContent = currentWorks.length;

  if (!currentWorks.length) {
    sidebarWorksList.innerHTML = '<div class="db-sidebar-empty">No saved works yet</div>';
    return;
  }

  sidebarWorksList.innerHTML = '';
  currentWorks.forEach(work => {
    const item = document.createElement('div');
    const isActive = activeWork && activeWork.id === work.id;
    item.className = `db-side-work-item ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <div class="db-side-work-info">
        <div class="db-side-work-title">${escapeHtml(work.title || 'Untitled')}</div>
        <div class="db-side-work-time">${timeAgo(work.updated_at)}</div>
      </div>
      <button class="db-side-delete-btn" title="Delete work">×</button>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.db-side-delete-btn')) return;
      openWorkInEditor(work);
    });

    item.querySelector('.db-side-delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWork(work.id, work.title);
    });

    sidebarWorksList.appendChild(item);
  });
}

function renderGalleryGrid() {
  if (!worksGrid) return;
  worksGrid.innerHTML = '';

  // 1. "+ Create New" card
  const createCard = document.createElement('div');
  createCard.className = 'db-work-card db-work-card--create';
  createCard.innerHTML = `
    <div class="db-create-icon">+</div>
    <div class="db-create-card-text">Create New ${SECTION_CONFIG[currentSection]?.label || 'Work'}</div>
  `;
  createCard.addEventListener('click', createNewWork);
  worksGrid.appendChild(createCard);

  // 2. Pre-existing works cards
  currentWorks.forEach(work => {
    const card = document.createElement('div');
    card.className = 'db-work-card';
    const preview = work.body ? work.body.slice(0, 140).trim() : 'Empty draft. Click to continue writing…';
    const badgeText = currentSection === 'code' ? (work.language || 'code') : (SECTION_CONFIG[currentSection]?.label || 'WORK');

    card.innerHTML = `
      <div>
        <div class="db-card-meta">
          <span class="db-card-badge">${badgeText}</span>
          <span class="db-card-time">${timeAgo(work.updated_at)}</span>
        </div>
        <h3 class="db-card-title">${escapeHtml(work.title || 'Untitled')}</h3>
        <p class="db-card-preview">${escapeHtml(preview)}</p>
      </div>
      <div class="db-card-footer">
        <button class="db-card-btn-open">Open &amp; Revisit ↗</button>
        <button class="db-card-btn-del" title="Delete work">🗑</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.db-card-btn-del')) return;
      openWorkInEditor(work);
    });

    card.querySelector('.db-card-btn-del')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteWork(work.id, work.title);
    });

    worksGrid.appendChild(card);
  });
}

async function createNewWork() {
  const conf = SECTION_CONFIG[currentSection] || SECTION_CONFIG.write;
  const newWorkData = {
    section: currentSection,
    title: conf.defaultTitle,
    body: conf.defaultBody,
    language: conf.defaultLang
  };

  try {
    const res = await fetch('/api/work/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newWorkData)
    });
    if (!res.ok) throw new Error('Failed to create work');
    const result = await res.json();
    const createdWork = result.work;

    currentWorks.unshift(createdWork);
    renderSidebarWorksList();
    renderGalleryGrid();

    openWorkInEditor(createdWork);
  } catch (err) {
    console.error('createNewWork error:', err);
    alert('Could not create new work. Please check your connection.');
  }
}

function showGalleryView() {
  activeWork = null;
  clearTimeout(worksSaveTimer);

  if (galleryView) {
    galleryView.hidden = false;
    galleryView.classList.add('active');
  }
  if (editorView) {
    editorView.hidden = true;
    editorView.classList.remove('active');
  }

  renderSidebarWorksList();
  renderGalleryGrid();
}

function openWorkInEditor(work) {
  activeWork = work;

  if (galleryView) {
    galleryView.hidden = true;
    galleryView.classList.remove('active');
  }
  if (editorView) {
    editorView.hidden = false;
    editorView.classList.add('active');
  }

  if (workTitleInput) workTitleInput.value = work.title || 'Untitled';
  if (workSaveStatus) {
    workSaveStatus.textContent = 'saved ✓';
    workSaveStatus.className = 'db-save-status saved';
  }

  // Activate the respective panel canvas
  primaryPanels.forEach(p => {
    const isTarget = p.id === `panel-${currentSection}`;
    p.classList.toggle('active', isTarget);
    p.hidden = !isTarget;
  });

  if (currentSection === 'write') {
    if (editorWrite) {
      editorWrite.value = work.body || '';
      updateWordCounters();
      setTimeout(() => editorWrite?.focus(), 60);
    }
  } else if (currentSection === 'code') {
    if (aceEditor) {
      aceEditor.setValue(work.body || '', -1);
      if (work.language && codeLangSelect) {
        codeLangSelect.value = work.language;
        setAceMode(work.language);
      }
      aceEditor.resize();
      setTimeout(() => aceEditor.focus(), 60);
    }
  } else if (currentSection === 'action') {
    if (activeActionSubTab === 'theatre') {
      if (editorTheatre) {
        editorTheatre.value = work.body || '';
        setTimeout(() => editorTheatre?.focus(), 60);
      }
    } else {
      if (editorAnime) {
        editorAnime.value = work.body || '';
        setTimeout(() => editorAnime?.focus(), 60);
      }
    }
    updateWordCounters();
  }

  renderSidebarWorksList();
}

async function saveActiveWork() {
  if (!activeWork) return;

  const title = (workTitleInput ? workTitleInput.value : activeWork.title || 'Untitled').trim();
  let body = '';
  let language = 'plaintext';

  if (currentSection === 'write') {
    body = editorWrite ? editorWrite.value : '';
  } else if (currentSection === 'code') {
    body = aceEditor ? aceEditor.getValue() : '';
    language = codeLangSelect?.value || 'python';
  } else if (currentSection === 'action') {
    body = activeActionSubTab === 'theatre' ? (editorTheatre ? editorTheatre.value : '') : (editorAnime ? editorAnime.value : '');
  }

  if (workSaveStatus) {
    workSaveStatus.textContent = 'saving…';
    workSaveStatus.className = 'db-save-status saving';
  }

  try {
    const res = await fetch('/api/work/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeWork.id,
        title,
        body,
        language
      })
    });
    if (!res.ok) throw new Error('Save failed');
    const result = await res.json();

    activeWork.title = title;
    activeWork.body = body;
    activeWork.language = language;
    activeWork.updated_at = result.updated_at || new Date().toISOString();

    const idx = currentWorks.findIndex(w => w.id === activeWork.id);
    if (idx !== -1) currentWorks[idx] = { ...activeWork };

    if (workSaveStatus) {
      workSaveStatus.textContent = 'saved ✓';
      workSaveStatus.className = 'db-save-status saved';
    }

    renderSidebarWorksList();
  } catch (err) {
    console.error('saveActiveWork error:', err);
    if (workSaveStatus) {
      workSaveStatus.textContent = 'error saving';
      workSaveStatus.className = 'db-save-status error';
    }
  }
}

function scheduleActiveWorkSave() {
  if (!activeWork) return;
  if (workSaveStatus) {
    workSaveStatus.textContent = 'saving…';
    workSaveStatus.className = 'db-save-status saving';
  }
  clearTimeout(worksSaveTimer);
  worksSaveTimer = setTimeout(saveActiveWork, 1000);
}

async function deleteWork(workId, title) {
  const confirmed = confirm(`Are you sure you want to delete "${title || 'this work'}"?`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/work/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: workId })
    });
    if (!res.ok) throw new Error('Failed to delete work');

    currentWorks = currentWorks.filter(w => w.id !== workId);

    if (activeWork && activeWork.id === workId) {
      showGalleryView();
    } else {
      renderSidebarWorksList();
      renderGalleryGrid();
    }
  } catch (err) {
    console.error('deleteWork error:', err);
    alert('Could not delete work. Please try again.');
  }
}

// u{2500}u{2500}u{2500} 04 MEMBERS: President-Only Roster u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}u{2500}

async function fetchAndRenderRoster() {
  if (!membersRosterList) return;
  membersRosterList.innerHTML = '<p class="db-sidebar-empty">Loading membersu{2026}</p>';
  try {
    const res = await fetch('/api/president/roster');
    if (!res.ok) throw new Error('Access denied');
    const data = await res.json();
    const roster = data.roster || [];
    if (membersCount) membersCount.textContent = roster.length;
    if (!roster.length) {
      membersRosterList.innerHTML = '<p class="db-members-empty">No members have joined yet.</p>';
      return;
    }
    membersRosterList.innerHTML = '';
    roster.forEach((member) => {
      const row = document.createElement('div');
      row.className = 'db-member-row';
      const initials = (member.name || 'M').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const joinedStr = member.joined_at
        ? new Date(member.joined_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : '';
      row.innerHTML = `r
        <div class="db-member-avatar">\</div>
        <div class="db-member-info">
          <div class="db-member-name">\</div>
          <div class="db-member-uid">@\</div>
        </div>
        <div class="db-member-joined">\</div>
      `;
      membersRosterList.appendChild(row);
    });
  } catch (err) {
    console.error('fetchAndRenderRoster error:', err);
    membersRosterList.innerHTML = '<p class="db-members-empty">Could not load member list.</p>';
  }
}

function showMembersView() {
  if (galleryView) { galleryView.hidden = true; galleryView.classList.remove('active'); }
  if (editorView)  { editorView.hidden  = true;  editorView.classList.remove('active'); }
  if (membersView) { membersView.hidden = false; }
  fetchAndRenderRoster();
}

// ─── Primary Sidebar Tab Navigation (Write, Code, Action) ────────────────────

function switchPrimaryTab(targetPanel) {
  // 04 MEMBERS is president-only: show roster view and return early
  if (targetPanel === 'members') {
    currentSection = 'members';
    primaryTabs.forEach(tab => {
      const isTarget = tab.dataset.panel === 'members';
      tab.classList.toggle('active', isTarget);
      tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });
    showMembersView();
    return;
  }

  // Hide members view if switching away
  if (membersView) membersView.hidden = true;

  currentSection = targetPanel;

  primaryTabs.forEach(tab => {
    const isTarget = tab.dataset.panel === targetPanel;
    tab.classList.toggle('active', isTarget);
    tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  const conf = SECTION_CONFIG[targetPanel];
  if (conf) {
    if (btnCreateLabel) btnCreateLabel.textContent = conf.createLabel;
    if (sidebarWorksHeading) sidebarWorksHeading.textContent = conf.worksTitle;
    if (galleryEyebrow) galleryEyebrow.textContent = conf.number + ' / ' + conf.label;
    if (galleryTitle) galleryTitle.textContent = conf.title;
    if (galleryDesc) galleryDesc.textContent = conf.desc;
    if (galleryCreateLabel) galleryCreateLabel.textContent = '+ ' + conf.createLabel;
  }

  showGalleryView();
  fetchWorksForSection(targetPanel);
}

primaryTabs.forEach(tab => {
  tab.addEventListener('click', () => switchPrimaryTab(tab.dataset.panel));
});

// Sidebar & Gallery Create Buttons
btnSidebarCreate?.addEventListener('click', createNewWork);
btnGalleryCreate?.addEventListener('click', createNewWork);

// Editor toolbar buttons
btnBackToGallery?.addEventListener('click', () => {
  saveActiveWork();
  showGalleryView();
});

btnDeleteWork?.addEventListener('click', () => {
  if (activeWork) deleteWork(activeWork.id, activeWork.title);
});

workTitleInput?.addEventListener('input', scheduleActiveWorkSave);

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
    setTimeout(() => editorTheatre?.focus(), 50);
  } else {
    loadSectionContent('action_anime');
    setTimeout(() => editorAnime?.focus(), 50);
  }
}

subBtnTheatre.addEventListener('click', () => switchActionSubView('theatre'));
subBtnAnime.addEventListener('click', () => switchActionSubView('anime'));

// ─── Editor Input Listeners (Write & Action) ─────────────────────────────────

editorWrite.addEventListener('input', () => {
  updateWordCounters();
  scheduleSave('write', editorWrite.value, 'write');
  scheduleActiveWorkSave();
});

editorTheatre.addEventListener('input', () => {
  updateWordCounters();
  scheduleSave('action_theatre', editorTheatre.value, 'action');
  scheduleActiveWorkSave();
});

editorAnime.addEventListener('input', () => {
  updateWordCounters();
  scheduleSave('action_anime', editorAnime.value, 'action');
  scheduleActiveWorkSave();
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

    const prefix = (start > 0 && val[start - 1] !== '\n') ? '\n\n' : '';
    const insertion = prefix + textToInsert;

    editorTheatre.value = val.slice(0, start) + insertion + val.slice(end);
    const newPos = start + insertion.length;
    editorTheatre.selectionStart = editorTheatre.selectionEnd = newPos;

    updateWordCounters();
    scheduleSave('action_theatre', editorTheatre.value, 'action');
    scheduleActiveWorkSave();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ─── SECTION 1 & 2: CODE WORKSPACE & AI CODING ASSISTANT ──────────────────────
// ═════════════════════════════════════════════════════════════════════════════

function setAceMode(lang) {
  if (!aceEditor) return;
  const mode = aceModeMap[lang] || 'ace/mode/text';
  aceEditor.session.setMode(mode);
  if (contextLangPill) contextLangPill.textContent = lang.toUpperCase();
}

function updateContextDesc() {
  if (!aceEditor || !contextDesc) return;
  const lines = aceEditor.session.getLength();
  contextDesc.textContent = `${lines} line${lines === 1 ? '' : 's'} in editor · Synced`;
}

function initAceEditor() {
  const box = document.getElementById('ace-editor-box');
  if (!box || typeof ace === 'undefined') return;

  aceEditor = ace.edit('ace-editor-box');
  aceEditor.setTheme('ace/theme/tomorrow_night');
  setAceMode(codeLangSelect?.value || 'python');

  aceEditor.setOptions({
    fontSize: '13.5px',
    fontFamily: "'DM Mono', monospace",
    tabSize: 4,
    useSoftTabs: true,
    showPrintMargin: false,
    showGutter: true,
    highlightActiveLine: true,
    wrap: true
  });

  aceEditor.session.on('change', () => {
    updateContextDesc();
    scheduleSave('code', aceEditor.getValue(), 'code', codeLangSelect?.value || 'python');
    scheduleActiveWorkSave();
  });
}

codeLangSelect?.addEventListener('change', () => {
  const lang = codeLangSelect.value;
  setAceMode(lang);
  if (aceEditor) {
    scheduleSave('code', aceEditor.getValue(), 'code', lang);
  }
});

btnClearCode?.addEventListener('click', () => {
  if (!aceEditor) return;
  aceEditor.setValue('', -1);
  aceEditor.focus();
});

// ─── Terminal Output Helper ──────────────────────────────────────────────────

function setTerminalStatus(state, text) {
  if (!terminalStatusBadge) return;
  terminalStatusBadge.className = `terminal-badge ${state}`;
  terminalStatusBadge.textContent = text;
}

function printTerminal(msg, isError = false) {
  if (!terminalOutputText) return;
  terminalOutputText.textContent = msg;
  terminalOutputText.classList.toggle('has-error', isError);
  lastTerminalOutput = msg;
  if (btnFixWithAI) {
    btnFixWithAI.hidden = !isError;
  }
}

btnClearTerminal?.addEventListener('click', () => {
  printTerminal('$ Ready. Choose your language and click "Run Code" to execute.');
  setTerminalStatus('ready', 'Ready');
});

// ─── Execution Dispatcher ────────────────────────────────────────────────────

btnRunCode?.addEventListener('click', async () => {
  if (!aceEditor) return;
  const code = aceEditor.getValue().trim();
  const lang = (codeLangSelect?.value || 'python').toLowerCase();

  if (!code) {
    printTerminal('$ Error: Editor is empty. Write some code first!', true);
    setTerminalStatus('error', 'Empty');
    return;
  }

  btnRunCode.disabled = true;

  try {
    if (lang === 'javascript' || lang === 'typescript') {
      runJavaScript(code);
    } else if (lang === 'python') {
      await runPython(code);
    } else {
      await runRemoteSandbox(lang, code);
    }
  } finally {
    btnRunCode.disabled = false;
  }
});

// 1. JavaScript Sandboxed Web Worker Runner
function runJavaScript(code) {
  setTerminalStatus('running', 'Running JS…');
  printTerminal('$ node script.js\nExecuting in sandboxed worker…');

  const workerScript = `
    const logs = [];
    console.log = (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
    console.error = (...args) => logs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
    console.warn = (...args) => logs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
    try {
      const result = eval(${JSON.stringify(code)});
      if (result !== undefined && logs.length === 0) logs.push(String(result));
      postMessage({ ok: true, output: logs.join('\\n') });
    } catch (err) {
      postMessage({ ok: false, error: err.stack || err.message });
    }
  `;

  const blob = new Blob([workerScript], { type: 'application/javascript' });
  const worker = new Worker(URL.createObjectURL(blob));
  const startTime = performance.now();

  const timeoutHandle = setTimeout(() => {
    worker.terminate();
    setTerminalStatus('error', 'Timeout');
    printTerminal(`$ node script.js\nError: Execution timed out after 5.0s (Infinite loop detected).`, true);
  }, 5000);

  worker.onmessage = e => {
    clearTimeout(timeoutHandle);
    worker.terminate();
    const elapsed = Math.round(performance.now() - startTime);

    if (e.data.ok) {
      setTerminalStatus('success', 'Exit 0');
      printTerminal(`$ node script.js\n${e.data.output || '(Execution completed with no output)'}\n\n[Done in ${elapsed}ms]`);
    } else {
      setTerminalStatus('error', 'Error');
      printTerminal(`$ node script.js\n${e.data.error}\n\n[Failed in ${elapsed}ms]`, true);
    }
  };
}

// 2. Python Client-Side WebAssembly (Pyodide) Runner
async function runPython(code) {
  setTerminalStatus('running', 'Python WASM…');
  printTerminal('$ python main.py\nInitializing Python 3.11 environment (Pyodide WebAssembly)…');

  try {
    if (!pyodideInstance) {
      if (typeof loadPyodide === 'undefined') {
        throw new Error('Pyodide WebAssembly library is still loading. Please try again in a moment.');
      }
      pyodideInstance = await loadPyodide();
    }

    const startTime = performance.now();
    pyodideInstance.runPython(`
import sys
import io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
`);

    let errorOccurred = false;
    let errorMsg = '';
    try {
      pyodideInstance.runPython(code);
    } catch (pyErr) {
      errorOccurred = true;
      errorMsg = pyErr.message;
    }

    const stdout = pyodideInstance.runPython('sys.stdout.getvalue()');
    const stderr = pyodideInstance.runPython('sys.stderr.getvalue()');
    const elapsed = Math.round(performance.now() - startTime);

    if (!errorOccurred && !stderr) {
      setTerminalStatus('success', 'Exit 0');
      printTerminal(`$ python main.py\n${stdout || '(Execution completed with no output)'}\n\n[Done in ${elapsed}ms]`);
    } else {
      setTerminalStatus('error', 'Error');
      const combined = (stdout ? stdout + '\n' : '') + (stderr ? stderr + '\n' : '') + (errorMsg || '');
      printTerminal(`$ python main.py\n${combined.trim()}\n\n[Failed in ${elapsed}ms]`, true);
    }
  } catch (err) {
    setTerminalStatus('error', 'Error');
    printTerminal(`$ python main.py\nRuntime Error: ${err.message}`, true);
  }
}

// 3. Sandboxed Multi-Language Remote Runner (Piston API proxy)
async function runRemoteSandbox(lang, code) {
  setTerminalStatus('running', 'Sandbox…');
  printTerminal(`$ ${lang} script\nSending to isolated sandbox container…`);

  try {
    const startTime = performance.now();
    const res = await fetch('/api/code/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, code })
    });
    const data = await res.json();
    const elapsed = Math.round(performance.now() - startTime);

    if (data.error) throw new Error(data.error);

    const isErr = Boolean(data.stderr) || (data.exitCode !== 0);
    setTerminalStatus(isErr ? 'error' : 'success', isErr ? `Exit ${data.exitCode}` : 'Exit 0');

    let output = '';
    if (data.stdout) output += data.stdout;
    if (data.stderr) output += (output ? '\n' : '') + data.stderr;
    if (!output) output = '(Execution completed with no output)';

    printTerminal(`$ ${lang} script\n${output.trim()}\n\n[${isErr ? 'Failed' : 'Done'} in ${elapsed}ms]`, isErr);
  } catch (err) {
    setTerminalStatus('error', 'Error');
    printTerminal(`$ ${lang} script\nSandbox Error: ${err.message}`, true);
  }
}

// ─── AI Coding Chatbot Logic ─────────────────────────────────────────────────

function appendChatMessage(role, text) {
  if (!aiChatThread) return null;

  const msgEl = document.createElement('div');
  msgEl.className = `ai-message ai-message--${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'user' ? 'YOU' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';

  if (role === 'user') {
    bubble.textContent = text;
  } else {
    // Parse markdown
    const rawHtml = typeof marked !== 'undefined' ? marked.parse(text) : `<p>${escapeHtml(text)}</p>`;
    bubble.innerHTML = rawHtml;
    enhanceCodeBlocks(bubble);
  }

  msgEl.appendChild(avatar);
  msgEl.appendChild(bubble);
  aiChatThread.appendChild(msgEl);
  aiChatThread.scrollTop = aiChatThread.scrollHeight;

  return bubble;
}

// Structured editor action: updates editor state cleanly through Ace API
function applyCodeToEditor(codeText, detectedLang) {
  if (!aceEditor) return;
  aceEditor.setValue(codeText, 1);
  if (detectedLang && aceModeMap[detectedLang] && codeLangSelect) {
    codeLangSelect.value = detectedLang;
    setAceMode(detectedLang);
  }
  updateContextDesc();
  scheduleSave('code', codeText, 'code', codeLangSelect ? codeLangSelect.value : 'plaintext');
}

// Enhances code blocks in AI messages with "Insert into Editor" and "Copy" buttons
function enhanceCodeBlocks(container) {
  const preElements = container.querySelectorAll('pre');

  preElements.forEach(pre => {
    const codeEl = pre.querySelector('code');
    const codeText = (codeEl ? codeEl.textContent : pre.textContent).trim();

    // Determine language from class e.g. class="language-python"
    let detectedLang = codeLangSelect?.value || 'python';
    if (codeEl) {
      const match = codeEl.className.match(/language-([a-zA-Z0-9_+#]+)/);
      if (match) {
        detectedLang = match[1].toLowerCase();
        if (detectedLang === 'py') detectedLang = 'python';
        if (detectedLang === 'js') detectedLang = 'javascript';
        if (detectedLang === 'ts') detectedLang = 'typescript';
      }
    }

    const card = document.createElement('div');
    card.className = 'chat-code-card';

    const header = document.createElement('div');
    header.className = 'chat-code-header';

    const langLabel = document.createElement('span');
    langLabel.className = 'chat-code-lang';
    langLabel.textContent = detectedLang.toUpperCase();

    const btnsGroup = document.createElement('div');
    btnsGroup.className = 'chat-code-btns';

    const btnInsert = document.createElement('button');
    btnInsert.type = 'button';
    btnInsert.className = 'btn-insert-editor';
    btnInsert.innerHTML = 'Insert into Editor ↗';

    btnInsert.addEventListener('click', () => {
      applyCodeToEditor(codeText, detectedLang);
      btnInsert.textContent = 'Inserted ✓';
      setTimeout(() => btnInsert.textContent = 'Insert into Editor ↗', 2000);
    });

    const btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.className = 'btn-copy-code';
    btnCopy.textContent = 'Copy';

    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(codeText);
      btnCopy.textContent = 'Copied ✓';
      setTimeout(() => btnCopy.textContent = 'Copy', 2000);
    });

    btnsGroup.appendChild(btnInsert);
    btnsGroup.appendChild(btnCopy);
    header.appendChild(langLabel);
    header.appendChild(btnsGroup);

    const newPre = document.createElement('pre');
    newPre.className = 'chat-code-pre';
    newPre.textContent = codeText;

    card.appendChild(header);
    card.appendChild(newPre);

    pre.replaceWith(card);
  });
}

async function sendToAI(userPrompt) {
  const prompt = (userPrompt || aiPromptInput?.value || '').trim();
  if (!prompt) return;

  if (aiPromptInput) aiPromptInput.value = '';
  if (btnAiSubmit) btnAiSubmit.disabled = true;

  appendChatMessage('user', prompt);

  // Add assistant placeholder
  const placeholderBubble = appendChatMessage('assistant', 'Thinking…');

  const currentCode = aceEditor ? aceEditor.getValue() : '';
  const currentLang = codeLangSelect ? codeLangSelect.value : 'python';

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        code: currentCode,
        language: currentLang,
        output: lastTerminalOutput,
        messages: chatHistory
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI service error');

    if (aiModelTag && data.model) {
      aiModelTag.textContent = data.model.includes('gemini') ? 'Gemini Flash' : 'Built-in AI';
    }

    // Save to conversation memory
    chatHistory.push({ role: 'user', content: prompt });
    chatHistory.push({ role: 'model', content: data.reply });
    if (chatHistory.length > 12) chatHistory = chatHistory.slice(-12);

    // Render response
    const rawHtml = typeof marked !== 'undefined' ? marked.parse(data.reply) : `<p>${escapeHtml(data.reply)}</p>`;
    placeholderBubble.innerHTML = rawHtml;
    enhanceCodeBlocks(placeholderBubble);
  } catch (err) {
    placeholderBubble.innerHTML = `<p style="color:#ff8880;">Could not get AI response: ${escapeHtml(err.message)}</p>`;
  } finally {
    if (btnAiSubmit) btnAiSubmit.disabled = false;
    if (aiChatThread) aiChatThread.scrollTop = aiChatThread.scrollHeight;
  }
}

aiChatForm?.addEventListener('submit', e => {
  e.preventDefault();
  sendToAI();
});

// Shift+Enter for new line, Enter to send
aiPromptInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToAI();
  }
});

// Quick Action Chips
quickChips.forEach(chip => {
  chip.addEventListener('click', () => {
    sendToAI(chip.dataset.prompt);
  });
});

// Terminal "⚡ Fix with AI" Button
btnFixWithAI?.addEventListener('click', () => {
  const fixPrompt = `Please fix the error in my code. Here is the terminal output:\n\n${lastTerminalOutput}\n\nPlease identify the root cause and provide the corrected code.`;
  sendToAI(fixPrompt);
});

// Clear Chat Thread
btnClearChat?.addEventListener('click', () => {
  chatHistory = [];
  if (aiChatThread) {
    aiChatThread.innerHTML = `
      <div class="ai-message ai-message--assistant">
        <div class="msg-avatar">AI</div>
        <div class="msg-bubble">
          <p>Conversation cleared. Ready for your next coding prompt!</p>
        </div>
      </div>
    `;
  }
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

// ─── Inspect Modal ───────────────────────────────────────────────────────────

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

// Clicking anywhere on the Write paper sheet focuses the textarea
const paperSheet = document.querySelector('.paper-sheet');
if (paperSheet && editorWrite) {
  paperSheet.addEventListener('click', (e) => {
    if (e.target !== editorWrite && !e.target.closest('button')) {
      editorWrite.focus();
    }
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────

checkAuth();
