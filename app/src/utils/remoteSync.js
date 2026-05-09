import { createClient } from '@supabase/supabase-js';

/** Must match `database.js` hardcoded default account */
export const SYNC_ACCOUNT_ID = 'mock-user-001';

const ANALYTICS_KEY = 'ecommerce_analytics_events';
const DB_KEY = 'ecommerce_mock_database';
const CART_KEY = 'ecommerce_cart_data';
const WISHLIST_KEY = 'ecommerce_wishlist_data';
const CONSENT_KEY = 'ecommerce_tracking_consent';
const N8N_WEBHOOK_KEY = 'ecommerce_n8n_webhook_url';

/** Monotonic cart/wishlist edit time for last-write-wins merge vs Supabase. */
export const CART_UPDATED_AT_KEY = 'ecommerce_cart_updated_at';
export const WISHLIST_UPDATED_AT_KEY = 'ecommerce_wishlist_updated_at';

let applyingRemote = false;
let pushTimer = null;

/** Latest `salesghost_sync.updated_at` we have merged; cheap polls skip full pull when unchanged. */
let lastRemoteUpdatedAtRef = null;

async function syncLastRemoteUpdatedAtRef() {
  const supabase = getClient();
  if (!supabase) return;
  const { data } = await supabase
    .from('salesghost_sync')
    .select('updated_at')
    .eq('account_id', SYNC_ACCOUNT_ID)
    .maybeSingle();
  if (data?.updated_at) lastRemoteUpdatedAtRef = data.updated_at;
}

/**
 * Lightweight poll: only runs full merge when Supabase row `updated_at` changed (e.g. n8n POST to /api/chat-message).
 * Keeps chat near real-time without merging every second.
 */
export const quickPullIfRemoteChanged = async () => {
  const supabase = getClient();
  if (!supabase || applyingRemote) return;
  const { data, error } = await supabase
    .from('salesghost_sync')
    .select('updated_at')
    .eq('account_id', SYNC_ACCOUNT_ID)
    .maybeSingle();
  if (error || !data?.updated_at) return;
  if (data.updated_at === lastRemoteUpdatedAtRef) return;
  await pullRemoteAndMerge();
};

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

