import { describe, expect, it } from 'vitest';

import { translateServerError } from './serverErrors';
import { historyText, notificationText } from './historyText';

describe('translateServerError', () => {
  it('translates exact server messages', () => {
    expect(translateServerError('Invalid credentials')).toBe('اسم المستخدم أو كلمة المرور غير صحيحة');
    expect(translateServerError('This order has already been taken')).toBe('سبقك مجهّز آخر وأخذ هذا الطلب');
  });

  it('translates messages that carry a value, keeping the value', () => {
    expect(translateServerError('Duplicate item "سكر"')).toBe('الصنف «سكر» مكرر');
    expect(translateServerError('Invalid quantity for "زيت"')).toBe('الكمية غير صالحة للصنف «زيت»');
    expect(translateServerError('Order is completed and can no longer be changed')).toBe('الطلب أصبح «مكتمل» ولا يمكن تغييره');
    expect(translateServerError('Too many failed login attempts. Try again in 15 minutes.')).toContain('15');
  });

  it('leaves unknown text (and non-strings) alone', () => {
    expect(translateServerError('Something new')).toBe('Something new');
    expect(translateServerError(undefined)).toBe(undefined);
  });
});

describe('historyText', () => {
  it('translates status, quantity and item changes', () => {
    expect(historyText('Status: pending -> in-progress')).toBe('الحالة: من «قيد الانتظار» إلى «قيد التنفيذ»');
    expect(historyText('Updated طحينة: Qty 2 -> 3')).toBe('طحينة: الكمية من 2 إلى 3');
    expect(historyText('Added: سكر (Qty: 1.5)')).toBe('إضافة صنف: سكر (الكمية 1.5)');
    expect(historyText('Removed: أرز')).toBe('حذف صنف: أرز');
    expect(historyText('طحينة: collected')).toBe('طحينة: تم التجهيز');
    expect(historyText('زيت: none')).toBe('زيت: بدون حالة');
    expect(historyText('Taken by taker3')).toBe('أخذه taker3 من الطلبات المفتوحة');
  });

  it('keeps a customer name that itself contains a colon', () => {
    expect(historyText('Title: None -> شركة: النور')).toBe('اسم الزبون: من «بدون» إلى «شركة: النور»');
  });
});

describe('notificationText', () => {
  it('translates stored English notifications', () => {
    expect(notificationText('New Order Assigned: مطعم')).toBe('طلب جديد مُسند إليك: مطعم');
    expect(notificationText("Order #7 status updated to 'completed' by taker1")).toBe('غيّر taker1 حالة الطلب #7 إلى «مكتمل»');
    expect(notificationText('Order #9 was taken by taker2: بقالة')).toBe('أخذ taker2 الطلب المفتوح #9: بقالة');
  });
});
