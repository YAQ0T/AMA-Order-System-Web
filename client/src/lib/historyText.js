import { statusLabel } from './labels';

/**
 * The server stores order history and in-app notifications as short English
 * sentences (routes/orders.js, order_items.js, orders_taker.js). They are
 * translated here for display, so entries written before this existed read
 * in Arabic too. Unknown text is shown unchanged.
 */

const ITEM_STATUS = { collected: 'تم التجهيز', unavailable: 'غير متوفر', none: 'بدون حالة' };
const orNone = (s) => (!s || s === 'None' ? 'بدون' : s);

const HISTORY = [
  [/^Status: (\S+) -> (\S+)$/, (m) => `الحالة: من «${statusLabel(m[1])}» إلى «${statusLabel(m[2])}»`],
  [/^Title: (.*) -> (.*)$/s, (m) => `اسم الزبون: من «${orNone(m[1])}» إلى «${m[2]}»`],
  [/^City: (.*) -> (.*)$/, (m) => `المدينة: من «${orNone(m[1])}» إلى «${m[2]}»`],
  [/^Desc: (.*) -> (.*)$/s, (m) => `الوصف أصبح: «${m[2]}»`],
  [/^Updated (.+): Qty (\S+) -> (\S+)$/, (m) => `${m[1]}: الكمية من ${m[2]} إلى ${m[3]}`],
  [/^Added: (.+) \(Qty: (\S+)\)$/, (m) => `إضافة صنف: ${m[1]} (الكمية ${m[2]})`],
  [/^Removed: (.+)$/, (m) => `حذف صنف: ${m[1]}`],
  [/^Updated Assigned Takers$/, () => 'تغيير المجهّزين'],
  [/^Opened to any taker$/, () => 'أصبح مفتوحاً لأي مجهّز'],
  [/^Taken by (.+)$/, (m) => `أخذه ${m[1]} من الطلبات المفتوحة`],
  // Item status changes: "<item name>: collected". Last, because it is the loosest.
  [/^(.+): (collected|unavailable|none)$/, (m) => `${m[1]}: ${ITEM_STATUS[m[2]]}`],
];

const NOTIFICATIONS = [
  [/^New Order Assigned: (.*)$/s, (m) => `طلب جديد مُسند إليك: ${m[1]}`],
  [/^You have been assigned to order #(\d+): (.*)$/s, (m) => `أُسند إليك الطلب #${m[1]}: ${m[2]}`],
  [/^Order #(\d+) status updated to '(.+)' by (.+)$/, (m) => `غيّر ${m[3]} حالة الطلب #${m[1]} إلى «${statusLabel(m[2])}»`],
  [/^New completed order ready for review: Order #(\d+) - (.*)$/s, (m) => `طلب مكتمل جاهز للإدخال على ERP: #${m[1]} - ${m[2]}`],
  [/^Order #(\d+) was updated by Maker$/, (m) => `عدّل منشئ الطلبات الطلب #${m[1]}`],
  [/^Order #(\d+) details updated by (.+)$/, (m) => `عدّل ${m[2]} تفاصيل الطلب #${m[1]}`],
  [/^Order #(\d+) was taken by ([^:]+): (.*)$/s, (m) => `أخذ ${m[2]} الطلب المفتوح #${m[1]}: ${m[3]}`],
];

function translate(rules, text) {
  if (typeof text !== 'string') return text;
  for (const [re, make] of rules) {
    const m = re.exec(text);
    if (m) return make(m);
  }
  return text;
}

export const historyText = (description) => translate(HISTORY, description);
export const notificationText = (message) => translate(NOTIFICATIONS, message);
