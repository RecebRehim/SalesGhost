import { createClient } from '@supabase/supabase-js';

/** Must match `database.js` hardcoded default account */
export const SYNC_ACCOUNT_ID = 'mock-user-001';

const ANALYTICS_KEY = 'ecommerce_analytics_events';
const DB_KEY = 'ecommerce_mock_database';
const CART_KEY = 'ecommerce_cart_data';
const WISHLIST_KEY = 'ecommerce_wishlist_data';
const CONSENT_KEY = 'ecommerce_tracking_consent';
const N8N_WEBHOOK_KEY = 'ecommerce_n8n_webhook_url';

let applyingRemote = false;
let pushTimer = null;

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isRemoteSyncConfigured = () =>
  Boolean(url && anonKey && url.length > 0 && anonKey.length > 0);

let client = null;
const getClient = () => {
  if (!isRemoteSyncConfigured()) return null;
  if (!client) client = createClient(url, anonKey);
  return client;
};

const safeWrite = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const mergeEventsById = (a = [], b = []) => {
  const map = new Map();
  [...a, ...b].forEach((event) => {
    if (event?.eventId) map.set(event.eventId, event);
  });
  return [...map.values()].sort(
    (x, y) => new Date(x.timestamp) - new Date(y.timestamp),
  );
};

const mergeSessions = (local = [], remote = []) => {
  const map = new Map();
  [...local, ...remote].forEach((session) => {
    if (!session?.sessionId) return;
    const existing = map.get(session.sessionId);
    if (!existing) {
      map.set(session.sessionId, { ...session });
      return;
    }
    const merged = { ...existing, ...session };
    if (existing.closedAt && session.closedAt) {
      merged.closedAt =
        new Date(existing.closedAt) > new Date(session.closedAt)
          ? existing.closedAt
          : session.closedAt;
    } else {
      merged.closedAt = existing.closedAt || session.closedAt;
    }
    merged.closedReason = merged.closedAt
      ? existing.closedReason || session.closedReason
      : null;
    map.set(session.sessionId, merged);
  });
  return [...map.values()];
};

const mergeNotifications = (local = [], remote = []) => {
  const map = new Map();
  [...local, ...remote].forEach((n) => {
    if (n?.id) map.set(n.id, n);
  });
  return [...map.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
};

const mergeCart = (local = [], remote = []) => {
  const byId = new Map();
  [...local, ...remote].forEach((item) => {
    if (!item?.id) return;
    const prev = byId.get(item.id);
    if (!prev || (item.quantity || 0) > (prev.quantity || 0)) {
      byId.set(item.id, { ...item });
    }
  });
  return [...byId.values()];
};

const mergeWishlist = (local = [], remote = []) => {
  const byId = new Map();
  [...local, ...remote].forEach((item) => {
    if (item?.id) byId.set(item.id, item);
  });
  return [...byId.values()];
};

export const buildSnapshot = () => ({
  accountId: SYNC_ACCOUNT_ID,
  analyticsEvents: readJson(ANALYTICS_KEY, []),
  mockDb: readJson(DB_KEY, null),
  cart: readJson(CART_KEY, []),
  wishlist: readJson(WISHLIST_KEY, []),
  consent: localStorage.getItem(CONSENT_KEY) || 'unset',
  n8nWebhookUrl: localStorage.getItem(N8N_WEBHOOK_KEY) || '',
});

export const scheduleRemotePush = () => {
  if (!isRemoteSyncConfigured() || applyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushToRemote();
  }, 900);
};

const pushToRemote = async () => {
  const supabase = getClient();
  if (!supabase) return;
  const snap = buildSnapshot();
  const db = snap.mockDb || {
    users: [{ userId: SYNC_ACCOUNT_ID, email: 'recebyegen05@gmail.com', fullName: 'SalesGhost Demo User' }],
    events: [],
    sessions: [],
    notifications: [],
    updatedAt: new Date().toISOString(),
  };
  const { error } = await supabase.from('salesghost_sync').upsert(
    {
      account_id: snap.accountId,
      analytics_events: snap.analyticsEvents,
      mock_database: db,
      cart: snap.cart,
      wishlist: snap.wishlist,
      consent: snap.consent,
      n8n_webhook_url: snap.n8nWebhookUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  );
  if (error) console.warn('[SalesGhost sync] push failed', error.message);
};

export const pullRemoteAndMerge = async () => {
  const supabase = getClient();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  const { data, error } = await supabase
    .from('salesghost_sync')
    .select('*')
    .eq('account_id', SYNC_ACCOUNT_ID)
    .maybeSingle();

  if (error) {
    console.warn('[SalesGhost sync] pull failed', error.message);
    return { ok: false, reason: error.message };
  }
  if (!data) {
    await pushToRemote();
    broadcastSync();
    return { ok: true, merged: false, reason: 'no_remote_row' };
  }

  applyingRemote = true;
  try {
    const localAnalytics = readJson(ANALYTICS_KEY, []);
    const remoteAnalytics = Array.isArray(data.analytics_events)
      ? data.analytics_events
      : [];
    safeWrite(ANALYTICS_KEY, mergeEventsById(localAnalytics, remoteAnalytics));

    const localDb = readJson(DB_KEY, {});
    const remoteDb = data.mock_database || {};
    const mergedDb = {
      users:
        localDb.users?.length
          ? localDb.users
          : remoteDb.users || [
              {
                userId: SYNC_ACCOUNT_ID,
                email: 'recebyegen05@gmail.com',
                fullName: 'SalesGhost Demo User',
              },
            ],
      events: mergeEventsById(localDb.events || [], remoteDb.events || []),
      sessions: mergeSessions(localDb.sessions || [], remoteDb.sessions || []),
      notifications: mergeNotifications(
        localDb.notifications || [],
        remoteDb.notifications || [],
      ),
      updatedAt: new Date().toISOString(),
    };
    safeWrite(DB_KEY, mergedDb);

    safeWrite(
      CART_KEY,
      mergeCart(readJson(CART_KEY, []), data.cart || []),
    );
    safeWrite(
      WISHLIST_KEY,
      mergeWishlist(readJson(WISHLIST_KEY, []), data.wishlist || []),
    );

    if (data.consent) localStorage.setItem(CONSENT_KEY, data.consent);
    if (data.n8n_webhook_url !== undefined && data.n8n_webhook_url !== null) {
      localStorage.setItem(N8N_WEBHOOK_KEY, data.n8n_webhook_url || '');
    }

    await pushToRemote();
    broadcastSync();
    return { ok: true, merged: true };
  } finally {
    applyingRemote = false;
  }
};

export const onRemoteSyncReady = (callback) => {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener('salesghost-sync', handler);
  return () => window.removeEventListener('salesghost-sync', handler);
};

export const broadcastSync = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('salesghost-sync'));
};
