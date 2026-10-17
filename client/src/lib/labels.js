/**
 * Every Arabic string in the app lives here, so wording can be changed in one
 * place without hunting through components.
 *
 * NOTE ON ROLE NAMES: the four role labels below are a proposal, not confirmed
 * business terminology. Check them against what your staff actually call these
 * jobs and edit ROLES - nothing else needs to change.
 */

export const ROLES = {
  maker: 'منشئ الطلبات',
  taker: 'المجهّز',
  accounter: 'المحاسب',
  admin: 'المدير',
};

export const roleLabel = (role) => ROLES[role] || role || '';

/**
 * Order status labels.
 *
 * The database enum uses 'in-progress' with a HYPHEN. Both the Flutter PDF
 * builder and the old React print component switch on 'in_progress' with an
 * underscore, so that case never matches and in-progress orders print the raw
 * English string. Fixed here.
 */
export const ORDER_STATUS = {
  pending: 'قيد الانتظار',
  'in-progress': 'قيد التنفيذ',
  completed: 'مكتمل',
  archived: 'مؤرشف',
  entered_erp: 'تم الإدخال في ERP',
};

export const statusLabel = (status) => ORDER_STATUS[status] || status || '';

/** Pseudo-status used by the UI for the combined pending + in-progress view. */
export const ACTIVE_STATUS = 'active';

export const STATUS_FILTER_LABELS = {
  all: 'الكل',
  active: 'النشطة',
  pending: 'قيد الانتظار',
  'in-progress': 'قيد التنفيذ',
  completed: 'مكتمل',
  archived: 'مؤرشف',
  entered_erp: 'تم الإدخال في ERP',
};

export const ITEM_STATUS = {
  collected: 'تم التجهيز',
  unavailable: 'غير متوفر',
};

export const itemStatusLabel = (status) => ITEM_STATUS[status] || 'لم يُحدَّد';

/** Cities come from the database already in Arabic - see models/Order.js. */
export const CITIES = [
  'نابلس',
  'الخليل',
  'جنين',
  'طولكرم',
  'بديا',
  'قلقيليا',
  'رامالله',
  'بيت لحم',
  'الداخل',
];

export const DEFAULT_CITY = 'نابلس';

