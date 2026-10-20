const dialog = document.querySelector('.signup-dialog');
const form = document.querySelector('#signup-form');
const message = document.querySelector('#form-message');

window.addEventListener('load', () => document.body.classList.add('loaded'));

document.querySelectorAll('[data-open-signup]').forEach(button => button.addEventListener('click', () => {
  message.textContent = '';
  dialog.showModal();
  setTimeout(() => (document.querySelector('#name') || document.querySelector('#username')).focus(), 120);
}));
document.querySelector('[data-close-signup]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  message.style.color = '#6a6259';
  message.textContent = 'Saving your place in the cast…';
  try {
    const response = await fetch('/api/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name?.value || '',
        email: form.email?.value?.trim().toLowerCase() || '',
        username: form.username.value,
        password: form.password.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
    // Redirect to the member dashboard — the server already set the session cookie.
    window.location.href = '/dashboard';
  } catch (error) {
    message.style.color = '#b92720';
    message.textContent = error.message === 'Failed to fetch'
      ? 'The club server is not connected yet.' : error.message;
  } finally { submit.disabled = false; }
});


// Handle Google Sign-In / Sign-Up
const btnGoogle = document.getElementById('btn-google-signup');
if (btnGoogle) {
  btnGoogle.addEventListener('click', async () => {
    let email = prompt('Enter your Google Account email (e.g. usmanianne30@gmail.com):');
    if (!email) return;
    email = email.trim().toLowerCase();
    if (!email.includes('@')) {
      message.style.color = '#b92720';
      message.textContent = 'Please enter a valid email address.';
      return;
    }

    btnGoogle.disabled = true;
    message.style.color = '#6a6259';
    message.textContent = 'Authenticating with Google account…';

    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Google authentication failed.');

      message.style.color = '#2e7d32';
      message.textContent = 'Welcome, ' + result.name + '! Entering stage…';
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 400);
    } catch (err) {
      message.style.color = '#b92720';
      message.textContent = err.message;
      btnGoogle.disabled = false;
    }
  });
}