import { createSession, getSessionCookie, verifySession } from './_utils/auth.js';

const protectedPaths = new Set([
  '/editor.html',
  '/frontend/editor.html',
  '/frontend/pages/editor.html',
]);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isProtectedPage = protectedPaths.has(url.pathname);
  const isProtectedApi = url.pathname === '/api/diary';

  if (!isProtectedPage && !isProtectedApi) return context.next();

  const session = await verifySession(getSessionCookie(request), env);
  if (session) return context.next();

  if (isProtectedApi) {
    return Response.json({ ok: false, error: '请先登录后再保存笔记。' }, { status: 401 });
  }

  const loginUrl = new URL('/frontend/pages/login.html', url.origin);
  loginUrl.searchParams.set('next', `${url.pathname}${url.search}`);
  return Response.redirect(loginUrl.toString(), 302);
}

export { createSession };
