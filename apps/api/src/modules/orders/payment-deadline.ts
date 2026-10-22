// Dates represent UTC instants; elapsed payment time never depends on session timezone.
export const PAYMENT_WINDOW_MS = 15 * 60_000;

export function paymentDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PAYMENT_WINDOW_MS);
}

// Keep shorter historical deadlines, and cap legacy defaults polluted by session timezone.
export function effectivePaymentDeadline(order: {createdAt: Date; paymentExpiresAt: Date}): Date {
  return new Date(Math.min(order.paymentExpiresAt.getTime(), paymentDeadline(order.createdAt).getTime()));
}
