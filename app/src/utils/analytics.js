import {
  appendEventToDb,
  getHardcodedUser,
  markSessionClosed,
  sendEventToN8n,
} from './database';
import { scheduleRemotePush } from './remoteSync';

const ANALYTICS_KEY = 'ecommerce_analytics_events';
const CONSENT_KEY = 'ecommerce_tracking_consent';
const SESSION_KEY = 'ecommerce_session_id';

const USER_ID = getHardcodedUser().userId;

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
    // Ignore localStorage failures in demo mode.
  }
};

export const getConsentStatus = () =>
  localStorage.getItem(CONSENT_KEY) || 'unset';
export const setConsentStatus = (status) => {
  localStorage.setItem(CONSENT_KEY, status);
  scheduleRemotePush();
};
export const isTrackingEnabled = () => getConsentStatus() === 'accepted';

export const getSessionId = () => {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const newId = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, newId);
  return newId;
};

export const getEvents = () => safeRead(ANALYTICS_KEY, []);
export const clearEvents = () => {
  safeWrite(ANALYTICS_KEY, []);
  scheduleRemotePush();
};

export const trackEvent = (eventType, payload = {}) => {
  if (!isTrackingEnabled()) return null;
  const event = {
    eventId: crypto.randomUUID(),
    eventType,
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    userId: USER_ID,
    page: payload.page || window.location.pathname,
    productId: payload.productId || null,
    productName: payload.productName || null,
    category: payload.category || null,
    searchQuery: payload.searchQuery || null,
    metadata: payload.metadata || {},
  };
  const events = getEvents();
  events.push(event);
  safeWrite(ANALYTICS_KEY, events);
  appendEventToDb(event);
  sendEventToN8n(event);
  return event;
};

export const trackWebsiteClosed = (reason = 'browser_closed') => {
  const closedEvent = {
    eventId: crypto.randomUUID(),
    eventType: 'WEBSITE_CLOSED',
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    userId: USER_ID,
    page: window.location.pathname,
    productId: null,
    productName: null,
    category: null,
    searchQuery: null,
    metadata: { reason },
  };

  const events = getEvents();
  events.push(closedEvent);
  safeWrite(ANALYTICS_KEY, events);
  appendEventToDb(closedEvent);
  markSessionClosed(closedEvent.sessionId, reason);
  sendEventToN8n(closedEvent);
};

export const computeAnalytics = (events) => {
  const countBy = (list, key) =>
    list.reduce((acc, item) => {
      const value = item[key];
      if (value) acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});

  const type = (name) => events.filter((event) => event.eventType === name);
  const productViews = type('PRODUCT_VIEW');
  const searches = type('SEARCH');
  const addToCart = type('ADD_TO_CART');
  const purchases = type('PURCHASE_COMPLETED');
  const checkoutStarted = type('CHECKOUT_STARTED');
  const abandoned = type('CHECKOUT_ABANDONED');
  const wishlistAdds = type('WISHLIST_ADD');

  const viewedProductIds = new Set(productViews.map((e) => e.productId).filter(Boolean));
  const purchasedProductIds = new Set(purchases.flatMap((e) => e.metadata?.productIds || []));

  const viewedNotPurchased = [...viewedProductIds].filter(
    (id) => !purchasedProductIds.has(id),
  );

  const searchCounts = countBy(searches, 'searchQuery');
  const viewCounts = countBy(productViews, 'productName');
  const cartCounts = countBy(addToCart, 'productName');

  const conversionRate = checkoutStarted.length
    ? (purchases.length / checkoutStarted.length) * 100
    : 0;
  const searchToCartRate = searches.length ? (addToCart.length / searches.length) * 100 : 0;
  const viewToCartRate = productViews.length ? (addToCart.length / productViews.length) * 100 : 0;
  const viewToPurchaseRate = productViews.length
    ? (purchases.length / productViews.length) * 100
    : 0;

  return {
    totalEvents: events.length,
    totalProductViews: productViews.length,
    totalSearches: searches.length,
    totalAddToCart: addToCart.length,
    totalWishlistAdds: wishlistAdds.length,
    totalPurchases: purchases.length,
    cartAbandonmentCount: abandoned.length,
    viewedNotPurchasedCount: viewedNotPurchased.length,
    conversionRate,
    searchToCartRate,
    viewToCartRate,
    viewToPurchaseRate,
    funnel: {
      views: productViews.length,
      cart: addToCart.length,
      checkout: checkoutStarted.length,
      purchase: purchases.length,
    },
    topSearchTerms: Object.entries(searchCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
    topViewedProducts: Object.entries(viewCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
    topCartProducts: Object.entries(cartCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
    recentEvents: [...events].reverse().slice(0, 20),
  };
};

export const generateDemoEvents = (products) => {
  const selected = products.slice(0, 8);
  selected.forEach((product, index) => {
    trackEvent('PRODUCT_VIEW', {
      productId: product.id,
      productName: product.name,
      category: product.category,
      metadata: { source: 'demo-mode', index },
    });
    if (index % 2 === 0) {
      trackEvent('ADD_TO_CART', {
        productId: product.id,
        productName: product.name,
        category: product.category,
        metadata: { quantity: 1, source: 'demo-mode' },
      });
    }
  });
  ['laptop', 'gpu', 'wireless mouse', 'ssd'].forEach((query) =>
    trackEvent('SEARCH', { searchQuery: query, metadata: { source: 'demo-mode' } }),
  );
  trackEvent('CHECKOUT_STARTED', { metadata: { source: 'demo-mode' } });
  trackEvent('PURCHASE_COMPLETED', {
    metadata: { source: 'demo-mode', productIds: selected.slice(0, 2).map((p) => p.id) },
  });
};
