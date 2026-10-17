import { useState } from 'react';

import { T, roleLabel } from '../../lib/labels';
import { formatDateTime } from '../../lib/format';
import { Ltr } from '../../components/ui';

/**
 * Activity actions are snake_case strings written by utils/activityLogger.js.
 * Anything not listed falls back to the raw action with underscores stripped,
 * so a new server-side action still renders something readable.
 */
const ACTION_LABELS = {
  user_registered: 'تسجيل مستخدم جديد',
  user_login: 'تسجيل دخول',
  user_approved: 'الموافقة على مستخدم',
  user_deleted: 'حذف مستخدم',
  user_email_updated: 'تحديث البريد الإلكتروني',
  user_theme_updated: 'تغيير المظهر',
  order_created: 'إنشاء طلب',
  order_updated: 'تعديل طلب',
  order_deleted: 'حذف طلب',
  order_status_changed: 'تغيير حالة الطلب',
  order_item_status_changed: 'تغيير حالة صنف',
  order_claimed: 'أخذ طلب مفتوح',
  order_error: 'خطأ في طلب',
  telegram_unlinked: 'فك ربط تيليغرام',
  backup_created: 'نسخة احتياطية يدوية',
  user_deactivated: 'تعطيل حساب',
  user_password_changed: 'تغيير كلمة المرور',
  user_password_reset: 'تعيين كلمة مرور لمستخدم',
  backup_downloaded: 'تنزيل نسخة احتياطية',
};

export const actionLabel = (action) =>
  ACTION_LABELS[action] || String(action || '').replace(/_/g, ' ').trim();

const TARGET_LABELS = { user: 'مستخدم', order: 'طلب', system: 'النظام' };
const targetLabel = (type) => TARGET_LABELS[type] || type;

export default function ActivityItem({ log }) {
  const [open, setOpen] = useState(false);
  const hasDetails = log.details && Object.keys(log.details).length > 0;

  return (
    <li className="border-b border-slate-100 py-2 last:border-0 dark:border-slate-700/60">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-bold">{actionLabel(log.action)}</span>
        {log.User && (
          <span className="text-xs text-slate-500 dark:text-ink-400">
            {log.User.username} ({roleLabel(log.User.role)})
          </span>
        )}
        {log.targetType && (
          <span className="text-xs text-slate-400">
            {targetLabel(log.targetType)}
            {log.targetId != null && (
              <>
                {' '}
                <Ltr>#{log.targetId}</Ltr>
              </>
            )}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs text-slate-400">
          <Ltr>{formatDateTime(log.createdAt)}</Ltr>
        </span>
      </div>

      {hasDetails && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-xs font-bold text-brand-600 hover:underline dark:text-indigo"
          >
            {T.details}
          </button>
          {open && (
            <pre
              dir="ltr"
              className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-start text-[11px] leading-relaxed dark:bg-ink-950/60"
            >
              {JSON.stringify(log.details, null, 2)}
            </pre>
          )}
        </>
      )}
    </li>
  );
}
