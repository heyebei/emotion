const form = document.getElementById('login-form');
const status = document.getElementById('login-status');
const button = document.getElementById('login-button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '正在验证…';
  button.disabled = true;

  try {
    const response = await fetch('../api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '登录失败，请稍后重试。');

    const requestedNext = new URLSearchParams(window.location.search).get('next') || './editor.html';
    const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : './editor.html';
    window.location.assign(next);
  } catch (error) {
    status.textContent = error.message || '登录失败，请稍后重试。';
    button.disabled = false;
  }
});
