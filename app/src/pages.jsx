import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { brands, categories, products } from './data/products';
import { trackEvent, getEvents, computeAnalytics, clearEvents, generateDemoEvents } from './utils/analytics';
import { CategoryCard, EmptyState, EventTable, ProductCard, ProductSort, RatingStars, SearchBar, ProductBadge } from './components/ui';
import {
  addNotification,
  clearAllNotifications,
  getDb,
  getHardcodedUser,
  getN8nWebhookUrl,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setN8nWebhookUrl,
} from './utils/database';
import {
  CART_UPDATED_AT_KEY,
  WISHLIST_UPDATED_AT_KEY,
  isRemoteSyncConfigured,
  onRemoteSyncReady,
  pullRemoteAndMerge,
  scheduleRemotePush,
} from './utils/remoteSync';

const currency = (amount) => `$${amount.toFixed(2)}`;

export const HomePage = ({ onAddToCart }) => {
  useEffect(() => {
    trackEvent('PAGE_VIEW', { page: '/' });
  }, []);
  const featured = products.slice(0, 4);
  const trending = [...products].sort((a, b) => b.popularityScore - a.popularityScore).slice(0, 4);
  const deals = [...products].sort((a, b) => (b.price - b.discountPrice) - (a.price - a.discountPrice)).slice(0, 4);
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:space-y-10 sm:py-8">
      <section className="rounded-3xl bg-gradient-to-r from-brand-900 to-brand-600 p-5 text-white sm:p-8">
        <p className="text-sm uppercase tracking-widest text-brand-100">SalesGhost Hackathon Demo</p>
        <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">Tech products with built-in behavior analytics</h1>
        <p className="mt-3 max-w-2xl text-brand-100">Browse a realistic ecommerce experience and capture mock user interactions for your data storytelling demo.</p>
        <Link to="/products" className="mt-6 inline-block rounded-lg bg-white px-4 py-2 font-semibold text-brand-700">Explore Products</Link>
      </section>
      <section><h2 className="mb-4 text-2xl font-bold">Featured Categories</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{categories.map((name) => <CategoryCard key={name} name={name} />)}</div></section>
      {[
        ['Featured Products', featured],
        ['Trending Products', trending],
        ['Deals', deals],
      ].map(([title, list]) => (
        <section key={title}><h2 className="mb-4 text-2xl font-bold">{title}</h2><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{list.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}</div></section>
      ))}
    </div>
  );
};

