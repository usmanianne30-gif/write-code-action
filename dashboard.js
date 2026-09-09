/**
 * dashboard.js — WCA member workspace
 * Zero dependencies. Handles:
 *  - Greeting (/api/me)
 *  - Tab switching with lazy content loading
 *  - Auto-save with 1.5 s debounce (/api/content POST)
 *  - Line-number sync for the Code panel
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────────────

const loaded = new Set();   // which sections have been fetched already
let saveTimers = {};        // debounce handles keyed by section name

// ─── DOM refs ────────────────────────────────────────────────────────────────

const greeting    = document.getElementById('db-greeting');
const tabs        = document.querySelectorAll('.db-tab');
const panels      = document.querySelectorAll('.db-panel');
const editors     = {
  write:  document.getElementById('editor-write'),
  code:   document.getElementById('editor-code'),
  action: document.getElementById('editor-action'),
};
const saveStatus  = {
  write:  document.getElementById('save-write'),
  code:   document.getElementById('save-code'),
  action: document.getElementById('save-action'),
};
const langSelect  = document.getElementById('lang-select');
const lineNumbers = document.getElementById('line-numbers');

// ─── Utility ─────────────────────────────────────────────────────────────────

function setStatus(section, state, text) {
  const el = saveStatus[section];
  if (!el) return;
  el.textContent = text;
  el.className = `db-save-status ${state}`;
}

// ─── /api/me — identify the current user ─────────────────────────────────────

async function loadMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return; // not signed in; page still works, just no greeting
    const { username } = await res.json();
    greeting.textContent = `Hello, ${username}.`;
  } catch (_) { /* silent */ }
}

// ─── Content load / save ─────────────────────────────────────────────────────

async function loadSection(section) {
  if (loaded.has(section)) return;
  try {
    const res = await fetch(`/api/content?section=${section}`);
    if (!res.ok) return;
    const { body, language } = await res.json();
    editors[section].value = body;
    if (section === 'code' && language) {
      langSelect.value = language;
    }
    loaded.add(section);
    if (section === 'code') syncLineNumbers();
  } catch (_) { /* silent */ }
}

async function saveSection(section) {
  const body     = editors[section].value;
  const language = section === 'code' ? langSelect.value : 'plaintext';
  setStatus(section, 'saving', 'saving…');
  try {
    const res = await fetch('/api/content', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ section, body, language }),
    });
    if (!res.ok) throw new Error();
    setStatus(section, 'saved', 'saved ✓');
    // Clear the "saved" label after 2 s
    setTimeout(() => {
      if (saveStatus[section].textContent === 'saved ✓') {
        saveStatus[section].textContent = '';
        saveStatus[section].className = 'db-save-status';
      }
    }, 2000);
  } catch (_) {
    setStatus(section, 'error', 'error saving');
  }
}

function scheduleSave(section) {
  clearTimeout(saveTimers[section]);
  saveTimers[section] = setTimeout(() => saveSection(section), 1500);
}

// ─── Code panel — line numbers ────────────────────────────────────────────────

function syncLineNumbers() {
  const lines = editors.code.value.split('\n').length;
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  // Sync scroll
  lineNumbers.scrollTop = editors.code.scrollTop;
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function activatePanel(targetSection) {
  tabs.forEach(tab => {
    const isTarget = tab.dataset.panel === targetSection;
    tab.classList.toggle('active', isTarget);
    tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  panels.forEach(panel => {
    const isTarget = panel.id === `panel-${targetSection}`;
    panel.classList.toggle('active', isTarget);
    panel.hidden = !isTarget;
  });

  loadSection(targetSection);
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

tabs.forEach(tab => {
  tab.addEventListener('click', () => activatePanel(tab.dataset.panel));
});

// Typing → debounced save
Object.entries(editors).forEach(([section, editor]) => {
  editor.addEventListener('input', () => {
    scheduleSave(section);
    if (section === 'code') syncLineNumbers();
  });

  // Sync line number scroll on scroll in code editor
  if (section === 'code') {
    editor.addEventListener('scroll', () => {
      lineNumbers.scrollTop = editor.scrollTop;
    });
  }

  // Tab key in code editor inserts 2 spaces instead of focusing next element
  if (section === 'code') {
    editor.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const start = editor.selectionStart;
      const end   = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      syncLineNumbers();
    });
  }
});

// Language change → save immediately
langSelect.addEventListener('change', () => {
  clearTimeout(saveTimers.code);
  saveSection('code');
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadMe();
loadSection('write');   // pre-load the active panel immediately
