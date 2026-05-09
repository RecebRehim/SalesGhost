/**
 * GET /api/salesghost
 * Returns synced SalesGhost data from Supabase for n8n (or any HTTP client).
 *
 * Headers:
 *   X-API-Key: <SALESGHOST_API_KEY>   OR   Authorization: Bearer <SALESGHOST_API_KEY>
 *
 * Query:
 *   account_id   default mock-user-001
 *   part         optional: full | analytics_events | mock_database | cart | wishlist | meta
 *
 * Vercel env:
 *   SALESGHOST_API_KEY (required)
 *   SUPABASE_URL or VITE_SUPABASE_URL
 *   SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY
 */

function getEnv(name, fallbacks = []) {
  const v = process.env[name];
  if (v) return v;
  for (let i = 0; i < fallbacks.length; i += 1) {
    const f = fallbacks[i];
    if (process.env[f]) return process.env[f];
  }
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedKey = getEnv('SALESGHOST_API_KEY');
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const sent =
    req.headers['x-api-key'] ||
    req.headers['X-API-Key'] ||
    (typeof authHeader === 'string'
      ? authHeader.replace(/^Bearer\s+/i, '').trim()
      : '');

  if (!expectedKey || sent !== expectedKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      hint: 'Set SALESGHOST_API_KEY in Vercel env and send header X-API-Key',
    });
  }

  const rawBase = getEnv('SUPABASE_URL', ['VITE_SUPABASE_URL']);
  const baseUrl = rawBase.replace(/\/$/, '');
  const anonKey = getEnv('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);

  if (!baseUrl || !anonKey) {
    return res.status(503).json({
      error: 'Supabase URL/key not configured on server',
      hint: 'Add SUPABASE_URL + SUPABASE_ANON_KEY (or VITE_*) to Vercel env',
    });
  }

  const accountId =
    (typeof req.query.account_id === 'string' && req.query.account_id) || 'mock-user-001';
  const part = typeof req.query.part === 'string' ? req.query.part : 'full';

  const url = `${baseUrl}/rest/v1/salesghost_sync?account_id=eq.${encodeURIComponent(accountId)}&select=*`;

  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    return res.status(502).json({
      error: 'Failed to reach Supabase',
      detail: String(e && e.message ? e.message : e),
    });
  }

  const text = await upstream.text();
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    return res.status(502).json({
      error: 'Invalid response from Supabase',
      detail: text.slice(0, 500),
    });
  }

  if (!upstream.ok) {
    return res.status(upstream.status).json({
      error: 'Supabase REST error',
      detail: rows && rows.message ? rows.message : text,
    });
  }

  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row) {
    return res.status(200).json({
      exists: false,
      account_id: accountId,
      message:
        'No row yet — open the deployed site once (with tracking accepted) so data syncs.',
    });
  }

  const payload = {
    account_id: row.account_id,
    analytics_events: row.analytics_events || [],
    mock_database: row.mock_database || {},
    cart: row.cart || [],
    wishlist: row.wishlist || [],
    consent: row.consent || 'unset',
    n8n_webhook_url: row.n8n_webhook_url || '',
    updated_at: row.updated_at,
  };

  if (part === 'analytics_events') return res.status(200).json(payload.analytics_events);
  if (part === 'mock_database') return res.status(200).json(payload.mock_database);
  if (part === 'cart') return res.status(200).json(payload.cart);
  if (part === 'wishlist') return res.status(200).json(payload.wishlist);
  if (part === 'meta') {
    const md = payload.mock_database || {};
    return res.status(200).json({
      account_id: payload.account_id,
      consent: payload.consent,
      n8n_webhook_url: payload.n8n_webhook_url,
      updated_at: payload.updated_at,
      counts: {
        analytics_events: Array.isArray(payload.analytics_events)
          ? payload.analytics_events.length
          : 0,
        mock_events: Array.isArray(md.events) ? md.events.length : 0,
        notifications: Array.isArray(md.notifications) ? md.notifications.length : 0,
      },
    });
  }

  return res.status(200).json({ exists: true, ...payload });
};