export const ProductsPage = ({ onAddToCart }) => {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [sort, setSort] = useState('popularity');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [discountOnly, setDiscountOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [maxPrice, setMaxPrice] = useState(2500);
  const [searchMode, setSearchMode] = useState('smart');
  const [minSearchScore, setMinSearchScore] = useState(10);
  const [searchIn, setSearchIn] = useState({
    name: true,
    brand: true,
    category: true,
    description: true,
    specs: true,
    tags: true,
  });

  useEffect(() => {
    trackEvent('PAGE_VIEW', { page: '/products' });
  }, []);
  useEffect(() => { if (query.trim()) trackEvent('SEARCH', { searchQuery: query.trim(), metadata: { length: query.length } }); }, [query]);
  useEffect(() => {
    trackEvent('FILTER_APPLIED', {
      metadata: {
        selectedCategory,
        selectedBrand,
        inStockOnly,
        discountOnly,
        minRating,
        maxPrice,
        searchMode,
        minSearchScore,
        searchIn,
      },
    });
  }, [selectedCategory, selectedBrand, inStockOnly, discountOnly, minRating, maxPrice, searchMode, minSearchScore, searchIn]);
  useEffect(() => {
    trackEvent('SORT_CHANGED', { metadata: { sort } });
  }, [sort]);

  const getWeightedSearchScore = (product, keyword) => {
    if (!keyword) return 100;
    const tokens = keyword
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!tokens.length) return 100;

    const fields = {
      name: String(product.name || '').toLowerCase(),
      brand: String(product.brand || '').toLowerCase(),
      category: String(product.category || '').toLowerCase(),
      description: String(`${product.description || ''} ${product.longDescription || ''}`).toLowerCase(),
      specs: Object.values(product.specs || {}).join(' ').toLowerCase(),
      tags: (product.tags || []).join(' ').toLowerCase(),
    };

    const weight = {
      name: 30,
      brand: 20,
      category: 16,
      description: 10,
      specs: 14,
      tags: 12,
    };

    let score = 0;
    const activeFields = Object.keys(searchIn).filter((key) => searchIn[key]);
    for (const token of tokens) {
      for (const field of activeFields) {
        const value = fields[field];
        if (!value) continue;
        if (searchMode === 'exact') {
          if (value.includes(token)) score += weight[field];
          continue;
        }
        if (value === token) score += weight[field] + 12;
        if (value.startsWith(token)) score += weight[field] + 8;
        if (value.includes(` ${token}`) || value.includes(`${token} `)) score += weight[field] + 5;
        if (value.includes(token)) score += weight[field];
        if (token.length >= 4 && [...value].some((_, i) => value.slice(i, i + token.length - 1) === token.slice(0, -1))) {
          score += Math.floor(weight[field] / 2);
        }
      }
    }

    return score;
  };

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products
      .filter((product) => selectedCategory === 'all' || product.category === selectedCategory)
      .filter((product) => selectedBrand === 'all' || product.brand === selectedBrand)
      .filter((product) => product.discountPrice <= maxPrice)
      .filter((product) => product.rating >= minRating)
      .filter((product) => !inStockOnly || product.stock > 0)
      .filter((product) => !discountOnly || product.discountPrice < product.price)
      .map((product) => ({ ...product, searchScore: getWeightedSearchScore(product, keyword) }))
      .filter((product) => !keyword || product.searchScore >= minSearchScore)
      .sort((a, b) => {
        if (keyword && sort === 'popularity') return b.searchScore - a.searchScore || b.popularityScore - a.popularityScore;
        if (sort === 'priceAsc') return a.discountPrice - b.discountPrice;
        if (sort === 'priceDesc') return b.discountPrice - a.discountPrice;
        if (sort === 'rating') return b.rating - a.rating;
        if (sort === 'newest') return b.releaseYear - a.releaseYear;
        if (sort === 'discount') return (b.price - b.discountPrice) - (a.price - a.discountPrice);
        return b.popularityScore - a.popularityScore;
      });
  }, [discountOnly, inStockOnly, maxPrice, minRating, query, selectedBrand, selectedCategory, sort, searchMode, minSearchScore, searchIn]);

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[300px_1fr] lg:py-8">
      <aside className="h-fit space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-lg font-bold">Filters</h2>
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-800">Advanced Search</p>
          <p className="mt-1 text-xs text-brand-700">Weighted relevance search with field controls.</p>
        </div>
        <SearchBar query={query} setQuery={setQuery} />
        <select value={searchMode} onChange={(e) => setSearchMode(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm">
          <option value="smart">Search mode: Smart (recommended)</option>
          <option value="exact">Search mode: Exact keyword</option>
        </select>
        <label className="block text-sm">
          Minimum search score: {minSearchScore}
          <input type="range" min="0" max="60" step="2" value={minSearchScore} onChange={(e) => setMinSearchScore(Number(e.target.value))} className="w-full" />
        </label>
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-semibold">Search In</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.keys(searchIn).map((field) => (
              <label key={field} className="flex items-center gap-2 capitalize">
                <input
                  type="checkbox"
                  checked={searchIn[field]}
                  onChange={(e) =>
                    setSearchIn((prev) => ({ ...prev, [field]: e.target.checked }))
                  }
                />
                {field}
              </label>
            ))}
          </div>
        </div>
        <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full rounded-lg border px-3 py-2"><option value="all">All Categories</option>{categories.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={selectedBrand} onChange={(e) => setSelectedBrand(e.target.value)} className="w-full rounded-lg border px-3 py-2"><option value="all">All Brands</option>{brands.map((x) => <option key={x}>{x}</option>)}</select>
        <label className="block text-sm">Max price: {currency(maxPrice)}<input type="range" min="50" max="2500" step="50" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-full" /></label>
        <label className="block text-sm">Minimum rating: {minRating}<input type="range" min="0" max="5" step="0.5" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} className="w-full" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} /> In stock only</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={discountOnly} onChange={(e) => setDiscountOnly(e.target.checked)} /> Discount only</label>
      </aside>
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">Products ({filtered.length})</h1>
          <ProductSort value={sort} onChange={setSort} />
        </div>
        {filtered.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}</div>
        ) : <EmptyState title="No products found" description="Try widening your filters, lowering minimum rating, or changing keywords." />}
      </section>
    </div>
  );
};

