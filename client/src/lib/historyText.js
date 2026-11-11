import { statusLabel } from './labels';

/**
 * The server stores order history and in-app notifications as short English
 * sentences (routes/orders.js, order_items.js, orders_taker.js). They are
 * translated here for display, so entries written before this existed read
 * in Arabic too. Unknown text is shown unchanged.
 */

const ITEM_STATUS = { collected: 'تم التجهيز', unavailable: 'غير متوفر', none: 'بدون حالة' };
const orNone = (s) => (!s || s === 'None' ? 'بدون' : s);
const price = (s) => (s === 'None' ? '«بدون سعر»' : s);

const HISTORY = [
  [/^Status: (\S+) -> (\S+)$/, (m) => `الحالة: من «${statusLabel(m[1])}» إلى «${statusLabel(m[2])}»`],
  [/^Title: (.*) -> (.*)$/s, (m) => `اسم الزبون: من «${orNone(m[1])}» إلى «${m[2]}»`],
  [/^City: (.*) -> (.*)$/, (m) => `المدينة: من «${orNone(m[1])}» إلى «${orNone(m[2])}»`],
  [/^Desc: (.*) -> (.*)$/s, (m) => (m[2] === 'None' ? 'حُذف الوصف' : `الوصف أصبح: «${m[2]}»`)],
  [/^Updated (.+): Qty (\S+) -> (\S+)$/, (m) => `${m[1]}: الكمية من ${m[2]} إلى ${m[3]}`],
  // Only the maker, accountant and admin get these: the server leaves them out for takers.
  [/^Updated (.+): Price (\S+) -> (\S+)$/, (m) => `${m[1]}: السعر من ${price(m[2])} إلى ${price(m[3])}`],
  [/^Changed after it was entered into ERP$/, () => 'عُدّل بعد إدخاله على ERP'],
  [/^Added: (.+) \(Qty: (\S+)\)$/, (m) => `إضافة صنف: ${m[1]} (الكمية ${m[2]})`],
  [/^Removed: (.+)$/, (m) => `حذف صنف: ${m[1]}`],
  [/^Updated Assigned Takers$/, () => 'تغيير المجهّزين'],
  [/^Opened to any taker$/, () => 'أصبح مفتوحاً لأي مجهّز'],
  [/^Taken by (.+)$/, (m) => `أخذه ${m[1]} من الطلبات المفتوحة`],
  [/^Marked online$/, () => 'أصبح طلباً أونلاين'],
  [/^Online mark removed$/, () => 'أُزيلت علامة «أونلاين»'],
  [/^Marked urgent$/, () => 'أصبح طلباً ضرورياً'],
  [/^Urgent mark removed$/, () => 'أُزيلت علامة «ضروري»'],
  [/^Added takers: (.+)$/, (m) => `أضاف مجهّزين للمساعدة: ${m[1].split(', ').join('، ')}`],
  [/^Taken for accounting by (.+)$/, (m) => `أخذه المحاسب ${m[1]}`],
  [/^Sent back to the takers$/, () => 'أُعيد الطلب للمجهّزين للتعديل'],
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
  [/^Order #(\d+) is ready for an accountant: (.*)$/s, (m) => `الطلب #${m[1]} جاهز للمحاسبة: ${m[2]}`],
  [/^Order #(\d+): (.+) added (.+) to help$/, (m) => `الطلب #${m[1]}: أضاف ${m[2]} ${m[3].split(', ').join('، ')} للمساعدة`],
  [/^Order #(\d+) was sent back to you for changes by (.+)$/, (m) => `أعاد ${m[2]} إليك الطلب #${m[1]} للتعديل`],
  [/^Order #(\d+) was sent back to the takers by (.+); it returns to you when completed$/, (m) => `أعاد ${m[2]} الطلب #${m[1]} للتجهيز، وسيعود إليك عند اكتماله`],
  [/^Order #(\d+) was changed by (.+) after it was entered into ERP$/, (m) => `عدّل ${m[2]} الطلب #${m[1]} بعد إدخاله على ERP — التعديلات في سجل الطلب`],
  [/^(.+) added you to order #(\d+): (.*)$/s, (m) => `أضافك ${m[1]} لتجهيز الطلب #${m[2]}: ${m[3]}`],
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
