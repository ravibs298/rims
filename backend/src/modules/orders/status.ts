export type OrderStatus = 'reserved' | 'fulfilled' | 'shipped' | 'delivered' | 'cancelled';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  reserved: ['fulfilled', 'cancelled'], // only unfulfilled orders may be cancelled (reservations released)
  fulfilled: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from]?.includes(to) ?? false;
