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
  telegramUnlinkedToast: 'تم فك الربط. لن تصلك الطلبات على هاتفك بعد الآن.',
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
  deleteUser: 'حذف المستخدم',
  noPending: 'لا توجد طلبات موافقة معلّقة',
  usersByRole: 'المستخدمون حسب الدور',
  activityLogs: 'سجل النشاطات',
  loadMore: 'تحميل المزيد',
  details: 'التفاصيل',

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
  confirmDeleteUser: 'هل تريد حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء.',
  confirmSendToErp: 'هل تريد إرسال هذا الطلب إلى ERP؟ سيتم تعليمه كمُدخَل.',
  somethingWentWrong: 'حدث خطأ ما',
  sessionExpired: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى',
  retry: 'إعادة المحاولة',
  required: 'هذا الحقل مطلوب',
  invalidQuantity: 'الكمية غير صالحة',
  invalidPrice: 'السعر غير صالح',
  duplicateItem: 'هذا الصنف مكرر',
  atLeastOneItem: 'يجب إضافة صنف واحد على الأقل',
  needTaker: 'اختر مجهّزاً واحداً على الأقل للطلبات النشطة',
  needAccounter: 'اختر محاسباً للطلبات النشطة',

  // Keyboard hints
  shortcutCreate: 'Ctrl+Enter',
  shortcutArchive: 'F3',
  shortcutRemoveRow: 'F7',
  keyboardHints: 'اختصارات لوحة المفاتيح',
};

export const CURRENCY = 'ILS';
