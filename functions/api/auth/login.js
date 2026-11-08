import { createSession, sessionCookie } from '../../../functions/_utils/auth.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  if (!env.EDITOR_USERNAME || !env.EDITOR_PASSWORD || !env.EDITOR_SESSION_SECRET) {
    return Response.json({ ok: false, error: '编辑登录尚未配置，请联系网站管理员。' }, { status: 503 });
  }

  let credentials;
  try {
    credentials = await request.json();
  } catch {
    return Response.json({ ok: false, error: '请求格式无效。' }, { status: 400 });
  }

  const username = typeof credentials.username === 'string' ? credentials.username : '';
  const password = typeof credentials.password === 'string' ? credentials.password : '';
  if (!constantTimeEqual(username, env.EDITOR_USERNAME) || !constantTimeEqual(password, env.EDITOR_PASSWORD)) {
    return Response.json({ ok: false, error: '账号或密码错误。' }, { status: 401 });
  }

  const session = await createSession(username, env.EDITOR_SESSION_SECRET);
  return Response.json({ ok: true }, {
    headers: {
      'Set-Cookie': sessionCookie(session),
      'Cache-Control': 'no-store',
    },
  });
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}
