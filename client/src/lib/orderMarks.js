/**
 * The colour of an order's card: urgent (the admin's orders) red, online
 * orders blue - a thick stripe on the card's start edge plus a light tint.
 * Urgent wins when an order is both; both labels still show.
 */
export function markClasses(order) {
  if (order?.isUrgent) return 'border-s-4 border-s-red-500 bg-red-50/50 dark:border-s-red-500 dark:bg-red-500/5';
  if (order?.isOnline) return 'border-s-4 border-s-sky-500 bg-sky-50/50 dark:border-s-sky-400 dark:bg-sky-500/5';
  return '';
}
