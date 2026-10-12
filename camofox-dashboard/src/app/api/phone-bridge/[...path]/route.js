// Server-side proxy from the dashboard to Camofox's phone-bridge desktop routes.
//
// Why a proxy: Camofox sends no CORS headers, and when CAMOFOX_ACCESS_KEY /
// CAMOFOX_API_KEY is set the key must stay on the server. The browser talks
// to this same-origin route; this route adds the key and forwards only the
// phone-bridge desktop routes below -- it is not a general Camofox proxy.
// The phone itself talks to Camofox directly (pairUrl points there).

const CAMOFOX_INTERNAL_URL = (
  process.env.CAMOFOX_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_CAMOFOX_URL ||
  'http://localhost:9377'
).replace(/\/+$/, '');
const CAMOFOX_KEY = process.env.CAMOFOX_ACCESS_KEY || process.env.CAMOFOX_API_KEY || '';
// The Camofox browser session (userId) this dashboard drives; smart-agent.js uses "default".
const CAMOFOX_USER_ID = process.env.CAMOFOX_USER_ID || 'default';

const ID = '[A-Za-z0-9_-]{8,32}';
const ROUTES = [
  ['POST', new RegExp('^sessions$')],
  ['GET', new RegExp(`^sessions/${ID}$`)],
  ['DELETE', new RegExp(`^sessions/${ID}$`)],
  ['GET', new RegExp(`^sessions/${ID}/targets$`)],
  ['POST', new RegExp(`^sessions/${ID}/files/${ID}/attach$`)],
  ['DELETE', new RegExp(`^sessions/${ID}/files/${ID}$`)],
];

function noStoreJson(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function forward(request, { params }) {
  const { path = [] } = await params;
  const subPath = path.join('/');
  const method = request.method;
  if (!ROUTES.some(([m, re]) => m === method && re.test(subPath))) {
    return noStoreJson({ error: 'Not found' }, 404);
  }

  const headers = { 'Content-Type': 'application/json' };
  const bridgeToken = request.headers.get('x-phone-bridge-token');
  if (bridgeToken) headers['X-Phone-Bridge-Token'] = bridgeToken;
  if (CAMOFOX_KEY) headers.Authorization = `Bearer ${CAMOFOX_KEY}`;

  let body;
  if (method === 'POST') {
    const json = await request.json().catch(() => ({}));
    // Pairings are always bound to this dashboard's browser session.
    body = JSON.stringify(subPath === 'sessions' ? { userId: CAMOFOX_USER_ID } : json);
  }

  try {
    const res = await fetch(`${CAMOFOX_INTERNAL_URL}/phone-bridge/${subPath}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError';
    return noStoreJson(
      { error: timedOut ? 'Camofox did not respond in time' : 'Camofox is unreachable' },
      timedOut ? 504 : 502,
    );
  }
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
