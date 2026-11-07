import { T } from '../lib/labels';

/** The «ضروري» / «أونلاين» labels, for anywhere an order is listed. */
export default function OrderMarks({ order }) {
  return (
    <>
      {order?.isUrgent && <span className="chip bg-red-600 font-bold text-white">{T.urgentOrder}</span>}
      {order?.isOnline && (
        <span className="chip bg-sky-100 font-bold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">{T.onlineOrder}</span>
      )}
    </>
  );
}