export const ProductDetailPage = ({ onAddToCart, onWishlist, onBuyNow }) => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const product = products.find((item) => item.id === productId);
  const [selectedImage, setSelectedImage] = useState(0);
  const [showReviews, setShowReviews] = useState(false);

  useEffect(() => {
    if (!product) return;
    trackEvent('PAGE_VIEW', { page: `/products/${product.id}` });
    trackEvent('PRODUCT_VIEW', { productId: product.id, productName: product.name, category: product.category });
  }, [product]);
  if (!product) return <div className="mx-auto max-w-7xl px-4 py-8"><EmptyState title="Product not found" description="The selected product is missing." /></div>;

  const similar = products.filter((item) => item.category === product.category && item.id !== product.id).slice(0, 4);

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 lg:grid-cols-2 lg:py-8">
      <section className="space-y-3">
        <img src={product.images[selectedImage]} onError={(e) => { e.currentTarget.src = 'https://placehold.co/900x700/e2e8f0/334155?text=Tech+Product'; }} className="h-72 w-full rounded-2xl object-cover sm:h-96" alt={product.name} />
        <div className="grid grid-cols-3 gap-3">{product.images.map((image, idx) => <button key={image} onClick={() => { setSelectedImage(idx); trackEvent('IMAGE_GALLERY_CLICKED', { productId: product.id, productName: product.name, metadata: { imageIndex: idx } }); }} className="overflow-hidden rounded-lg border"><img src={image} className="h-20 w-full object-cover" alt={`${product.name}-${idx}`} /></button>)}</div>
      </section>
      <section className="space-y-4">
        <div className="flex gap-2">{product.tags.map((tag) => <ProductBadge key={tag} label={tag} />)}</div>
        <h1 className="text-2xl font-bold sm:text-3xl">{product.name}</h1>
        <p className="text-slate-600">{product.longDescription}</p>
        <p className="text-sm text-slate-500">{product.brand} • {product.model} • {product.sku}</p>
        <RatingStars rating={product.rating} />
        <div className="flex flex-wrap items-end gap-2"><span className="text-3xl font-black text-brand-700">{currency(product.discountPrice)}</span><span className="text-slate-400 line-through">{currency(product.price)}</span></div>
        <p className={`font-semibold ${product.stock < 10 ? 'text-orange-600' : 'text-emerald-600'}`}>{product.stock > 0 ? `Only ${product.stock} left` : 'Out of stock'}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onAddToCart(product)} className="rounded-lg bg-brand-600 px-4 py-2 text-white">Add to Cart</button>
          <button onClick={() => { onBuyNow(product); navigate('/checkout'); }} className="rounded-lg bg-slate-900 px-4 py-2 text-white">Buy Now</button>
          <button onClick={() => onWishlist(product)} className="rounded-lg border px-4 py-2">Wishlist</button>
        </div>
        <div className="rounded-xl border bg-white p-4"><h3 className="font-bold">Technical Specs</h3>{Object.entries(product.specs).map(([key, value]) => <p key={key} className="text-sm capitalize text-slate-600">{key}: {value}</p>)}</div>
        <button className="text-sm font-semibold text-brand-700 underline" onClick={() => { setShowReviews((prev) => !prev); trackEvent('PRODUCT_REVIEW_EXPANDED', { productId: product.id, productName: product.name, metadata: { expanded: !showReviews } }); }}>{showReviews ? 'Hide Reviews' : 'Show Reviews'}</button>
        {showReviews && <p className="rounded-lg bg-slate-100 p-3 text-sm">Rated {product.rating} by {product.reviewCount} reviewers. Customers praise value, performance, and reliability.</p>}
        <div className="space-y-2"><h3 className="font-bold">Similar Products</h3><div className="grid gap-3 md:grid-cols-2">{similar.map((item) => <button key={item.id} onClick={() => { trackEvent('SIMILAR_PRODUCT_CLICKED', { productId: item.id, productName: item.name, category: item.category, metadata: { from: product.id } }); navigate(`/products/${item.id}`); }} className="rounded-lg border bg-white p-3 text-left hover:border-brand-500">{item.name}</button>)}</div></div>
      </section>
    </div>
  );
};

