import { useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Navbar, ConsentBanner } from './components/ui';
import { AboutPage, AnalyticsPage, CartPage, CheckoutPage, HomePage, NotificationsPage, ProductDetailPage, ProductsPage, SuccessPage, WishlistPage } from './pages';
import { getCart, saveCart } from './utils/cart';
import { getWishlist, saveWishlist } from './utils/wishlist';
import { getConsentStatus, setConsentStatus, trackEvent, trackWebsiteClosed } from './utils/analytics';
import { getNotifications } from './utils/database';
import {
  isRemoteSyncConfigured,
  onRemoteSyncReady,
  pullRemoteAndMerge,
} from './utils/remoteSync';

function App() {
  const [cart, setCart] = useState(getCart());
  const [wishlist, setWishlist] = useState(getWishlist());
  const [notifications, setNotifications] = useState(getNotifications());
  const [showNotificationToast, setShowNotificationToast] = useState(false);
  const [consent, setConsent] = useState(getConsentStatus());
  const prevUnreadRef = useRef(notifications.filter((item) => !item.read).length);
  const closeTrackedRef = useRef(false);
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const wishlistCount = wishlist.length;
  const unreadNotificationsCount = notifications.filter((item) => !item.read).length;

  const refreshNotifications = () => {
    setNotifications(getNotifications());
  };

  useEffect(() => {
    saveCart(cart);
  }, [cart]);
  useEffect(() => {
    saveWishlist(wishlist);
  }, [wishlist]);

  useEffect(() => {
    let cancelled = false;
    const hydrateFromCloud = async () => {
      if (!isRemoteSyncConfigured()) return;
      await pullRemoteAndMerge();
      if (cancelled) return;
      setCart(getCart());
      setWishlist(getWishlist());
      setNotifications(getNotifications());
    };
    hydrateFromCloud();

    const unsub = onRemoteSyncReady(() => {
      setCart(getCart());
      setWishlist(getWishlist());
      setNotifications(getNotifications());
    });

    const pollRemote = setInterval(() => {
      if (isRemoteSyncConfigured()) pullRemoteAndMerge();
    }, 45000);

    const poll = setInterval(() => {
      setNotifications(getNotifications());
    }, 5000);
    const onStorage = () => setNotifications(getNotifications());
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(pollRemote);
      clearInterval(poll);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (unreadNotificationsCount > prevUnreadRef.current) {
      setShowNotificationToast(true);
      const alertSound = new Audio('/audio/notification.mp3');
      alertSound.play().catch(() => {});
      setTimeout(() => setShowNotificationToast(false), 4000);
    }
    prevUnreadRef.current = unreadNotificationsCount;
  }, [unreadNotificationsCount]);

  useEffect(() => {
    const closeHandler = () => {
      if (closeTrackedRef.current) return;
      closeTrackedRef.current = true;
      trackWebsiteClosed('window_unload');
    };
    const pageHideHandler = () => {
      if (closeTrackedRef.current) return;
      closeTrackedRef.current = true;
      trackWebsiteClosed('pagehide');
    };
    const visibilityHandler = () => {
      if (document.visibilityState !== 'hidden' || closeTrackedRef.current) return;
      closeTrackedRef.current = true;
      trackWebsiteClosed('visibility_hidden');
    };
    window.addEventListener('beforeunload', closeHandler);
    window.addEventListener('pagehide', pageHideHandler);
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      window.removeEventListener('beforeunload', closeHandler);
      window.removeEventListener('pagehide', pageHideHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, []);

  const addToCart = (product) => {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      return existing
        ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...current, { ...product, quantity: 1 }];
    });
    trackEvent('ADD_TO_CART', { productId: product.id, productName: product.name, category: product.category, metadata: { quantity: 1 } });
  };

  const removeItem = (id) => {
    const item = cart.find((entry) => entry.id === id);
    setCart((current) => current.filter((entry) => entry.id !== id));
    trackEvent('REMOVE_FROM_CART', { productId: item?.id, productName: item?.name, category: item?.category });
  };

  const updateQty = (id, quantity) => {
    const item = cart.find((entry) => entry.id === id);
    setCart((current) => current.map((entry) => entry.id === id ? { ...entry, quantity } : entry));
    trackEvent('CART_QUANTITY_CHANGED', { productId: item?.id, productName: item?.name, category: item?.category, metadata: { quantity } });
  };

  const clearCart = () => setCart([]);
  const addWishlist = (product) => {
    setWishlist((current) => {
      if (current.some((item) => item.id === product.id)) return current;
      return [...current, product];
    });
    trackEvent('WISHLIST_ADD', { productId: product.id, productName: product.name, category: product.category });
  };
  const removeWishlistItem = (id) => {
    setWishlist((current) => current.filter((item) => item.id !== id));
  };
  const moveToCart = (product) => {
    addToCart(product);
    removeWishlistItem(product.id);
  };
  const buyNow = (product) => trackEvent('BUY_NOW_CLICKED', { productId: product.id, productName: product.name, category: product.category });

  return (
    <div>
      <Navbar cartCount={cartCount} wishlistCount={wishlistCount} notificationsCount={unreadNotificationsCount} />
      {showNotificationToast && (
        <div className="fixed right-4 top-20 z-50 rounded-lg border border-brand-200 bg-white px-4 py-3 text-sm shadow-lg">
          <p className="font-semibold text-brand-700">New notification from SalesGhost</p>
          <p className="text-slate-600">Open Notifications to review the n8n message.</p>
        </div>
      )}
      <Routes>
        <Route path="/" element={<HomePage onAddToCart={addToCart} />} />
        <Route path="/products" element={<ProductsPage onAddToCart={addToCart} />} />
        <Route path="/products/:productId" element={<ProductDetailPage onAddToCart={addToCart} onWishlist={addWishlist} onBuyNow={buyNow} />} />
        <Route path="/cart" element={<CartPage cart={cart} updateQty={updateQty} removeItem={removeItem} />} />
        <Route path="/wishlist" element={<WishlistPage wishlist={wishlist} removeWishlistItem={removeWishlistItem} moveToCart={moveToCart} />} />
        <Route path="/notifications" element={<NotificationsPage notifications={notifications} refreshNotifications={refreshNotifications} />} />
        <Route path="/checkout" element={<CheckoutPage cart={cart} clearCart={clearCart} />} />
        <Route path="/success" element={<SuccessPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
      <ConsentBanner status={consent} onChoice={(choice) => { setConsentStatus(choice); setConsent(choice); }} />
    </div>
  );
}

export default App;
