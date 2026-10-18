import { statusLabel } from './labels';

/**
 * The server answers in English (its messages also go to logs and to the
 * Flutter app). Everything a person sees is Arabic, so known messages are
 * translated here, in one place, as the response arrives (api/client.js).
 * Anything not listed is shown as the server sent it.
 */
const EXACT = {
  // Login and accounts
  'Invalid credentials': 'اسم المستخدم أو كلمة المرور غير صحيحة',
  'Account pending admin approval': 'الحساب بانتظار موافقة المدير',
  'This account has been deactivated': 'تم تعطيل هذا الحساب. تواصل مع المدير.',
  'This account no longer exists': 'هذا الحساب لم يعد موجوداً',
  'Not logged in': 'يجب تسجيل الدخول',
  'Session expired, please log in again': 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
  'Your password was changed, please log in again': 'تم تغيير كلمة المرور، يرجى تسجيل الدخول من جديد',
  'Cannot check the session right now': 'تعذّر التحقق من الجلسة الآن، حاول بعد قليل',
  'Username already taken': 'اسم المستخدم مستخدم من قبل',
  'Username must be 3-40 characters': 'اسم المستخدم يجب أن يكون من 3 إلى 40 حرفاً',
  'Password must be at least 6 characters': 'كلمة المرور يجب ألا تقل عن 6 أحرف',
  'Password is too long': 'كلمة المرور طويلة جداً',
  'Invalid role': 'الدور غير صالح',
  'Too many sign-ups from this address. Try again later.': 'محاولات تسجيل كثيرة من نفس العنوان. حاول لاحقاً.',
  'Current password is incorrect': 'كلمة المرور الحالية غير صحيحة',
  'The new password must be different from the current one': 'كلمة المرور الجديدة يجب أن تختلف عن الحالية',

  // Admin
  'Access denied. Admin privileges required.': 'هذه الصفحة للمدير فقط',
  'User not found': 'المستخدم غير موجود',
  'User is already approved': 'تمت الموافقة على هذا المستخدم من قبل',
  'User is not active': 'هذا الحساب غير مفعّل أصلاً',
  'Cannot delete your own account': 'لا يمكنك حذف حسابك',
  'Cannot deactivate your own account': 'لا يمكنك تعطيل حسابك',
  'An admin account cannot be deleted': 'لا يمكن حذف حساب مدير',
  'An admin account cannot be deactivated': 'لا يمكن تعطيل حساب مدير',
  'This user has orders or history, so deleting them would erase it. Deactivate the account instead.':
    'لهذا المستخدم طلبات أو سجل، وحذفه سيمسحها. عطّل حسابه بدلاً من الحذف.',
  'Backup not found': 'النسخة الاحتياطية غير موجودة',
  'Could not read the backups folder': 'تعذّرت قراءة مجلد النسخ الاحتياطية',

  // Orders
  'Order not found': 'الطلب غير موجود — ربما حُذف',
  'Order must have at least one item': 'يجب إضافة صنف واحد على الأقل',
  'Active orders require at least one taker': 'اختر مجهّزاً واحداً على الأقل، أو اجعل الطلب مفتوحاً لأي مجهّز',
  'Active orders require an accounter': 'اختر محاسباً للطلبات النشطة',
  'Select at least one taker before activating an archived order': 'اختر مجهّزاً، أو اجعل الطلب مفتوحاً لأي مجهّز، قبل إرساله',
  'Select an accounter before activating an archived order': 'اختر محاسباً قبل إرسال الطلب',
  'An open order cannot also be assigned to takers': 'الطلب المفتوح لا يُسند لمجهّز محدد',
  'An order in progress needs a taker': 'الطلب قيد التنفيذ يحتاج إلى مجهّز',
  'This order has already been taken': 'سبقك مجهّز آخر وأخذ هذا الطلب',
  'Invalid taker selection': 'أحد المجهّزين المختارين غير صالح أو تم تعطيله — حدّث الصفحة',
  'Invalid accounter selection': 'المحاسب المختار غير صالح',
  'Invalid accounter selected': 'المحاسب المختار غير صالح',
  'Invalid city': 'المدينة غير صالحة',
  'Not authorized to edit this order': 'لا تملك صلاحية تعديل هذا الطلب',
  'Not authorized to process this order': 'لا تملك صلاحية معالجة هذا الطلب',
  'Only makers or admins can assign takers': 'إسناد المجهّزين من صلاحية منشئ الطلبات أو المدير',
  'Only makers or admins can assign an accounter': 'اختيار المحاسب من صلاحية منشئ الطلبات أو المدير',
  'Only makers or admins can create orders': 'إنشاء الطلبات من صلاحية منشئ الطلبات أو المدير',
  'Only makers can delete orders': 'حذف الطلبات من صلاحية منشئ الطلبات',
  'You can only delete your own orders': 'يمكنك حذف طلباتك فقط',
  'Only takers can take open orders': 'أخذ الطلبات المفتوحة للمجهّزين فقط',
  'Accounter can only mark orders as entered to ERP': 'المحاسب يستطيع فقط تعليم الطلب كمُدخل إلى ERP',
  'Order must be completed before entering ERP': 'يجب أن يكتمل الطلب قبل إدخاله إلى ERP',
  'Failed to take the order': 'تعذّر أخذ الطلب، حاول مرة أخرى',
  'Failed to update item status': 'تعذّر حفظ حالة الصنف، حاول مرة أخرى',

  // Telegram
  'Telegram is not configured on the server': 'تيليغرام غير مفعّل على الخادم',
  'Telegram notifications are only for takers and accountants': 'إشعارات تيليغرام للمجهّزين والمحاسبين فقط',
  'The Telegram bot cannot be reached right now': 'تعذّر الوصول إلى بوت تيليغرام الآن، حاول بعد قليل',
  'Failed to read Telegram status': 'تعذّرت قراءة حالة تيليغرام',
  'Failed to unlink Telegram': 'تعذّر فك الربط، حاول مرة أخرى',
};

