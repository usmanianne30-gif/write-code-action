/**
 * WCA's dependency-free server.
 * Operates statelessly with Supabase in production (e.g. Render)
 * and falls back to local data/ JSON files in development.
 *
 * Handles:
 *  - Member registration with Real Name, unique username/ID, and password.
 *  - Authentication & session cookie (wca_user).
 *  - Dedicated workspace with Write (aged paper), Code (blank), Action (Theatre Script + Anime Notebook).
 *  - Private user content: each member's writing is visible only to them, except for usmanianne30 (admin).
 *  - Admin console for usmanianne30: member directory, daily activity log, and member content inspection.
 */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIRECTORY = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIRECTORY, 'users.json');
const CONTENT_FILE = path.join(DATA_DIRECTORY, 'content.json');
const ACTIVITY_FILE = path.join(DATA_DIRECTORY, 'activity.json');
const PORT = Number(process.env.PORT || 4173);
const PASSWORD_UNIQUENESS_KEY = process.env.PASSWORD_UNIQUENESS_KEY || 'wca-local-secret-key-2026';
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_USERNAME = 'usmanianne30';
const ADMIN_PASSWORD = '301327';

// ─── Supabase Client ────────────────────────────────────────────────────────

function usingSupabase() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabase(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map(part => {
      const [k, ...v] = part.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    }).filter(([k]) => k)
  );
}

function cookieUser(request) {
  const cookies = parseCookies(request.headers.cookie || '');
  const u = cookies['wca_user'];
  return typeof u === 'string' && /^[a-z0-9_-]{3,24}$/.test(u) ? u : null;
}

function makeUserCookie(username) {
  return `wca_user=${encodeURIComponent(username)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`;
}

function clearUserCookie() {
  return `wca_user=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function passwordFingerprint(password) {
  return crypto.createHmac('sha256', PASSWORD_UNIQUENESS_KEY)
    .update(password).digest('hex');
}

// ─── Data Access: Users ──────────────────────────────────────────────────────

async function readUsers() {
  if (usingSupabase()) {
    try {
      const res = await supabase('wca_members?select=*&order=joined_at.desc');
      if (res.response.ok && Array.isArray(res.body)) {
        return res.body;
      }
    } catch (err) {
      console.warn('Supabase readUsers error, falling back to local:', err.message);
    }
  }
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveUser(user) {
  if (usingSupabase()) {
    try {
      const res = await supabase('wca_members', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(user)
      });
      if (res.response.ok) return;
    } catch (err) {
      console.warn('Supabase saveUser error, falling back to local:', err.message);
    }
  }
  // Local fallback
  const users = await readUsers();
  const idx = users.findIndex(u => u.username === user.username);
  if (idx >= 0) users[idx] = user;
  else users.push(user);
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  const temporaryFile = `${USERS_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(users, null, 2), 'utf8');
  await fs.rename(temporaryFile, USERS_FILE);
}

// Ensure the preset admin user exists
async function ensureAdminUser() {
  try {
    const users = await readUsers();
    let admin = users.find(u => u.username === ADMIN_USERNAME);
    if (!admin) {
      const salt = crypto.randomBytes(16).toString('hex');
      admin = {
        name: 'Usman (Director)',
        username: ADMIN_USERNAME,
        password_hash: passwordHash(ADMIN_PASSWORD, salt),
        salt,
        password_fingerprint: passwordFingerprint(ADMIN_PASSWORD),
        joined_at: new Date().toISOString(),
        last_active_at: new Date().toISOString()
      };
      await saveUser(admin);
    }
  } catch (err) {
    console.error('Failed to initialize admin user:', err);
  }
}

// ─── Data Access: Content ────────────────────────────────────────────────────

const VALID_SECTIONS = new Set(['write', 'code', 'action_theatre', 'action_anime', 'action']);

