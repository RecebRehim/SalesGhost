import { scheduleRemotePush } from './remoteSync';

const WISHLIST_KEY = 'ecommerce_wishlist_data';

export const getWishlist = () => {
  try {
    const data = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const saveWishlist = (wishlist) => {
  localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
  scheduleRemotePush();
};