const PATTERNS = [
  [/^Duplicate item "(.+)"$/, (m) => `الصنف «${m[1]}» مكرر`],
  [/^Invalid quantity for "(.+)"$/, (m) => `الكمية غير صالحة للصنف «${m[1]}»`],
  [/^Invalid price for "(.+)"$/, (m) => `السعر غير صالح للصنف «${m[1]}»`],
  [/^Item (\d+) is missing a name$/, (m) => `الصنف رقم ${m[1]} بلا اسم`],
  [/^Item name is too long/, () => 'اسم الصنف طويل جداً (الحد الأقصى 255 حرفاً)'],
  [/^Customer name is too long/, () => 'اسم الزبون طويل جداً (الحد الأقصى 255 حرفاً)'],
  [/^Description is too long/, () => 'الوصف طويل جداً (الحد الأقصى 5000 حرف)'],
  [/^Item "(.+)" not found in this order$/, (m) => `الصنف «${m[1]}» لم يعد في هذا الطلب — ربما عدّله شخص آخر. حدّث الصفحة.`],
  [/^Order is (\S+) and can no longer be changed$/, (m) => `الطلب أصبح «${statusLabel(m[1])}» ولا يمكن تغييره`],
  [/^Too many failed login attempts\. Try again in (\d+) minutes\.$/, (m) => `محاولات دخول خاطئة كثيرة. حاول مجدداً بعد ${m[1]} دقيقة.`],
  [/^Backup failed: (.*)$/s, (m) => `فشل أخذ النسخة الاحتياطية: ${m[1]}`],
];

export function translateServerError(message) {
  if (typeof message !== 'string') return message;
  const exact = EXACT[message.trim()];
  if (exact) return exact;
  for (const [re, make] of PATTERNS) {
    const m = re.exec(message);
    if (m) return make(m);
  }
  return message;
}