async function getContent(targetUsername, section) {
  if (usingSupabase()) {
    try {
      const res = await supabase(`wca_content?username=eq.${encodeURIComponent(targetUsername)}&section=eq.${encodeURIComponent(section)}&select=body,language,updated_at`);
      if (res.response.ok && res.body?.length) {
        return res.body[0];
      }
    } catch (err) {
      console.warn('Supabase getContent error, falling back to local:', err.message);
    }
  }
  try {
    const raw = await fs.readFile(CONTENT_FILE, 'utf8');
    const data = JSON.parse(raw);
    return data[targetUsername]?.[section] || { body: '', language: 'plaintext' };
  } catch (error) {
    return { body: '', language: 'plaintext' };
  }
}

async function upsertContent(username, section, body, language = 'plaintext') {
  const payload = {
    username,
    section,
    body,
    language,
    updated_at: new Date().toISOString()
  };

  if (usingSupabase()) {
    try {
      const res = await supabase('wca_content', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload)
      });
      if (res.response.ok) return;
    } catch (err) {
      console.warn('Supabase upsertContent error, falling back to local:', err.message);
    }
  }

  // Local fallback
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8'));
  } catch (_) {}
  if (!data[username]) data[username] = {};
  data[username][section] = payload;
  const tmp = `${CONTENT_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, CONTENT_FILE);
}

// ─── Data Access: Activity Logs ──────────────────────────────────────────────

async function readActivities() {
  if (usingSupabase()) {
    try {
      const res = await supabase('wca_activities?select=*&order=timestamp.desc&limit=200');
      if (res.response.ok && Array.isArray(res.body)) {
        return res.body;
      }
    } catch (err) {
      console.warn('Supabase readActivities error, falling back to local:', err.message);
    }
  }
  try {
    const raw = await fs.readFile(ACTIVITY_FILE, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function logActivity(username, name, action, details = '') {
  const event = {
    username,
    name: name || username,
    action,
    details,
    timestamp: new Date().toISOString()
  };

  if (usingSupabase()) {
    try {
      const res = await supabase('wca_activities', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(event)
      });
      if (res.response.ok) return;
    } catch (err) {
      console.warn('Supabase logActivity error, falling back to local:', err.message);
    }
  }

  try {
    await fs.mkdir(DATA_DIRECTORY, { recursive: true });
    const activities = await readActivities();
    event.id = crypto.randomUUID();
    activities.unshift(event);
    if (activities.length > 500) activities.length = 500;
    const tmp = `${ACTIVITY_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(activities, null, 2), 'utf8');
    await fs.rename(tmp, ACTIVITY_FILE);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/** Register new member with real name, username, password */
async function handleSignUp(request, response) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) return json(response, 413, { error: 'Request is too large.' });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'Please send valid sign-up details.' }); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || name.length < 2 || name.length > 80) {
    return json(response, 400, { error: 'Please enter your real name (2–80 characters).' });
  }
  if (!/^[a-z0-9_-]{3,24}$/.test(username)) {
    return json(response, 400, { error: 'Use 3–24 letters, numbers, hyphens, or underscores for your unique ID.' });
  }
  if (password.length < 6 || password.length > 128) {
    return json(response, 400, { error: 'Choose a password between 6 and 128 characters.' });
  }

  const users = await readUsers();
  const fingerprint = passwordFingerprint(password);

  // Check unique username
  if (users.some(u => u.username === username)) {
    return json(response, 409, { error: 'That unique ID is already claimed. Please choose another.' });
  }

  // Check unique password (except admin)
  if (users.some(u => (u.password_fingerprint || u.passwordFingerprint) === fingerprint && u.username !== ADMIN_USERNAME)) {
    return json(response, 409, { error: 'Choose a password that belongs only to you.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const newUser = {
    name,
    username,
    password_hash: passwordHash(password, salt),
    salt,
    password_fingerprint: fingerprint,
    joined_at: now,
    last_active_at: now
  };

  await saveUser(newUser);
  await logActivity(username, name, 'Joined Write Code Action', 'New cast member registered');

  return json(response, 201, {
    ok: true,
    message: `Welcome to the cast, ${name}.`,
    username,
    name
  }, {
    'Set-Cookie': makeUserCookie(username)
  });
}

/** Login existing member */
async function handleLogin(request, response) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) return json(response, 413, { error: 'Request is too large.' });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'Please send valid login details.' }); }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) {
    return json(response, 400, { error: 'Please enter your unique ID and password.' });
  }

  const users = await readUsers();
  let user = users.find(u => u.username === username);

  // Special check for preset admin if not found
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    if (!user) {
      await ensureAdminUser();
      const updated = await readUsers();
      user = updated.find(u => u.username === ADMIN_USERNAME);
    }
  }

  if (!user) {
    return json(response, 401, { error: 'Invalid unique ID or password.' });
  }

  // Verify password: check preset admin or scrypt hash
  let isPasswordValid = false;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    isPasswordValid = true;
  } else if (user.salt && user.password_hash) {
    const computed = passwordHash(password, user.salt);
    isPasswordValid = (computed === user.password_hash);
  }

  if (!isPasswordValid) {
    return json(response, 401, { error: 'Invalid unique ID or password.' });
  }

  // Update last active
  user.last_active_at = new Date().toISOString();
  await saveUser(user);

  await logActivity(user.username, user.name || user.username, 'Signed in', 'Accessed workspace');

  return json(response, 200, {
    ok: true,
    username: user.username,
    name: user.name || user.username,
    isAdmin: user.username === ADMIN_USERNAME
  }, {
    'Set-Cookie': makeUserCookie(user.username)
  });
}

