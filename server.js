/**
 * WCA's intentionally dependency-free server. It serves the public site and
 * keeps local development records in data/users.json and uses Supabase in
 * production, so Render's free service can remain stateless.
 */
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIRECTORY = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIRECTORY, 'users.json');
const PORT = Number(process.env.PORT || 4173);
const PASSWORD_UNIQUENESS_KEY = process.env.PASSWORD_UNIQUENESS_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!PASSWORD_UNIQUENESS_KEY) {
  console.warn('WARNING: Set PASSWORD_UNIQUENESS_KEY before public deployment.');
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('INFO: Using local data/users.json. Set Supabase variables for global registrations.');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readUsers() {
  try { return JSON.parse(await fs.readFile(USERS_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

async function saveUsers(users) {
  await fs.mkdir(DATA_DIRECTORY, { recursive: true });
  const temporaryFile = `${USERS_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(users, null, 2), 'utf8');
  await fs.rename(temporaryFile, USERS_FILE);
}

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

async function findExistingUser(username, fingerprint) {
  if (!usingSupabase()) {
    const users = await readUsers();
    return users.find(user => user.username === username || (user.passwordFingerprint || user.password_fingerprint) === fingerprint);
  }
  const userCheck = await supabase(`wca_members?username=eq.${encodeURIComponent(username)}&select=username`);
  if (!userCheck.response.ok) throw new Error('Could not check the member database.');
  if (userCheck.body?.length) return { username };
  const passwordCheck = await supabase(`wca_members?password_fingerprint=eq.${fingerprint}&select=username`);
  if (!passwordCheck.response.ok) throw new Error('Could not check the member database.');
  return passwordCheck.body?.[0] || null;
}

async function createUser(user) {
  if (!usingSupabase()) {
    const users = await readUsers();
    users.push(user);
    return saveUsers(users);
  }
  const result = await supabase('wca_members', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(user) });
  if (result.response.status === 409) {
    const error = new Error('That username or password is already in the cast list.');
    error.status = 409;
    throw error;
  }
  if (!result.response.ok) throw new Error('Could not save your place in the cast. Please try again.');
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function passwordFingerprint(password) {
  return crypto.createHmac('sha256', PASSWORD_UNIQUENESS_KEY || 'local-development-key')
    .update(password).digest('hex');
}

async function signUp(request, response) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) return json(response, 413, { error: 'Request is too large.' });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return json(response, 400, { error: 'Please send valid sign-up details.' }); }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[a-z0-9_-]{3,24}$/.test(username)) return json(response, 400, { error: 'Use 3–24 letters, numbers, hyphens, or underscores.' });
  if (password.length < 8 || password.length > 128) return json(response, 400, { error: 'Use a password between 8 and 128 characters.' });

  const fingerprint = passwordFingerprint(password);
  try {
    const existingUser = await findExistingUser(username, fingerprint);
    if (existingUser?.username === username) return json(response, 409, { error: 'That username is already in the cast list.' });
    if (existingUser) return json(response, 409, { error: 'Choose a password that belongs only to you.' });
    const salt = crypto.randomBytes(16).toString('hex');
    await createUser({ username, password_hash: passwordHash(password, salt), salt, password_fingerprint: fingerprint, joined_at: new Date().toISOString() });
    return json(response, 201, { message: `Welcome, ${username}. Your first scene is waiting.` });
  } catch (error) {
    if (error.status === 409) return json(response, 409, { error: error.message });
    console.error(error);
    return json(response, 503, { error: 'The membership service is unavailable. Please try again soon.' });
  }
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ico': 'image/x-icon' };
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'POST' && request.url === '/api/signup') return await signUp(request, response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed.' });
    const requestPath = request.url === '/' ? '/index.html' : new URL(request.url, `http://${request.headers.host}`).pathname;
    const filePath = path.resolve(ROOT, `.${requestPath}`);
    if (!filePath.startsWith(ROOT)) return json(response, 403, { error: 'Forbidden.' });
    const contents = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, { error: 'Not found.' });
    console.error(error);
    json(response, 500, { error: 'The club server hit an unexpected error.' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`WCA is live at http://localhost:${PORT}`));
