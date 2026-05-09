import { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Navbar, ConsentBanner } from './components/ui';
import { AboutPage, AnalyticsPage, CartPage, CheckoutPage, HomePage, ProductDetailPage, ProductsPage, SuccessPage, WishlistPage } from './pages';
import { getCart, saveCart } from './utils/cart';
import { getWishlist, saveWishlist } from './utils/wishlist';
import { getConsentStatus, setConsentStatus, trackEvent } from './utils/analytics';

function App() {
  const [cart, setCart] = useState(getCart());
  const [wishlist, setWishlist] = useState(getWishlist());
  const [consent, setConsent] = useState(getConsentStatus());
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const wishlistCount = wishlist.length;

  useEffect(() => {
    saveCart(cart);
  }, [cart]);
  useEffect(() => {
    saveWishlist(wishlist);
  }, [wishlist]);

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
      <Navbar cartCount={cartCount} wishlistCount={wishlistCount} />
      <Routes>
        <Route path="/" element={<HomePage onAddToCart={addToCart} />} />
        <Route path="/products" element={<ProductsPage onAddToCart={addToCart} />} />
        <Route path="/products/:productId" element={<ProductDetailPage onAddToCart={addToCart} onWishlist={addWishlist} onBuyNow={buyNow} />} />
        <Route path="/cart" element={<CartPage cart={cart} updateQty={updateQty} removeItem={removeItem} />} />
        <Route path="/wishlist" element={<WishlistPage wishlist={wishlist} removeWishlistItem={removeWishlistItem} moveToCart={moveToCart} />} />
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