/** Logout */
async function handleLogout(request, response) {
  const username = cookieUser(request);
  if (username) {
    await logActivity(username, username, 'Signed out', 'Session closed');
  }
  return json(response, 200, { ok: true }, {
    'Set-Cookie': clearUserCookie()
  });
}

/** Get session profile */
async function handleGetMe(request, response) {
  const username = cookieUser(request);
  if (!username) return json(response, 401, { error: 'Not signed in.' });

  const users = await readUsers();
  const user = users.find(u => u.username === username);

  return json(response, 200, {
    username,
    name: user?.name || username,
    isAdmin: username === ADMIN_USERNAME,
    joined_at: user?.joined_at || null
  });
}

/** Get writing content - protected: user can only see their own, except usmanianne30 */
async function handleGetContent(request, response) {
  const currentUsername = cookieUser(request);
  if (!currentUsername) return json(response, 401, { error: 'Not signed in.' });

  const url = new URL(request.url, `http://${request.headers.host}`);
  const section = url.searchParams.get('section');
  const targetUserParam = url.searchParams.get('user');

  if (!VALID_SECTIONS.has(section)) {
    return json(response, 400, { error: 'Invalid section.' });
  }

  let targetUsername = currentUsername;
  if (targetUserParam && targetUserParam !== currentUsername) {
    // Only usmanianne30 is permitted to view other members' content
    if (currentUsername !== ADMIN_USERNAME) {
      return json(response, 403, { error: 'Access denied. You can only view your own writing.' });
    }
    targetUsername = targetUserParam.toLowerCase();
  }

  try {
    const data = await getContent(targetUsername, section);
    return json(response, 200, { ...data, targetUser: targetUsername });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Could not load content.' });
  }
}

/** Save writing content - only the owner can save their own writing */
async function handlePostContent(request, response) {
  const username = cookieUser(request);
  if (!username) return json(response, 401, { error: 'Not signed in.' });

  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) return json(response, 413, { error: 'Content is too large.' });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'Invalid JSON.' }); }

  const { section, body: text = '', language = 'plaintext' } = body;
  if (!VALID_SECTIONS.has(section)) return json(response, 400, { error: 'Invalid section.' });
  if (typeof text !== 'string') return json(response, 400, { error: 'Body must be a string.' });

  try {
    await upsertContent(username, section, text, language);

    // Update user's last_active_at
    const users = await readUsers();
    const user = users.find(u => u.username === username);
    if (user) {
      user.last_active_at = new Date().toISOString();
      await saveUser(user);
    }

    // Friendly section name for activity log
    const sectionNames = {
      write: 'Write Draft (Old Paper)',
      action_theatre: 'Theatre Script',
      action_anime: 'Anime Composition Notebook',
      code: 'Code Workspace'
    };
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    await logActivity(
      username,
      user?.name || username,
      `Saved ${sectionNames[section] || section}`,
      `${wordCount} words`
    );

    return json(response, 200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Could not save content.' });
  }
}