const parseTs = (iso) => {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const maxIso = (a, b) => {
  if (!a) return b ?? null;
  if (!b) return a;
  return parseTs(a) >= parseTs(b) ? a : b;
};

export const touchCartUpdatedAt = () => {
  try {
    localStorage.setItem(CART_UPDATED_AT_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
};

export const touchWishlistUpdatedAt = () => {
  try {
    localStorage.setItem(WISHLIST_UPDATED_AT_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
};

export const buildSnapshot = () => ({
  accountId: SYNC_ACCOUNT_ID,
  analyticsEvents: readJson(ANALYTICS_KEY, []),
  mockDb: readJson(DB_KEY, null),
  cart: readJson(CART_KEY, []),
  wishlist: readJson(WISHLIST_KEY, []),
  cartUpdatedAt: localStorage.getItem(CART_UPDATED_AT_KEY),
  wishlistUpdatedAt: localStorage.getItem(WISHLIST_UPDATED_AT_KEY),
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

/** Cancels debounced push and uploads immediately (use after destructive local resets). */
export const flushRemotePush = async () => {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushToRemote();
  await syncLastRemoteUpdatedAtRef();
};

/** Clears analytics, cart, wishlist, mock DB, stamps demoResetAt, overwrites Supabase row — prevents old data merging back. */
export const resetSyncedDemoDataLocal = async () => {
  const now = new Date().toISOString();
  safeWrite(ANALYTICS_KEY, []);
  try {
    localStorage.removeItem(CART_KEY);
    localStorage.removeItem(WISHLIST_KEY);
    localStorage.removeItem(CART_UPDATED_AT_KEY);
    localStorage.removeItem(WISHLIST_UPDATED_AT_KEY);
  } catch {
    /* ignore */
  }
  const freshDb = {
    users: [
      {
        userId: SYNC_ACCOUNT_ID,
        email: 'recebyegen05@gmail.com',
        fullName: 'SalesGhost Demo User',
      },
    ],
    events: [],
    sessions: [],
    notifications: [],
    notificationsClearedAt: null,
    demoResetAt: now,
    updatedAt: now,
  };
  safeWrite(DB_KEY, freshDb);
  await flushRemotePush();
  broadcastSync();
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
    notificationsClearedAt: null,
    demoResetAt: null,
    updatedAt: new Date().toISOString(),
  };
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from('salesghost_sync').upsert(
    {
      account_id: snap.accountId,
      analytics_events: snap.analyticsEvents,
      mock_database: db,
      cart: snap.cart,
      wishlist: snap.wishlist,
      cart_updated_at: snap.cartUpdatedAt ?? null,
      wishlist_updated_at: snap.wishlistUpdatedAt ?? null,
      consent: snap.consent,
      n8n_webhook_url: snap.n8nWebhookUrl,
      updated_at: nowIso,
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
    await syncLastRemoteUpdatedAtRef();
    broadcastSync();
    return { ok: true, merged: false, reason: 'no_remote_row' };
  }

  applyingRemote = true;
  try {
    const localAnalytics = readJson(ANALYTICS_KEY, []);
    const remoteAnalytics = Array.isArray(data.analytics_events)
      ? data.analytics_events
      : [];

    const localDb = readJson(DB_KEY, {});
    const remoteDb = data.mock_database || {};
    const lReset = parseTs(localDb.demoResetAt);
    const rReset = parseTs(remoteDb.demoResetAt);

    const defaultUsers = () => [
      {
        userId: SYNC_ACCOUNT_ID,
        email: 'recebyegen05@gmail.com',
        fullName: 'SalesGhost Demo User',
      },
    ];

    if (lReset > rReset) {
      safeWrite(ANALYTICS_KEY, localAnalytics);
      const mergedDb = {
        users: localDb.users?.length ? localDb.users : remoteDb.users || defaultUsers(),
        events: localDb.events || [],
        sessions: localDb.sessions || [],
        notifications: localDb.notifications || [],
        notificationsClearedAt: localDb.notificationsClearedAt ?? null,
        demoResetAt: localDb.demoResetAt ?? null,
        updatedAt: new Date().toISOString(),
      };
      safeWrite(DB_KEY, mergedDb);
    } else if (rReset > lReset) {
      safeWrite(ANALYTICS_KEY, remoteAnalytics);
      const mergedDb = {
        users: remoteDb.users?.length ? remoteDb.users : localDb.users || defaultUsers(),
        events: remoteDb.events || [],
        sessions: remoteDb.sessions || [],
        notifications: remoteDb.notifications || [],
        notificationsClearedAt: remoteDb.notificationsClearedAt ?? null,
        demoResetAt: remoteDb.demoResetAt ?? null,
        updatedAt: new Date().toISOString(),
      };
      safeWrite(DB_KEY, mergedDb);
    } else {
      safeWrite(ANALYTICS_KEY, mergeEventsById(localAnalytics, remoteAnalytics));

      const clearedAt = maxIso(
        localDb.notificationsClearedAt,
        remoteDb.notificationsClearedAt,
      );
      const mergedNotifications = mergeNotifications(
        localDb.notifications || [],
        remoteDb.notifications || [],
      ).filter((n) => {
        if (!clearedAt) return true;
        return new Date(n.createdAt) >= new Date(clearedAt);
      });
      const mergedDb = {
        users:
          localDb.users?.length
            ? localDb.users
            : remoteDb.users || defaultUsers(),
        events: mergeEventsById(localDb.events || [], remoteDb.events || []),
        sessions: mergeSessions(localDb.sessions || [], remoteDb.sessions || []),
        notifications: mergedNotifications,
        notificationsClearedAt: clearedAt,
        demoResetAt: maxIso(localDb.demoResetAt, remoteDb.demoResetAt),
        updatedAt: new Date().toISOString(),
      };
      safeWrite(DB_KEY, mergedDb);
    }

    const remoteCart = Array.isArray(data.cart) ? data.cart : [];
    let localCartAt = localStorage.getItem(CART_UPDATED_AT_KEY);
    if (!localCartAt && readJson(CART_KEY, []).length > 0) {
      touchCartUpdatedAt();
      localCartAt = localStorage.getItem(CART_UPDATED_AT_KEY);
    }
    const remoteCartAt = data.cart_updated_at ?? null;
    if (parseTs(remoteCartAt) > parseTs(localCartAt)) {
      safeWrite(CART_KEY, remoteCart);
      if (remoteCartAt) {
        try {
          localStorage.setItem(CART_UPDATED_AT_KEY, remoteCartAt);
        } catch {
          /* ignore */
        }
      }
    }

    const remoteWish = Array.isArray(data.wishlist) ? data.wishlist : [];
    let localWishAt = localStorage.getItem(WISHLIST_UPDATED_AT_KEY);
    if (!localWishAt && readJson(WISHLIST_KEY, []).length > 0) {
      touchWishlistUpdatedAt();
      localWishAt = localStorage.getItem(WISHLIST_UPDATED_AT_KEY);
    }
    const remoteWishAt = data.wishlist_updated_at ?? null;
    if (parseTs(remoteWishAt) > parseTs(localWishAt)) {
      safeWrite(WISHLIST_KEY, remoteWish);
      if (remoteWishAt) {
        try {
          localStorage.setItem(WISHLIST_UPDATED_AT_KEY, remoteWishAt);
        } catch {
          /* ignore */
        }
      }
    }

    if (data.consent) localStorage.setItem(CONSENT_KEY, data.consent);
    if (data.n8n_webhook_url !== undefined && data.n8n_webhook_url !== null) {
      localStorage.setItem(N8N_WEBHOOK_KEY, data.n8n_webhook_url || '');
    }

    await pushToRemote();
    await syncLastRemoteUpdatedAtRef();
    broadcastSync();
    return { ok: true, merged: true };
  } finally {
    applyingRemote = false;
  }
};

let realtimePullTimer = null;

/** Subscribe to Postgres changes on `salesghost_sync` for instant pull (enable Realtime + replica for this table in Supabase). */
export const subscribeSalesghostSync = () => {
  const supabase = getClient();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`sg-sync-${SYNC_ACCOUNT_ID}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'salesghost_sync',
        filter: `account_id=eq.${SYNC_ACCOUNT_ID}`,
      },
      () => {
        if (realtimePullTimer) clearTimeout(realtimePullTimer);
        realtimePullTimer = setTimeout(() => {
          realtimePullTimer = null;
          pullRemoteAndMerge();
        }, 50);
      },
    )
    .subscribe();
  return () => {
    if (realtimePullTimer) {
      clearTimeout(realtimePullTimer);
      realtimePullTimer = null;
    }
    supabase.removeChannel(channel);
  };
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
