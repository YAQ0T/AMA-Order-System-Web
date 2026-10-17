import { CURRENCY } from './labels';

/**
 * Arabic-Indic and Persian digits -> ASCII, plus the Arabic decimal separators.
 * In an Arabic-first UI users type these constantly, so every numeric input
 * runs through here before parsing.
 *
 * Ported from _normalizeDigits in the Flutter app, where it was duplicated in
 * order_form.dart and taker_dashboard.dart.
 */
const DIGIT_MAP = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeDigits(input) {
  if (input === null || input === undefined) return '';
  let out = '';
  for (const ch of String(input)) {
    out += DIGIT_MAP[ch] ?? ch;
  }
  // Arabic decimal separator (٫), thousands separator (٬), comma (،) -> '.'
  return out.replace(/[,٫٬،]/g, '.');
}

/** Parse a user-typed number, tolerating Arabic digits. Returns null if invalid. */
export function parseNumber(input) {
  const normalized = normalizeDigits(input).trim();
  if (normalized === '') return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** 1 -> "1", 1.5 -> "1.5" (matches the Flutter _formatQuantity). */
export function formatQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n % 1 === 0 ? String(Math.trunc(n)) : String(n);
}

export function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${CURRENCY} ${n.toFixed(2)}`;
}

export function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toFixed(2);
}

/** Gregorian dates with Western digits - deliberately not Hijri. */
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDateTime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return dateTimeFmt.format(d);
}

export function formatDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFmt.format(d);
}

/** yyyy-mm-dd for <input type="date"> values. */
export function toDateInputValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Line total for an order item, guarding against price arriving as a string. */
export function lineTotal(item) {
  const price = Number(item?.price) || 0;
  const qty = Number(item?.quantity) || 0;
  return price * qty;
}

export function orderTotal(order) {
  return (order?.Items || []).reduce((sum, item) => sum + lineTotal(item), 0);
}

export function orderTitle(order) {
  const title = (order?.title || '').trim();
  return title || `طلب #${order?.id ?? ''}`;
}
