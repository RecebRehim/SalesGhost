import { broadcastSync, scheduleRemotePush } from './remoteSync';

const DB_KEY = 'ecommerce_mock_database';
const N8N_WEBHOOK_KEY = 'ecommerce_n8n_webhook_url';
const HARD_CODED_USER = {
  userId: 'mock-user-001',
  email: 'recebyegen05@gmail.com',
  fullName: 'SalesGhost Demo User',
};

const safeRead = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const safeWrite = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore write failures in demo context.
  }
};

const defaultDb = () => ({
  users: [HARD_CODED_USER],
  events: [],
  sessions: [],
  notifications: [],
  /** When set, notifications with older createdAt are dropped on cloud merge (after user clears history). */
  notificationsClearedAt: null,
  /** When set, wins over older cloud rows so reset demo data is not merged back from Supabase. */
  demoResetAt: null,
  updatedAt: new Date().toISOString(),
});

export const getHardcodedUser = () => HARD_CODED_USER;

export const getDb = () => {
  const db = safeRead(DB_KEY, defaultDb());
  if (!db.users?.length) db.users = [HARD_CODED_USER];
  if (!db.events) db.events = [];
  if (!db.sessions) db.sessions = [];
  if (!db.notifications) db.notifications = [];
  if (!('notificationsClearedAt' in db)) db.notificationsClearedAt = null;
  if (!('demoResetAt' in db)) db.demoResetAt = null;
  return db;
};

export const saveDb = (db) => {
  db.updatedAt = new Date().toISOString();
  safeWrite(DB_KEY, db);
  scheduleRemotePush();
};

export const appendEventToDb = (event) => {
  const db = getDb();
  db.events.push(event);
  const sessionExists = db.sessions.some((session) => session.sessionId === event.sessionId);
  if (!sessionExists) {
    db.sessions.push({
      sessionId: event.sessionId,
      userId: event.userId,
      startedAt: event.timestamp,
      closedAt: null,
      closedReason: null,
    });
  }
  saveDb(db);
};

export const markSessionClosed = (sessionId, reason = 'browser_closed') => {
  if (!sessionId) return;
  const db = getDb();
  const session = db.sessions.find((item) => item.sessionId === sessionId);
  if (session && !session.closedAt) {
    session.closedAt = new Date().toISOString();
    session.closedReason = reason;
  }
  saveDb(db);
};

export const getNotifications = () => getDb().notifications;

export const addNotification = (notification) => {
  const db = getDb();
  db.notifications.unshift({
    id: crypto.randomUUID(),
    userId: HARD_CODED_USER.userId,
    email: HARD_CODED_USER.email,
    title: notification.title || 'New message from SalesGhost AI',
    message: notification.message || '',
    channel: notification.channel || 'website',
    createdAt: new Date().toISOString(),
    read: false,
    metadata: notification.metadata || {},
  });
  saveDb(db);
};

export const markNotificationRead = (id) => {
  const db = getDb();
  const item = db.notifications.find((notification) => notification.id === id);
  if (item) item.read = true;
  saveDb(db);
};

export const markAllNotificationsRead = () => {
  const db = getDb();
  db.notifications.forEach((notification) => {
    notification.read = true;
  });
  saveDb(db);
};

/** Removes all in-app notifications and n8n chat messages, local + cloud sync. */
export const clearAllNotifications = () => {
  const db = getDb();
  db.notificationsClearedAt = new Date().toISOString();
  db.notifications = [];
  saveDb(db);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('salesghost-notifications-cleared'));
  }
  broadcastSync();
};

export const getN8nWebhookUrl = () => localStorage.getItem(N8N_WEBHOOK_KEY) || '';
export const setN8nWebhookUrl = (url) => {
  localStorage.setItem(N8N_WEBHOOK_KEY, url || '');
  scheduleRemotePush();
};

export const sendEventToN8n = async (event) => {
  const webhookUrl = getN8nWebhookUrl();
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'salesghost-web',
        user: HARD_CODED_USER,
        event,
      }),
    });
  } catch {
    // Silent fail in demo mode.
  }
};
