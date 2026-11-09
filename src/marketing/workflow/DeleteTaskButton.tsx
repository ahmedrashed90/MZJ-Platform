import { useState } from 'react';
import { Trash, WarningCircle } from '@phosphor-icons/react';
import { useAuth } from '../../auth/AuthContext';
import { hasPermission } from '../../systemAccess';
import { Modal } from '../../components/Modal';
import { W } from '../../../shared/marketing-workflow-labels';
import { WorkAlert } from './components';
import { workPost } from './api';

/** A single, permission-checked task deletion flow for Database and Dashboard. */
export function DeleteTaskButton({ id, name, code, onDeleted, compact = false }: {
  id: string; name: string; code: string; onDeleted: () => void | Promise<unknown>; compact?: boolean;
}) {
  const { user } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!hasPermission(user, 'marketing.task.delete')) return null;
  async function remove() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await workPost('delete_task', { id });
      setConfirming(false);
      await onDeleted();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : W.invalid);
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" className={compact ? 'mkw-dashboard-delete' : 'secondary danger mkw-delete-button'}
      aria-label={`${W.remove} ${name}`} title={`${W.remove} ${W.task}`} onClick={() => { setError(''); setConfirming(true); }}>
      <Trash size={17} />{!compact && W.remove}
    </button>
    {confirming && <Modal open title={`${W.remove} ${W.task}`} className="mkw-confirm-delete"
      onClose={() => { if (!busy) { setConfirming(false); setError(''); } }}>
      <div className="mkw mkw-confirm-content">
        <WarningCircle size={30} weight="duotone" />
        <strong>{name}</strong><span className="mkw-code">{code}</span>
        <p>{W.taskDeleteConfirm}</p><WorkAlert>{error}</WorkAlert>
        <div className="mkw-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => setConfirming(false)}>{W.cancel}</button>
          <button type="button" className="primary mkw-confirm-danger" disabled={busy} onClick={() => void remove()}>
            <Trash size={17} />{busy ? W.loading : W.remove}
          </button>
        </div>
      </div>
    </Modal>}
  </>;
}
