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

  it('translates the fixed answers the server gives instead of internal details', () => {
    expect(translateServerError('Server error')).toContain('خطأ في الخادم');
    expect(translateServerError('Invalid request')).toContain('غير صالح');
    expect(translateServerError('Item 3 is invalid')).toBe('الصنف رقم 3 غير صالح');
    expect(translateServerError('Choose a city')).toBe('اختر مدينة الطلب');
    expect(translateServerError('This order has already been taken by another accountant')).toBe('سبقك محاسب آخر وأخذ هذا الطلب');
    expect(translateServerError('Order is completed and can no longer be changed')).toContain('مكتمل');
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
    expect(historyText('Marked urgent')).toBe('أصبح طلباً ضرورياً');
    expect(historyText('Online mark removed')).toBe('أُزيلت علامة «أونلاين»');
    expect(historyText('Desc: توصيل -> None')).toBe('حُذف الوصف');
    expect(historyText('Added takers: taker2, taker3')).toBe('أضاف مجهّزين للمساعدة: taker2، taker3');
    expect(historyText('Taken for accounting by acc1')).toBe('أخذه المحاسب acc1');
    expect(historyText('Sent back to the takers')).toBe('أُعيد الطلب للمجهّزين للتعديل');
    expect(historyText('City: جنين -> None')).toBe('المدينة: من «جنين» إلى «بدون»');
    expect(historyText('Status: completed -> in-progress')).toBe('الحالة: من «مكتمل» إلى «قيد التنفيذ»');
    expect(historyText('Desc: None -> توصيل صباحاً')).toBe('الوصف أصبح: «توصيل صباحاً»');
    expect(historyText('Updated طحينة: Price 12.5 -> 14')).toBe('طحينة: السعر من 12.5 إلى 14');
    expect(historyText('Updated سكر: Price None -> 4')).toBe('سكر: السعر من «بدون سعر» إلى 4');
    expect(historyText('Changed after it was entered into ERP')).toBe('عُدّل بعد إدخاله على ERP');
    expect(historyText('Status: entered_erp -> in-progress')).toBe('الحالة: من «تم الإدخال في ERP» إلى «قيد التنفيذ»');
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
    expect(notificationText('Order #12 is ready for an accountant: محمص')).toBe('الطلب #12 جاهز للمحاسبة: محمص');
    expect(notificationText('taker1 added you to order #5: مطعم')).toBe('أضافك taker1 لتجهيز الطلب #5: مطعم');
    expect(notificationText('Order #5: taker1 added taker2, taker3 to help')).toBe('الطلب #5: أضاف taker1 taker2، taker3 للمساعدة');
    expect(notificationText('Order #7 was sent back to you for changes by maker1')).toBe('أعاد maker1 إليك الطلب #7 للتعديل');
    expect(notificationText('Order #7 was sent back to the takers by maker1; it returns to you when completed'))
      .toBe('أعاد maker1 الطلب #7 للتجهيز، وسيعود إليك عند اكتماله');
    expect(notificationText('Order #9 was changed by maker1 after it was entered into ERP'))
      .toBe('عدّل maker1 الطلب #9 بعد إدخاله على ERP — التعديلات في سجل الطلب');
  });
});