export const CartPage = ({ cart, updateQty, removeItem }) => {
  useEffect(() => {
    trackEvent('PAGE_VIEW', { page: '/cart' });
  }, []);
  const subtotal = cart.reduce((sum, item) => sum + item.discountPrice * item.quantity, 0);
  const tax = subtotal * 0.08;
  const shipping = subtotal > 0 ? 14.99 : 0;
  if (!cart.length) return <div className="mx-auto max-w-5xl px-4 py-8"><EmptyState title="Your cart is empty" description="Add products to continue to checkout." /></div>;
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      {cart.map((item) => (
        <div key={item.id} className="grid items-center gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_auto_auto_auto]">
          <div><p className="font-semibold">{item.name}</p><p className="text-sm text-slate-500">{item.brand}</p></div>
          <p className="font-semibold">{currency(item.discountPrice)}</p>
          <div className="flex items-center gap-2"><button className="rounded border px-2" onClick={() => updateQty(item.id, Math.max(1, item.quantity - 1))}>-</button><span>{item.quantity}</span><button className="rounded border px-2" onClick={() => updateQty(item.id, item.quantity + 1)}>+</button></div>
          <button className="rounded-lg border px-3 py-1 text-sm hover:bg-slate-50" onClick={() => removeItem(item.id)}>Remove</button>
        </div>
      ))}
      <div className="rounded-xl border bg-white p-4">
        <p>Subtotal: <b>{currency(subtotal)}</b></p>
        <p>Estimated Tax: <b>{currency(tax)}</b></p>
        <p>Shipping: <b>{currency(shipping)}</b></p>
        <p className="mt-2 text-lg font-bold">Total: {currency(subtotal + tax + shipping)}</p>
        <Link to="/checkout" className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white">Checkout</Link>
      </div>
    </div>
  );
};

export const WishlistPage = ({ wishlist, removeWishlistItem, moveToCart }) => {
  useEffect(() => {
    trackEvent('PAGE_VIEW', { page: '/wishlist' });
  }, []);

  if (!wishlist.length) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <EmptyState title="Your wishlist is empty" description="Save products here, then review your wishlist and move items to cart." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-bold">Review Wishlist ({wishlist.length})</h1>
      {wishlist.map((item) => (
        <div key={item.id} className="grid items-center gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_auto_auto]">
          <div>
            <p className="font-semibold">{item.name}</p>
            <p className="text-sm text-slate-500">{item.brand} • {item.category}</p>
          </div>
          <button className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => moveToCart(item)}>Move to Cart</button>
          <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => removeWishlistItem(item.id)}>Remove</button>
        </div>
      ))}
    </div>
  );
};

