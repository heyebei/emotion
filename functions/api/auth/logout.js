import { clearSessionCookie } from '../../../functions/_utils/auth.js';

export async function onRequest({ request }) {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  }

  return Response.json({ ok: true }, {
    headers: {
      'Set-Cookie': clearSessionCookie(),
      'Cache-Control': 'no-store',
    },
  });
}
