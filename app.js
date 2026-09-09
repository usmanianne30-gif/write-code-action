const dialog = document.querySelector('.signup-dialog');
const form = document.querySelector('#signup-form');
const message = document.querySelector('#form-message');

window.addEventListener('load', () => document.body.classList.add('loaded'));

document.querySelectorAll('[data-open-signup]').forEach(button => button.addEventListener('click', () => {
  message.textContent = '';
  dialog.showModal();
  setTimeout(() => document.querySelector('#username').focus(), 120);
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
      body: JSON.stringify({ username: form.username.value, password: form.password.value })
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