export const NotificationsPage = ({ notifications, refreshNotifications }) => {
  const [webhookUrl, setWebhookUrlState] = useState(getN8nWebhookUrl());
  const [dbSummary, setDbSummary] = useState(() => getDb());
  const [syncStatus, setSyncStatus] = useState('');
  const unread = notifications.filter((item) => !item.read).length;
  const hardcodedUser = getHardcodedUser();

  useEffect(() => {
    trackEvent('PAGE_VIEW', { page: '/notifications' });
  }, []);

  useEffect(() => {
    const unsub = onRemoteSyncReady(() => {
      setDbSummary(getDb());
      refreshNotifications();
    });
    return unsub;
  }, [refreshNotifications]);

  const saveWebhook = () => {
    setN8nWebhookUrl(webhookUrl.trim());
    refreshNotifications();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <h1 className="text-2xl font-bold">Notifications ({unread} unread)</h1>
      <div className={`rounded-xl border p-4 ${isRemoteSyncConfigured() ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className="text-sm font-semibold">{isRemoteSyncConfigured() ? 'Cloud sync enabled (Supabase)' : 'Cloud sync not configured'}</p>
        <p className="mt-1 text-sm text-slate-700">
          {isRemoteSyncConfigured()
            ? 'Analytics and mock DB sync to Supabase so n8n and other devices see the same default account data.'
            : 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see app/.env.example and app/supabase-schema.sql).'}
        </p>
        {syncStatus && <p className="mt-2 text-xs text-slate-600">{syncStatus}</p>}
        <button
          type="button"
          className="mt-3 rounded-lg border bg-white px-3 py-2 text-sm font-semibold"
          onClick={async () => {
            const result = await pullRemoteAndMerge();
            setSyncStatus(JSON.stringify(result));
            setDbSummary(getDb());
            refreshNotifications();
          }}
        >
          Pull latest from cloud now
        </button>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <p className="text-sm text-slate-600">Hardcoded user email for n8n outreach</p>
        <p className="font-semibold">{hardcodedUser.email}</p>
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-semibold">n8n webhook URL (optional)</label>
          <input
            value={webhookUrl}
            onChange={(event) => setWebhookUrlState(event.target.value)}
            placeholder="https://your-n8n-domain/webhook/salesghost-events"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <button className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white" onClick={saveWebhook}>Save n8n Endpoint</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">DB Events</p><p className="text-2xl font-black">{dbSummary.events.length}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">DB Sessions</p><p className="text-2xl font-black">{dbSummary.sessions.length}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">DB Notifications</p><p className="text-2xl font-black">{dbSummary.notifications.length}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
          type="button"
          onClick={() => {
            if (!window.confirm('Delete all notifications and chat (n8n) messages? This clears local data and syncs to the cloud.')) return;
            clearAllNotifications();
            setDbSummary(getDb());
            refreshNotifications();
          }}
        >
          Delete all messages & notifications
        </button>
        <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => { markAllNotificationsRead(); refreshNotifications(); }}>Mark All as Read</button>
        <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => { addNotification({ title: 'Demo n8n Alert', message: 'We detected high intent behavior. Follow up with personalized offer.', channel: 'website', metadata: { source: 'manual-demo' } }); refreshNotifications(); }}>Create Demo Notification</button>
        <button
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
          onClick={() => {
            addNotification({
              title: 'Test Notification Sound',
              message: 'This is a test alert for website audio + visual notification.',
              channel: 'website',
              metadata: { source: 'audio-test' },
            });
            refreshNotifications();
          }}
        >
          Send Test Notification (Sound)
        </button>
      </div>

      {!notifications.length ? (
        <EmptyState title="No notifications yet" description="n8n can push engagement messages here for the website user." />
      ) : (
        <div className="space-y-3">
          {notifications.map((item) => (
            <article key={item.id} className={`rounded-xl border p-4 ${item.read ? 'bg-white' : 'bg-brand-50/70 border-brand-200'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm text-slate-600">{item.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} • via {item.channel}</p>
                </div>
                {!item.read && (
                  <button className="rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => { markNotificationRead(item.id); refreshNotifications(); }}>
                    Mark as read
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export const CheckoutPage = ({ cart, clearCart }) => {
  const navigate = useNavigate();
  const [completed, setCompleted] = useState(false);
  useEffect(() => { trackEvent('PAGE_VIEW', { page: '/checkout' }); trackEvent('CHECKOUT_STARTED', { metadata: { cartSize: cart.length } }); }, [cart.length]);
  useEffect(() => () => { if (!completed) trackEvent('CHECKOUT_ABANDONED', { metadata: { cartSize: cart.length } }); }, [cart.length, completed]);

  const submit = (event) => {
    event.preventDefault();
    trackEvent('PURCHASE_COMPLETED', { metadata: { cartSize: cart.length, productIds: cart.map((item) => item.id), totalAmount: cart.reduce((sum, item) => sum + item.discountPrice * item.quantity, 0) } });
    setCompleted(true);
    clearCart();
    navigate('/success');
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-4 sm:p-5">
        <h1 className="text-2xl font-bold">Mock Checkout</h1>
        {['Name', 'Email', 'Address'].map((field) => <input key={field} required placeholder={field} className="w-full rounded-lg border px-3 py-2" />)}
        <select required className="w-full rounded-lg border px-3 py-2"><option value="">Select payment method</option><option>Credit Card</option><option>PayPal</option><option>Cash on Delivery</option></select>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-white">Place Order</button>
      </form>
    </div>
  );
};

export const SuccessPage = () => (
  <div className="mx-auto max-w-xl px-4 py-16 text-center">
    <h1 className="text-3xl font-black text-emerald-600">Order placed successfully!</h1>
    <p className="mt-3 text-slate-600">This was a mock purchase for demo analytics. No payment was processed.</p>
    <Link to="/products" className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-white">Continue Shopping</Link>
  </div>
);

const MetricCard = ({ label, value }) => <div className="rounded-xl border bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-black">{value}</p></div>;

export const AnalyticsPage = () => {
  const [events, setEvents] = useState(getEvents());
  useEffect(() => {
    trackEvent('PAGE_VIEW', { page: '/analytics' });
  }, []);
  useEffect(() => {
    const unsub = onRemoteSyncReady(() => setEvents(getEvents()));
    return unsub;
  }, []);
  const stats = useMemo(() => computeAnalytics(events), [events]);

  const refresh = () => setEvents(getEvents());
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ecommerce-analytics.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 lg:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"><h1 className="text-2xl font-bold">Analytics Dashboard</h1><div className="flex flex-wrap gap-2"><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => { generateDemoEvents(products); refresh(); }}>Demo Mode</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={refresh}>Refresh</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={exportJson}>Export JSON</button><button className="rounded-lg border px-3 py-2 text-sm text-rose-700" onClick={() => { clearEvents(); refresh(); }}>Clear Analytics</button><button className="rounded-lg border px-3 py-2 text-sm text-rose-700" onClick={() => { clearEvents(); localStorage.removeItem('ecommerce_cart_data'); localStorage.removeItem('ecommerce_wishlist_data'); localStorage.removeItem(CART_UPDATED_AT_KEY); localStorage.removeItem(WISHLIST_UPDATED_AT_KEY); localStorage.removeItem('ecommerce_mock_database'); scheduleRemotePush(); refresh(); }}>Reset Demo Data</button></div></div>
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total Events" value={stats.totalEvents} />
        <MetricCard label="Product Views" value={stats.totalProductViews} />
        <MetricCard label="Searches" value={stats.totalSearches} />
        <MetricCard label="Add to Cart" value={stats.totalAddToCart} />
        <MetricCard label="Wishlist Adds" value={stats.totalWishlistAdds} />
        <MetricCard label="Purchases" value={stats.totalPurchases} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Cart Abandonment" value={stats.cartAbandonmentCount} />
        <MetricCard label="Viewed Not Purchased" value={stats.viewedNotPurchasedCount} />
        <MetricCard label="Conversion Rate" value={`${stats.conversionRate.toFixed(1)}%`} />
        <MetricCard label="Search to Cart" value={`${stats.searchToCartRate.toFixed(1)}%`} />
        <MetricCard label="View to Purchase" value={`${stats.viewToPurchaseRate.toFixed(1)}%`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {[['Top Searches', stats.topSearchTerms], ['Top Viewed Products', stats.topViewedProducts], ['Top Cart Products', stats.topCartProducts]].map(([title, rows]) => <div key={title} className="rounded-xl border bg-white p-4"><h3 className="mb-2 font-bold">{title}</h3>{rows.length ? rows.map(([label, count]) => <p key={label} className="text-sm">{label}: <b>{count}</b></p>) : <p className="text-sm text-slate-500">No data yet.</p>}</div>)}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <h3 className="mb-2 font-bold">Funnel Summary</h3>
        <div className="grid gap-2 md:grid-cols-4">
          <MetricCard label="Product Views" value={stats.funnel.views} />
          <MetricCard label="Add To Cart" value={stats.funnel.cart} />
          <MetricCard label="Checkout Started" value={stats.funnel.checkout} />
          <MetricCard label="Purchase Completed" value={stats.funnel.purchase} />
        </div>
      </div>
      <h3 className="text-xl font-bold">Recent Events</h3>
      <EventTable events={stats.recentEvents} />
    </div>
  );
};

export const AboutPage = () => (
  <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
    <h1 className="text-3xl font-black">About This Demo</h1>
    <p>This ecommerce site is intentionally built for hackathon presentations focused on product browsing and user-behavior analytics.</p>
    <p>Behavior events and cart data are cached in your browser. With Supabase env vars configured, the same default account syncs to the cloud so other devices and n8n workflows can use one shared dataset.</p>
    <p>No real payment processing.</p>
  </div>
);
