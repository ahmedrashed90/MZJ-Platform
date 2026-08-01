import { useMemo, useState } from "react";
import { CheckCircle, FileArrowUp, WarningCircle } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingFetch } from "../api";
import { MarketingAlert } from "./MarketingPage";
import {
  resolveFreshMarketingImport,
  type FreshMarketingImportBundle,
  type ResolvedFreshMarketingImport,
} from "../freshImport";
import type { MarketingMeta } from "../types";

export function FreshMarketingImportModal({
  open,
  meta,
  onClose,
  onImported,
}: {
  open: boolean;
  meta: MarketingMeta;
  onClose: () => void;
  onImported: (message: string) => Promise<void> | void;
}) {
  const [fileName, setFileName] = useState("");
  const [resolved, setResolved] = useState<ResolvedFreshMarketingImport | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = Boolean(resolved && !resolved.errors.length && !submitting);
  const summaryCards = useMemo(() => resolved ? [
    ["الحملات", resolved.summary.campaigns],
    ["الأجندات", resolved.summary.agendas],
    ["الكرييتيفات", resolved.summary.creatives],
    ["Task Template", resolved.summary.taskTemplates],
    ["تاسكات التنفيذ", resolved.summary.executionTasks],
    ["السيارات", resolved.summary.cars],
  ] : [], [resolved]);

  function reset() {
    setFileName("");
    setResolved(null);
    setError("");
    setSubmitting(false);
  }

  function close() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function selectFile(file?: File) {
    reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const bundle = JSON.parse(await file.text()) as FreshMarketingImportBundle;
      setResolved(resolveFreshMarketingImport(bundle, meta));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر قراءة ملف النقل");
    }
  }

  async function submit() {
    if (!resolved || resolved.errors.length) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string; alreadyApplied?: boolean }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "import_fresh_marketing_bundle",
          format: resolved.format,
          version: resolved.version,
          migrationKey: resolved.migrationKey,
          source: resolved.source,
          campaigns: resolved.campaigns,
          agendas: resolved.agendas,
        }),
      });
      await onImported(result.message);
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر تنفيذ عملية النقل");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="نقل حملة وأجندة من البداية"
      subtitle="يتم نقل بيانات الإنشاء فقط، ثم يولّد النظام Task Template وتاسكات التنفيذ الجديدة بنفس الفلو المعتمد."
      onClose={close}
      className="marketing-fresh-import-modal"
      footer={(
        <>
          <button type="button" className="marketing-secondary" onClick={close} disabled={submitting}>إلغاء</button>
          <button type="button" className="marketing-primary" onClick={() => void submit()} disabled={!canSubmit}>
            <CheckCircle size={18} />
            {submitting ? "جاري الإنشاء..." : "إنشاء الحملة والأجندة من البداية"}
          </button>
        </>
      )}
    >
      <div className="marketing-fresh-import-content">
        <MarketingAlert type="info">
          لن يتم نقل أي Task Template قديم أو اعتماد أو استلام أو نسبة تقدم أو إشعار. كل التاسكات ستبدأ من الصفر.
        </MarketingAlert>

        <label className="marketing-fresh-import-file">
          <FileArrowUp size={28} />
          <strong>{fileName || "اختر ملف النقل JSON"}</strong>
          <span>الملف يحتوي على بيانات الحملة والأجندة والكرييتيفات والتوزيع والمواعيد فقط.</span>
          <input type="file" accept="application/json,.json" onChange={(event) => void selectFile(event.target.files?.[0])} />
        </label>

        {error ? <MarketingAlert>{error}</MarketingAlert> : null}

        {resolved ? (
          <>
            <div className="marketing-fresh-import-summary">
              {summaryCards.map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{Number(value).toLocaleString("ar-SA")}</strong></article>)}
            </div>

            {resolved.errors.length ? (
              <div className="marketing-fresh-import-errors">
                <header><WarningCircle size={20} /><strong>لا يمكن الإنشاء قبل معالجة العناصر التالية</strong></header>
                <ul>{resolved.errors.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            ) : (
              <MarketingAlert type="success">
                تمت مطابقة اليوزرات والأقسام والكرييتيفات والمنصات والسيارات، والملف جاهز للإنشاء.
              </MarketingAlert>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
