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
    setTimeout(() => editorWrite?.focus(), 50);
  } else if (targetPanel === 'code') {
    loadSectionContent('code');
    setTimeout(() => {
      if (aceEditor) {
        aceEditor.resize();
        aceEditor.focus();
      }
    }, 50);
  } else if (targetPanel === 'action') {
    loadSectionContent(activeActionSubTab === 'theatre' ? 'action_theatre' : 'action_anime');
    setTimeout(() => {
      if (activeActionSubTab === 'theatre') editorTheatre?.focus();
      else editorAnime?.focus();
    }, 50);
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

    const prefix = (start > 0 && val[start - 1] !== '\n') ? '\n\n' : '';
    const insertion = prefix + textToInsert;

    editorTheatre.value = val.slice(0, start) + insertion + val.slice(end);
    const newPos = start + insertion.length;
    editorTheatre.selectionStart = editorTheatre.selectionEnd = newPos;

    updateWordCounters();
    scheduleSave('action_theatre', editorTheatre.value, 'action');
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
