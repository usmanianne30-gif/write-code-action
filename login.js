'use strict';

const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const paneLogin = document.getElementById('pane-login');
const paneRegister = document.getElementById('pane-register');

const loginForm = document.getElementById('login-form');
const loginFeedback = document.getElementById('login-feedback');

const regForm = document.getElementById('register-form');
const regFeedback = document.getElementById('reg-feedback');

function switchTab(mode) {
  const isLogin = mode === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabLogin.setAttribute('aria-selected', isLogin ? 'true' : 'false');
  paneLogin.classList.toggle('active', isLogin);
  paneLogin.hidden = !isLogin;

  tabRegister.classList.toggle('active', !isLogin);
  tabRegister.setAttribute('aria-selected', !isLogin ? 'true' : 'false');
  paneRegister.classList.toggle('active', !isLogin);
  paneRegister.hidden = isLogin;

  loginFeedback.textContent = '';
  loginFeedback.className = 'form-feedback';
  regFeedback.textContent = '';
  regFeedback.className = 'form-feedback';

  if (isLogin) {
    document.getElementById('login-username').focus();
  } else {
    document.getElementById('reg-name').focus();
  }
}

tabLogin.addEventListener('click', () => switchTab('login'));
tabRegister.addEventListener('click', () => switchTab('register'));

// Handle query param ?mode=register
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('mode') === 'register') {
  switchTab('register');
}

// ─── LOGIN SUBMIT ───
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const username = loginForm.username.value.trim();
  const password = loginForm.password.value;
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  if (!username || !password) {
    loginFeedback.textContent = 'Please enter your unique ID and password.';
    loginFeedback.className = 'form-feedback error';
    return;
  }

  submitBtn.disabled = true;
  loginFeedback.textContent = 'Verifying credentials…';
  loginFeedback.className = 'form-feedback pending';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to sign in.');

    loginFeedback.textContent = `Welcome back, ${data.name}. Entering stage…`;
    loginFeedback.className = 'form-feedback success';

    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 450);
  } catch (err) {
    loginFeedback.textContent = err.message || 'Could not connect to membership server.';
    loginFeedback.className = 'form-feedback error';
    submitBtn.disabled = false;
  }
});

// ─── REGISTER SUBMIT ───
regForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = regForm.name.value.trim();
  const username = regForm.username.value.trim().toLowerCase();
  const password = regForm.password.value;
  const submitBtn = regForm.querySelector('button[type="submit"]');

  if (!name) {
    regFeedback.textContent = 'Please enter your real name.';
    regFeedback.className = 'form-feedback error';
    return;
  }
  if (!username || username.length < 3) {
    regFeedback.textContent = 'Unique ID must be at least 3 characters.';
    regFeedback.className = 'form-feedback error';
    return;
  }
  if (!password || password.length < 6) {
    regFeedback.textContent = 'Password must be at least 6 characters.';
    regFeedback.className = 'form-feedback error';
    return;
  }

  submitBtn.disabled = true;
  regFeedback.textContent = 'Recording your place in the cast…';
  regFeedback.className = 'form-feedback pending';

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed.');

    regFeedback.textContent = `Registered successfully! Entering stage…`;
    regFeedback.className = 'form-feedback success';

    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 450);
  } catch (err) {
    regFeedback.textContent = err.message || 'Could not register.';
    regFeedback.className = 'form-feedback error';
    submitBtn.disabled = false;
  }
});
