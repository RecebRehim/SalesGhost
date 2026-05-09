/**
 * POST /api/chat-message
 * Appends a chat message for the customer (stored in Supabase mock_database.notifications).
 * n8n: HTTP Request node — Method POST, JSON body, header X-API-Key.
 *
 * Body (JSON):
 *   { "message": "Hello!", "title": "Optional title", "metadata": {} }
 *   or { "text": "..." } (alias for message)
 *
 * Headers: X-API-Key: <SALESGHOST_API_KEY>
 *
 * Env: same as /api/salesghost (SALESGHOST_API_KEY + Supabase URL + anon key)
 */

const crypto = require('crypto');

function getEnv(name, fallbacks = []) {
  const v = process.env[name];
  if (v) return v;
  for (let i = 0; i < fallbacks.length; i += 1) {
    const f = fallbacks[i];
    if (process.env[f]) return process.env[f];
  }
  return '';
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-API-Key, Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
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
      hint: 'Send X-API-Key matching SALESGHOST_API_KEY',
    });
  }

  const baseUrl = getEnv('SUPABASE_URL', ['VITE_SUPABASE_URL']).replace(/\/$/, '');
  const anonKey = getEnv('SUPABASE_ANON_KEY', ['VITE_SUPABASE_ANON_KEY']);

  if (!baseUrl || !anonKey) {
    return res.status(503).json({
      error: 'Supabase not configured on server',
    });
  }

  const body = parseBody(req);
  const text =
    (typeof body.message === 'string' && body.message) ||
    (typeof body.text === 'string' && body.text) ||
    '';
  if (!text.trim()) {
    return res.status(400).json({
      error: 'Missing message',
      hint: 'Send JSON { "message": "..." } or { "text": "..." }',
    });
  }

  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim()
      : 'Message from SalesGhost';

  const accountId =
    (typeof body.account_id === 'string' && body.account_id) || 'mock-user-001';

  const restHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
  };

  const getUrl = `${baseUrl}/rest/v1/salesghost_sync?account_id=eq.${encodeURIComponent(accountId)}&select=*`;
  let upstream;
  try {
    upstream = await fetch(getUrl, { headers: restHeaders });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to read Supabase', detail: String(e && e.message) });
  }

  const rawText = await upstream.text();
  let rows;
  try {
    rows = JSON.parse(rawText);
  } catch {
    return res.status(502).json({ error: 'Invalid Supabase response', detail: rawText.slice(0, 300) });
  }

  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: 'Supabase read failed', detail: rows });
  }

  const row = Array.isArray(rows) ? rows[0] : null;
  let md =
    row && row.mock_database && typeof row.mock_database === 'object'
      ? row.mock_database
      : {};

  if (!md.users) md.users = [];
  if (!md.events) md.events = [];
  if (!md.sessions) md.sessions = [];
  if (!Array.isArray(md.notifications)) md.notifications = [];

  const newId = crypto.randomUUID();
  const entry = {
    id: newId,
    userId: 'mock-user-001',
    email: 'recebyegen05@gmail.com',
    title,
    message: text.trim(),
    channel: 'n8n',
    createdAt: new Date().toISOString(),
    read: false,
    metadata: {
      source: 'n8n',
      ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
    },
  };

  md.notifications.unshift(entry);
  md.updatedAt = new Date().toISOString();

  const patchUrl = `${baseUrl}/rest/v1/salesghost_sync?account_id=eq.${encodeURIComponent(accountId)}`;
  let patchRes;
  try {
    patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        ...restHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        mock_database: md,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    return res.status(502).json({ error: 'Failed to update Supabase', detail: String(e && e.message) });
  }

  if (!patchRes.ok) {
    const errText = await patchRes.text();
    return res.status(patchRes.status).json({
      error: 'Supabase patch failed',
      detail: errText.slice(0, 500),
    });
  }

  return res.status(200).json({
    ok: true,
    id: newId,
    account_id: accountId,
    channel: 'n8n',
    title: entry.title,
    message: entry.message,
    createdAt: entry.createdAt,
  });
};
