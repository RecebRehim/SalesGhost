import { scheduleRemotePush, touchCartUpdatedAt } from './remoteSync';

const CART_KEY = 'ecommerce_cart_data';

export const getCart = () => {
  try {
    const data = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const saveCart = (cart) => {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  touchCartUpdatedAt();
  scheduleRemotePush();
};