export const T = {
  appName: 'نظام طلبات AMA',

  // Auth
  login: 'تسجيل الدخول',
  logout: 'تسجيل الخروج',
  signup: 'إنشاء حساب',
  username: 'اسم المستخدم',
  password: 'كلمة المرور',
  role: 'الدور',
  haveAccount: 'لديك حساب بالفعل؟',
  noAccount: 'ليس لديك حساب؟',
  signingIn: 'جارٍ تسجيل الدخول...',
  pendingTitle: 'الحساب بانتظار الموافقة',
  pendingBody:
    'تم إنشاء حسابك بنجاح. يحتاج المدير إلى الموافقة عليه قبل أن تتمكن من الدخول.',
  accountCreated: 'تم إنشاء الحساب. بانتظار موافقة المدير.',

  // Passwords
  changePassword: 'تغيير كلمة المرور',
  currentPassword: 'كلمة المرور الحالية',
  newPassword: 'كلمة المرور الجديدة',
  confirmPassword: 'تأكيد كلمة المرور الجديدة',
  passwordsDontMatch: 'كلمتا المرور غير متطابقتين',
  passwordTooShort: 'كلمة المرور يجب ألا تقل عن 6 أحرف',
  passwordChanged: 'تم تغيير كلمة المرور. تم إنهاء جلساتك على الأجهزة الأخرى.',
  defaultPasswordWarning:
    'ما زلت تستخدم كلمة مرور المدير الافتراضية (admin123) المعروفة للجميع. غيّرها الآن.',
  changeNow: 'غيّرها الآن',
  resetPassword: 'كلمة مرور جديدة',
  resetPasswordFor: (name) => `تعيين كلمة مرور جديدة لـ ${name}`,
  resetPasswordHint: 'أعطِ المستخدم كلمة المرور الجديدة. سيُطلب منه تسجيل الدخول بها على كل أجهزته.',
  passwordReset: 'تم تعيين كلمة المرور الجديدة',

  // Shell
  darkMode: 'الوضع الليلي',
  refresh: 'تحديث',
  notifications: 'الإشعارات',
  markAllRead: 'تعليم الكل كمقروء',
  noNotifications: 'لا توجد إشعارات',
  enablePush: 'تفعيل إشعارات المتصفح',
  pushSubscribed: 'تم تفعيل الإشعارات',
  pushDenied: 'تم رفض إذن الإشعارات من المتصفح',
  pushUnsupported: 'المتصفح لا يدعم الإشعارات (يتطلب HTTPS)',
  pushServerDisabled: 'الإشعارات غير مفعّلة على الخادم',
  pushFailed: 'تعذّر تفعيل الإشعارات',

  // Telegram
  telegramPromptTitle: 'استلم الطلبات على تيليغرام',
  telegramPromptBody: 'بدون الربط لن تعرف بالطلبات الجديدة إلا عند فتح النظام. اربط حسابك مرة واحدة لتصلك فوراً على هاتفك.',
  telegramLink: 'ربط تيليغرام',
  telegramStep1: 'افتح تيليغرام',
  telegramOpen: 'فتح تيليغرام',
  telegramStep2: 'اضغط «ابدأ» (Start) داخل المحادثة',
  telegramWaiting: 'بانتظار التأكيد من تيليغرام…',
  telegramFallback: 'لم يُفتح التطبيق؟ اضغط هنا',
  telegramNeedApp: 'يجب أن يكون تطبيق تيليغرام مثبتاً على هاتفك.',
  telegramLinked: 'الطلبات تصلك على تيليغرام',
  telegramUnlink: 'فك الربط',
  telegramLinkedToast: 'تم ربط تيليغرام بنجاح',
  telegramUnlinkedToast: 'تم فك الربط. لن تصلك الإشعارات على هاتفك بعد الآن.',
  telegramPromptTitleAccounter: 'استلم الطلبات الجاهزة على تيليغرام',
  telegramPromptBodyAccounter: 'اربط حسابك مرة واحدة ليصلك إشعار على هاتفك كلما اكتمل طلب وأصبح جاهزاً للإدخال على ERP.',
  telegramLinkedAccounter: 'إشعارات الطلبات الجاهزة تصلك على تيليغرام',
  telegramExpired: 'انتهت صلاحية الرابط. اضغط «ربط تيليغرام» مرة أخرى.',

  // Tabs
  active: 'النشطة',
  archived: 'المؤرشفة',
  reports: 'التقارير',
  overview: 'نظرة عامة',
  users: 'المستخدمون',
  orders: 'الطلبات',
  logs: 'السجلات',
  completed: 'المكتملة',
  enteredErp: 'المُدخلة إلى ERP',

  // Order form
  newOrder: 'طلب جديد',
  customerName: 'اسم الزبون',
  description: 'الوصف',
  city: 'المدينة',
  selectCity: 'اختر المدينة',
  items: 'الأصناف',
  itemName: 'الصنف',
  quantity: 'الكمية',
  price: 'السعر',
  total: 'الإجمالي',
  grandTotal: 'المجموع الكلي',
  addItem: 'إضافة صنف',
  removeItem: 'حذف الصنف',
  assignTakers: 'إسناد إلى المجهّزين',
  accounter: 'المحاسب',
  selectAccounter: 'اختر المحاسب',
  none: 'بدون',
  createOrder: 'إنشاء الطلب',
  createArchived: 'حفظ كمؤرشف',
  creating: 'جارٍ الإنشاء...',
  orderCreated: 'تم إنشاء الطلب',

  // Order table
  orderNumber: 'رقم الطلب',
  sentAt: 'أُرسل في',
  maker: 'المُنشئ',
  takers: 'المجهّزون',
  status: 'الحالة',
  actions: 'إجراءات',
  print: 'طباعة',
  edit: 'تعديل',
  delete: 'حذف',
  save: 'حفظ',
  saved: 'تم الحفظ',
  deleted: 'تم الحذف',
  itemAdded: 'تمت إضافة الصنف',
  fixErrors: 'يرجى تصحيح الحقول المميزة باللون الأحمر',
  cancel: 'إلغاء',
  close: 'إغلاق',
  send: 'إرسال',
  confirm: 'تأكيد',
  noOrders: 'لا توجد طلبات',
  loading: 'جارٍ التحميل...',
  history: 'سجل التعديلات',
  showHistory: 'عرض السجل',
  hideHistory: 'إخفاء السجل',
  editOrder: 'تعديل الطلب',
  changeStatus: 'تغيير الحالة',
  sendToErp: 'إرسال إلى ERP',
  markCollected: 'تم التجهيز',
  markUnavailable: 'غير متوفر',
  clearItemStatus: 'إلغاء التحديد',
  statusStart: 'بدء التجهيز',
  statusFinish: 'إنهاء الطلب',

  // Archived / bulk send
  selectAll: 'تحديد الكل',
  clearSelection: 'إلغاء التحديد',
  printSelected: 'طباعة المحدد',
  sendSelected: 'إرسال المحدد',
  sendOrders: 'إرسال الطلبات المحددة',
  ordersSent: 'تم إرسال الطلبات',
  noArchived: 'لا توجد طلبات مؤرشفة',
  unspecifiedCity: 'غير محددة',
  itemCount: (n) => (n === 1 ? 'صنف واحد' : n === 2 ? 'صنفان' : `${n} أصناف`),
  createdOn: 'أُنشئ في',

  // Filters
  search: 'بحث',
  searchPlaceholder: 'ابحث بالاسم أو الوصف أو المدينة...',
  filterByStatus: 'تصفية حسب الحالة',
  allCities: 'كل المدن',

  // Admin
  totalUsers: 'إجمالي المستخدمين',
  pendingApprovals: 'بانتظار الموافقة',
  totalOrders: 'إجمالي الطلبات',
  activeOrders: 'الطلبات النشطة',
  recentActivity: 'آخر النشاطات',
  approve: 'موافقة',
  approved: 'تمت الموافقة',
  userActive: 'مفعّل',
  userPending: 'بانتظار الموافقة',
  userDeactivated: 'معطّل',
  deactivate: 'تعطيل',
  activate: 'تفعيل',
  confirmDeactivate: (name) =>
    `تعطيل حساب ${name}؟ لن يستطيع الدخول، وتبقى كل طلباته وسجلّه كما هي. يمكنك إعادة تفعيله لاحقاً.`,
  userDeactivatedToast: 'تم تعطيل الحساب',
  userDeactivatedWithOrders: (n) => `تم تعطيل الحساب. لديه ${n} طلبات نشطة — أعد إسنادها لمجهّز آخر.`,
  userActivatedToast: 'تم تفعيل الحساب',
  deleteUser: 'حذف المستخدم',
  noPending: 'لا توجد طلبات موافقة معلّقة',
  usersByRole: 'المستخدمون حسب الدور',
  activityLogs: 'سجل النشاطات',
  loadMore: 'تحميل المزيد',
  details: 'التفاصيل',

  // Backups
  backups: 'النسخ الاحتياطي',
  backupIntro:
    'يأخذ النظام نسخة احتياطية تلقائياً أثناء العمل (كل بضع ساعات عند وجود تغييرات)، ويحتفظ بنسخة لكل يوم لآخر 30 يوماً ونسخة لكل شهر لمدة سنة.',
  backupNow: 'خذ نسخة احتياطية الآن',
  backingUp: 'جارٍ أخذ النسخة...',
  backupDone: 'تم حفظ النسخة الاحتياطية',
  backupAuto: 'النسخ التلقائي',
  backupAutoOn: 'مفعّل',
  backupAutoOff: 'متوقف (BACKUP_AUTO=off)',
  backupLast: 'آخر نسخة',
  backupNone: 'لا توجد نسخ بعد',
  backupLastError: 'فشلت آخر محاولة',
  backupFolder: 'مجلد النسخ',
  backupCopyFolder: 'نسخة إضافية في',
  backupCopyMissing:
    'لا توجد نسخة إضافية خارج هذا الجهاز. إذا تعطّل القرص ضاعت النسخ معه. حدّد BACKUP_COPY_DIR في server/.env على قرص آخر أو مجلد OneDrive / Google Drive.',
  backupCopyFailed: 'فشل النسخ إلى المجلد الإضافي',
  backupList: 'النسخ المحفوظة',
  backupDate: 'التاريخ',
  backupKind: 'النوع',
  backupSize: 'الحجم',
  backupDownload: 'تنزيل',
  backupKindAuto: 'تلقائية',
  backupKindManual: 'يدوية',
  backupKindSafety: 'قبل الاسترجاع',
  backupRestoreTitle: 'استرجاع نسخة',
  backupRestoreBody:
    'أوقف النظام أولاً (Stop AMA)، ثم شغّل «Restore AMA» واختر النسخة. قبل أي تغيير يأخذ الاسترجاع نسخة أمان من البيانات الحالية، فيمكن التراجع عنه.',
  backupPrivate: 'تحتوي النسخ على كل البيانات بما فيها كلمات المرور (مشفّرة). احفظها في مكان آمن ولا ترسلها لأحد.',

  // Reports
  from: 'من',
  to: 'إلى',
  generateReport: 'إنشاء التقرير',
  generating: 'جارٍ الإنشاء...',
  ordersInRange: 'عدد الطلبات',
  totalQuantitySold: 'إجمالي الكميات المجهّزة',
  productsSold: 'الأصناف المجهّزة',
  unavailableProducts: 'الأصناف غير المتوفرة',
  takerAssignments: 'توزيع المجهّزين',
  customerOrders: 'طلبات الزبائن',
  noReportData: 'لا توجد بيانات في هذه الفترة',
  printReport: 'طباعة التقرير',

  // Confirmations / errors
  confirmDeleteOrder: 'هل تريد حذف هذا الطلب؟ لا يمكن التراجع عن هذا الإجراء.',
  confirmDeleteUser:
    'هل تريد حذف هذا المستخدم نهائياً؟ الحذف متاح فقط لمن لم يعمل على أي طلب؛ لغيره استخدم «تعطيل».',
  confirmSendToErp: 'هل تريد إرسال هذا الطلب إلى ERP؟ سيتم تعليمه كمُدخَل.',
  somethingWentWrong: 'حدث خطأ ما',
  sessionExpired: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
  retry: 'إعادة المحاولة',
  required: 'هذا الحقل مطلوب',
  invalidQuantity: 'الكمية غير صالحة',
  invalidPrice: 'السعر غير صالح',
  duplicateItem: 'هذا الصنف مكرر',
  atLeastOneItem: 'يجب إضافة صنف واحد على الأقل',
  needTaker: 'اختر مجهّزاً واحداً على الأقل، أو اجعل الطلب مفتوحاً لأي مجهّز',
  needAccounter: 'اختر محاسباً للطلبات النشطة',

  // Open orders - left for any taker; the first to take it gets it
  openToAll: 'مفتوح لأي مجهّز',
  openToAllHint: 'لن يُسند لأحد الآن: يظهر عند كل المجهّزين، وأول من يأخذه يصبح له.',
  openToAllReleaseHint: 'سيُسحب من المجهّز الحالي ويعود «قيد الانتظار» ليأخذه أي مجهّز.',
  myOrders: 'طلباتي',
  openOrders: 'طلبات مفتوحة',
  openOrdersHint: 'طلبات لم تُسند لأحد. أول مجهّز يأخذ الطلب يصبح له ويختفي من عند الباقين.',
  takeOrder: 'خذ الطلب',
  takeOrderConfirm: (id) => `أخذ الطلب #${id}؟ سيُسند إليك ويختفي من عند باقي المجهّزين.`,
  orderTaken: 'الطلب لك الآن — تجده في «طلباتي»',
  orderAlreadyTaken: 'سبقك مجهّز آخر وأخذ هذا الطلب',
  noOpenOrders: 'لا توجد طلبات مفتوحة حالياً',

  // Keyboard hints
  shortcutCreate: 'Ctrl+Enter',
  shortcutArchive: 'F3',
  shortcutRemoveRow: 'F7',
  keyboardHints: 'اختصارات لوحة المفاتيح',
};

export const CURRENCY = 'ILS';