/** Admin overview - exclusive to usmanianne30 */
async function handleAdminOverview(request, response) {
  const username = cookieUser(request);
  if (username !== ADMIN_USERNAME) {
    return json(response, 403, { error: 'Access denied. Director access only.' });
  }

  const users = await readUsers();
  const activities = await readActivities();

  // Load content summary per user
  const members = await Promise.all(users.map(async u => {
    let writeWords = 0;
    let theatreWords = 0;
    let animeWords = 0;
    try {
      const w = await getContent(u.username, 'write');
      const t = await getContent(u.username, 'action_theatre');
      const a = await getContent(u.username, 'action_anime');
      writeWords = (w.body || '').trim().split(/\s+/).filter(Boolean).length;
      theatreWords = (t.body || '').trim().split(/\s+/).filter(Boolean).length;
      animeWords = (a.body || '').trim().split(/\s+/).filter(Boolean).length;
    } catch (_) {}

    return {
      name: u.name || 'Unnamed Member',
      username: u.username,
      role: u.username === ADMIN_USERNAME ? 'director' : 'member',
      joined_at: u.joined_at || null,
      last_active_at: u.last_active_at || u.joined_at || null,
      stats: {
        writeWords,
        theatreWords,
        animeWords,
        totalWords: writeWords + theatreWords + animeWords
      }
    };
  }));

  return json(response, 200, {
    admin: ADMIN_USERNAME,
    totalMembers: members.length,
    members,
    activities
  });
}

// ─── Static Server & Router ──────────────────────────────────────────────────

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host || `localhost:${PORT}`;
    const parsedUrl = new URL(request.url, `http://${host}`);
    const pathname = parsedUrl.pathname;

    // API Routes
    if (request.method === 'POST' && pathname === '/api/signup') return await handleSignUp(request, response);
    if (request.method === 'POST' && pathname === '/api/login')  return await handleLogin(request, response);
    if (request.method === 'POST' && pathname === '/api/logout') return await handleLogout(request, response);
    if (request.method === 'GET'  && pathname === '/api/me')     return await handleGetMe(request, response);
    if (request.method === 'GET'  && pathname === '/api/content') return await handleGetContent(request, response);
    if (request.method === 'POST' && pathname === '/api/content') return await handlePostContent(request, response);
    if (request.method === 'GET'  && pathname === '/api/admin/overview') return await handleAdminOverview(request, response);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(response, 405, { error: 'Method not allowed.' });
    }

    const currentLoggedInUser = cookieUser(request);

    // Routing rules
    // 1. If accessing /dashboard without being logged in, redirect to /login
    if (pathname === '/dashboard') {
      if (!currentLoggedInUser) {
        response.writeHead(302, { Location: '/login' });
        return response.end();
      }
    }

    // 2. If accessing /login while already logged in, redirect to /dashboard
    if (pathname === '/login') {
      if (currentLoggedInUser) {
        response.writeHead(302, { Location: '/dashboard' });
        return response.end();
      }
    }

    let filePath;
    if (pathname === '/' || pathname === '/index.html') {
      filePath = path.join(ROOT, 'index.html');
    } else if (pathname === '/login' || pathname === '/login.html') {
      filePath = path.join(ROOT, 'login.html');
    } else if (pathname === '/dashboard' || pathname === '/dashboard.html') {
      filePath = path.join(ROOT, 'dashboard.html');
    } else {
      filePath = path.resolve(ROOT, `.${pathname}`);
    }

    if (!filePath.startsWith(ROOT)) return json(response, 403, { error: 'Forbidden.' });

    const contents = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, { error: 'Not found.' });
    console.error(error);
    json(response, 500, { error: 'The server hit an unexpected error.' });
  }
});

ensureAdminUser().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Write Code Action is running at http://localhost:${PORT}`);
  });
});
