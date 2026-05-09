import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

const fallbackImage = 'https://placehold.co/900x700/e2e8f0/334155?text=Tech+Product';

export const ProductBadge = ({ label }) => {
  const colorMap = {
    'Best Seller': 'bg-amber-100 text-amber-800',
    New: 'bg-emerald-100 text-emerald-800',
    Sale: 'bg-rose-100 text-rose-800',
    'Limited Stock': 'bg-orange-100 text-orange-800',
  };
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${colorMap[label] || 'bg-slate-100 text-slate-700'}`}>
      {label}
    </span>
  );
};

export const RatingStars = ({ rating }) => (
  <div className="text-amber-500">{'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}</div>
);

export const EmptyState = ({ title, description }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
    <h3 className="text-lg font-semibold">{title}</h3>
    <p className="mt-2 text-sm text-slate-600">{description}</p>
  </div>
);

export const Navbar = ({ cartCount, wishlistCount }) => {
  const [open, setOpen] = useState(false);
  const navItems = ['/', '/products', '/cart', '/wishlist', '/analytics', '/about'];
  const navLabels = ['Home', 'Products', `Cart (${cartCount})`, `Wishlist (${wishlistCount})`, 'Analytics', 'About'];

  return (
    <nav className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-black text-brand-700 sm:text-xl">
          <img
            src="/images/logo.jpeg"
            alt="SalesGhost logo"
            className="h-8 w-8 rounded-md object-cover"
          />
          <span>SalesGhost</span>
        </Link>

        <button
          type="button"
          className="rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 md:hidden"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
          aria-expanded={open}
        >
          Menu
        </button>

        <div className="hidden items-center gap-2 text-sm font-medium md:flex">
          {navItems.map((path, idx) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `rounded-lg px-3 py-2 ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              {navLabels[idx]}
            </NavLink>
          ))}
        </div>
      </div>

      {open && (
        <div className="border-t bg-white px-4 py-3 md:hidden">
          <div className="grid gap-2 text-sm font-medium">
            {navItems.map((path, idx) => (
              <NavLink
                key={path}
                to={path}
                onClick={() => setOpen(false)}
                className={({ isActive }) => `rounded-lg px-3 py-2 ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {navLabels[idx]}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};

export const SearchBar = ({ query, setQuery }) => (
  <input
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    placeholder="Search by name, brand, category, description, specs..."
    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 focus:border-brand-500 focus:outline-none"
  />
);

export const ProductCard = ({ product, onAddToCart }) => (
  <article className="overflow-hidden rounded-2xl border bg-white shadow-card transition hover:-translate-y-1">
    <img
      src={product.images[0]}
      alt={product.name}
      className="h-44 w-full object-cover"
      onError={(e) => { e.currentTarget.src = fallbackImage; }}
    />
    <div className="space-y-2 p-4">
      <div className="flex flex-wrap gap-1">{product.tags.slice(0, 2).map((tag) => <ProductBadge key={tag} label={tag} />)}</div>
      <h3 className="font-semibold">{product.name}</h3>
      <p className="text-sm text-slate-500">{product.brand} • {product.category}</p>
      <p className="text-sm text-slate-600">{product.description}</p>
      <RatingStars rating={product.rating} />
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-brand-700">${product.discountPrice}</span>
        <span className="text-sm text-slate-400 line-through">${product.price}</span>
      </div>
      <p className={`text-xs font-semibold ${product.stock < 10 ? 'text-orange-600' : 'text-emerald-600'}`}>
        {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onAddToCart(product)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Add to Cart</button>
        <Link to={`/products/${product.id}`} className="rounded-lg border px-3 py-2 text-center text-sm font-semibold hover:bg-slate-50">View Details</Link>
      </div>
      <Link to="/cart" className="block rounded-lg border px-3 py-2 text-center text-sm font-semibold hover:bg-slate-50">View Cart</Link>
    </div>
  </article>
);

export const CategoryCard = ({ name }) => (
  <Link to={`/products?category=${encodeURIComponent(name)}`} className="rounded-xl border bg-white p-4 font-semibold hover:border-brand-500">
    {name}
  </Link>
);

export const ProductSort = ({ value, onChange }) => (
  <select className="rounded-lg border bg-white px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="popularity">Sort: Popularity</option>
    <option value="priceAsc">Price: Low to High</option>
    <option value="priceDesc">Price: High to Low</option>
    <option value="rating">Rating</option>
    <option value="newest">Newest</option>
    <option value="discount">Biggest Discount</option>
  </select>
);

export const ConsentBanner = ({ status, onChoice }) =>
  status === 'unset' ? (
    <div className="fixed bottom-3 left-1/2 z-50 w-[95%] max-w-3xl -translate-x-1/2 rounded-xl border bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
      <p className="text-sm text-slate-700">This hackathon demo tracks mock behavior locally in your browser for analytics. You can disable tracking anytime.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => onChoice('accepted')}>Accept Tracking</button>
        <button className="rounded-lg border px-4 py-2 text-sm font-semibold" onClick={() => onChoice('disabled')}>Disable Tracking</button>
      </div>
    </div>
  ) : null;

export const EventTable = ({ events }) => (
  <div className="overflow-x-auto rounded-xl border bg-white">
    <table className="min-w-full text-sm">
      <thead className="bg-slate-100">
        <tr>
          {['Type', 'Time', 'Product', 'Query', 'Page'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.eventId} className="border-t">
            <td className="px-3 py-2 font-medium">{event.eventType}</td>
            <td className="px-3 py-2">{new Date(event.timestamp).toLocaleString()}</td>
            <td className="px-3 py-2">{event.productName || '-'}</td>
            <td className="px-3 py-2">{event.searchQuery || '-'}</td>
            <td className="px-3 py-2">{event.page}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const ProductGrid = ({ products, onAddToCart }) => (
  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    {products.map((product) => <ProductCard key={product.id} product={product} onAddToCart={onAddToCart} />)}
  </div>
);

export const ProductFilters = ({ children }) => (
  <aside className="h-fit space-y-3 rounded-xl border bg-white p-4">
    <h2 className="text-lg font-bold">Filters</h2>
    {children}
  </aside>
);

export const ImageGallery = ({ images, productName, selectedImage, onSelect }) => (
  <div className="space-y-3">
    <img src={images[selectedImage]} onError={(e) => { e.currentTarget.src = fallbackImage; }} className="h-96 w-full rounded-2xl object-cover" alt={productName} />
    <div className="grid grid-cols-3 gap-3">
      {images.map((image, idx) => (
        <button key={image} onClick={() => onSelect(idx)} className="overflow-hidden rounded-lg border">
          <img src={image} className="h-20 w-full object-cover" alt={`${productName}-${idx}`} />
        </button>
      ))}
    </div>
  </div>
);
