import { getSessionCookie, verifySession } from './functions/_utils/auth.js';
import { onRequest as login } from './functions/api/auth/login.js';
import { onRequest as logout } from './functions/api/auth/logout.js';
import { onRequest as saveDiary } from './functions/api/diary.js';

const protectedPages = new Set([
  '/editor.html',
  '/frontend/editor.html',
  '/frontend/pages/editor.html',
]);

const privateProjectPaths = [
  '/functions/',
  '/.github/',
  '/.git/',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/auth/login') return login({ request, env });
    if (pathname === '/api/auth/logout') return logout({ request, env });

    if (pathname === '/api/diary') {
      const session = await verifySession(getSessionCookie(request), env);
      if (!session) {
        return Response.json({ ok: false, error: '请先登录后再保存笔记。' }, { status: 401 });
      }
      return saveDiary({ request, env });
    }

    if (protectedPages.has(pathname)) {
      const session = await verifySession(getSessionCookie(request), env);
      if (!session) {
        const loginUrl = new URL('/frontend/pages/login.html', url.origin);
        loginUrl.searchParams.set('next', `${pathname}${url.search}`);
        return Response.redirect(loginUrl.toString(), 302);
      }
    }

    // The asset bundle currently uses the repository root to preserve existing
    // URLs. Never expose source files or deployment metadata as public assets.
    if (
      privateProjectPaths.some((prefix) => pathname.startsWith(prefix)) ||
      ['/worker.js', '/wrangler.jsonc', '/README.md', '/.gitignore'].includes(pathname)
    ) {
      return new Response('Not Found', { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
