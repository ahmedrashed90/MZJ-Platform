import { useState } from 'react';
import { ArrowsClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { workPost } from './api';

/** Only agenda publishing, never campaign publication or execution workflow. */
export function AgendaSyncButton({ planId, canSync }: { planId: string; canSync: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!canSync || !planId) return null;
  async function sync() {
    if (busy || !window.confirm('إرسال بيانات تجهيز نشر هذه الأجندة إلى سيستم الاستراتيجية؟ سيتم تحديث المنشورات الموجودة باستخدام معرّفاتها الثابتة، ولن يتم النشر على أي منصة.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await workPost<{ok: boolean; count: number; ready: number; waiting: number; incomplete: number}>('sync_agenda_strategy', {planId});
      setMessage(`تم استلام ${result.count} سجل نشر في الاستراتيجية، منها ${result.ready} جاهز بالملف النهائي و${result.waiting} بانتظار الملف${result.incomplete ? ` و${result.incomplete} يحتاج استكمال بيانات` : ''}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذر مزامنة الأجندة.');
    } finally { setBusy(false); }
  }
  return <div className="mkw-agenda-sync-action">
    <button type="button" className="secondary" disabled={busy} onClick={() => void sync()} aria-label="مزامنة الأجندة مع الاستراتيجية">
      <ArrowsClockwise size={17} className={busy ? 'marketing-spin' : undefined}/>{busy ? 'جارٍ مزامنة الأجندة...' : 'مزامنة الأجندة مع الاستراتيجية'}
    </button>
    {error && <small role="alert" style={{color:'var(--mkw-danger, #a32726)'}}><WarningCircle size={14} style={{verticalAlign:'middle'}}/> {error}</small>}
    {message && <small role="status" style={{color:'var(--mkw-success, #20734b)'}}><CheckCircle size={14} style={{verticalAlign:'middle'}}/> {message}</small>}
  </div>;
}
