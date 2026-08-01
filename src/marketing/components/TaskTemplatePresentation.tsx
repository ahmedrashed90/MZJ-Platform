import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarBlank,
  Car,
  ChatCircleText,
  CheckCircle,
  ClipboardText,
  FilmSlate,
  Hash,
  MegaphoneSimple,
  NotePencil,
  Target,
  XCircle,
} from "@phosphor-icons/react";

export const taskTemplateFieldLabels: Record<string, string> = {
  proposedName: "الاسم المقترح للكرييتيف",
  goal: "الهدف",
  mainMessage: "الرسالة الأساسية",
  hook: "الهوك",
  mainScript: "السكريبت الأساسي",
  cta: "CTA",
  caption: "Caption",
  hashtags: "Hashtag",
};

type TemplateMode = "readonly" | "review" | "preview";

type TaskTemplatePresentationProps = {
  task: any;
  data: Record<string, string>;
  mode?: TemplateMode;
  statusLabel?: string;
  statusTone?: "approved" | "review" | "preview" | "warning";
  previewValidation?: {
    fileName: string;
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
  adminNote?: string;
  onAdminNoteChange?: (value: string) => void;
  selectedFields?: string[];
  fieldNotes?: Record<string, string>;
  activeReviewField?: string | null;
  onSelectField?: (key: string) => void;
  onOpenField?: (key: string) => void;
  onClearField?: (key: string) => void;
  onFieldNoteChange?: (key: string, value: string) => void;
  onDataChange?: (key: string, value: string) => void;
  onClose?: () => void;
};

type Scene = { number: number; title: string; time: string; body: string };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function carsText(cars: unknown) {
  if (!Array.isArray(cars) || !cars.length) return "—";
  return cars
    .map((car: any) => [car.car_name || car.name || car.vin || "سيارة", car.exterior_color, car.interior_color].filter(Boolean).join(" - "))
    .join("، ");
}

function splitHashtags(value: unknown) {
  const matches = text(value).match(/#[^#\s،,]+/g);
  if (matches?.length) return [...new Set(matches)];
  return text(value)
    .split(/[\s،,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.startsWith("#") ? item : `#${item}`);
}

function parseScenes(value: unknown): Scene[] {
  const source = text(value).replace(/\r/g, "");
  if (!source) return [];

  const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
  const marker = /^(?:(?:slide|scene)\s*\d+|(?:سلايد|المشهد|مشهد)\s*\d+|\d+\s*[-–.)])/i;
  if (!lines.some((line) => marker.test(line))) return [];

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (marker.test(line) && current.length) {
      blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  const normalizedBlocks = blocks.length === 1 && lines.length > 8
    ? Array.from({ length: Math.ceil(lines.length / 5) }, (_, index) => lines.slice(index * 5, index * 5 + 5))
    : blocks;

  return normalizedBlocks.map((block, index) => {
    const joined = block.join("\n");
    const timeMatch = joined.match(/\b\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\b/);
    const first = block[0] || "";
    const cleanedTitle = first
      .replace(/^(?:(?:slide|scene)\s*\d+|(?:سلايد|المشهد|مشهد)\s*\d+|\d+\s*[-–.)])\s*[:\-–]?\s*/i, "")
      .replace(timeMatch?.[0] || "", "")
      .replace(/^[:\-–\s]+|[:\-–\s]+$/g, "");
    const fallback = /hook|هوك/i.test(joined)
      ? "Hook"
      : index === normalizedBlocks.length - 1
        ? "الخاتمة"
        : `المشهد ${index + 1}`;
    const bodyLines = cleanedTitle && cleanedTitle !== first ? block.slice(1) : block;

    return {
      number: index + 1,
      title: cleanedTitle.slice(0, 80) || fallback,
      time: timeMatch?.[0] || "",
      body: bodyLines.join("\n").replace(timeMatch?.[0] || "", "").trim() || joined,
    };
  });
}

function AutoTextarea({ value, onChange, ariaLabel, minHeight = 78 }: { value: string; onChange: (value: string) => void; ariaLabel: string; minHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "0px";
    ref.current.style.height = `${Math.max(minHeight, ref.current.scrollHeight)}px`;
  }, [value, minHeight]);
  return <textarea ref={ref} value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} />;
}

function ContextCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <article className="marketing-template-context-card">
    <span>{icon}</span>
    <div><small>{label}</small><strong>{value || "—"}</strong></div>
  </article>;
}

export function TaskTemplatePresentation({
  task,
  data,
  mode = "readonly",
  statusLabel,
  statusTone = "review",
  previewValidation,
  adminNote = "",
  onAdminNoteChange,
  selectedFields = [],
  fieldNotes = {},
  activeReviewField = null,
  onSelectField,
  onOpenField,
  onClearField,
  onFieldNoteChange,
  onDataChange,
  onClose,
}: TaskTemplatePresentationProps) {
  const editable = mode === "review" && Boolean(onDataChange);
  const [scriptEditorOpen, setScriptEditorOpen] = useState(false);
  const scenes = useMemo(() => parseScenes(data.mainScript), [data.mainScript]);
  const hashtags = useMemo(() => splitHashtags(data.hashtags), [data.hashtags]);
  const dueDate = text(task?.template_due_on || task?.due_at).slice(0, 10) || "—";

  function fieldSelected(key: string) {
    return selectedFields.includes(key);
  }

  function cardEvents(key: string) {
    if (mode !== "review") return {};
    return {
      onClick: () => onSelectField?.(key),
      onDoubleClick: () => onOpenField?.(key),
    };
  }

  function fieldContent(key: string) {
    const value = text(data[key]);
    if (editable) {
      return <AutoTextarea
        value={data[key] || ""}
        ariaLabel={taskTemplateFieldLabels[key]}
        onChange={(next) => onDataChange?.(key, next)}
      />;
    }
    return <p>{value || "—"}</p>;
  }

  function reviewNote(key: string) {
    if (!fieldSelected(key)) return null;
    const note = fieldNotes[key] || "";
    return <div className="marketing-template-field-review-note" onClick={(event) => event.stopPropagation()}>
      <div>
        <ChatCircleText size={16} weight="fill" />
        <strong>ملاحظة المراجع</strong>
        {onClearField ? <button type="button" onClick={() => onClearField(key)}><XCircle size={15} />إلغاء التحديد</button> : null}
      </div>
      {mode === "review" && onFieldNoteChange
        ? <AutoTextarea value={note} ariaLabel={`ملاحظة ${taskTemplateFieldLabels[key]}`} minHeight={64} onChange={(next) => onFieldNoteChange(key, next)} />
        : <p>{note || "هذا الحقل مطلوب تعديله."}</p>}
    </div>;
  }

  const cards = [
    ["proposedName", "name"],
    ["goal", "goal"],
    ["mainMessage", "message"],
    ["hook", "hook"],
    ["cta", "cta"],
    ["caption", "caption"],
    ["hashtags", "hashtags"],
  ] as const;

  return <section className={`marketing-template-shell mode-${mode}`}>
    <header className="marketing-template-hero">
      <div className="marketing-template-statuses">
        <span>قسم المحتوى</span>
        {statusLabel ? <b className={`tone-${statusTone}`}><CheckCircle size={16} weight="fill" />{statusLabel}</b> : null}
      </div>
      <div className="marketing-template-hero-title"><h2>Task Template</h2><p>تفاصيل التاسك من الهيكل</p></div>
      {onClose ? <button type="button" className="marketing-template-close" aria-label="إغلاق" onClick={onClose}><XCircle size={22} /></button> : null}
    </header>

    {previewValidation ? <section className={`marketing-template-preview-status ${previewValidation.isValid ? "valid" : "invalid"}`} aria-label="نتيجة فحص Task Template">
      <div className="marketing-template-preview-file">
        <ClipboardText size={22} weight="fill" />
        <span><small>الملف المختار للرفع</small><strong>{previewValidation.fileName}</strong></span>
      </div>
      <div className="marketing-template-preview-result">
        {previewValidation.isValid ? <CheckCircle size={24} weight="fill" /> : <XCircle size={24} weight="fill" />}
        <span>
          <strong>{previewValidation.isValid ? "الملف مطابق ويمكن تأكيد الرفع" : "تم رفض الملف لعدم مطابقته للنموذج"}</strong>
          <small>{previewValidation.isValid ? "هذه هي نفس طريقة العرض النهائية بعد الحفظ والاعتماد." : "صحح الأخطاء الموضحة ثم ارفع الملف مرة أخرى."}</small>
        </span>
      </div>
      {previewValidation.errors.length || previewValidation.warnings.length ? <div className="marketing-template-preview-feedback">
        {previewValidation.errors.map((item) => <p className="error" key={`error-${item}`}><XCircle size={15} weight="fill" />{item}</p>)}
        {previewValidation.warnings.map((item) => <p className="warning" key={`warning-${item}`}><ChatCircleText size={15} weight="fill" />{item}</p>)}
      </div> : null}
    </section> : null}

    <section className="marketing-template-block">
      <h3>بيانات أساسية</h3>
      <div className="marketing-template-context-grid">
        <ContextCard label="رقم التاسك" value={text(task?.task_no || task?.instance_code)} icon={<ClipboardText size={20} />} />
        <ContextCard label="نوع الحملة" value={text(task?.campaign_type || (task?.source_type === "agenda" ? "أجندة" : "—"))} icon={<Target size={20} />} />
        <ContextCard label="نوع المحتوى" value={text(task?.creative_name || task?.title)} icon={<FilmSlate size={20} />} />
        <ContextCard label="السيارة" value={carsText(task?.cars)} icon={<Car size={20} />} />
      </div>
    </section>

    <div className="marketing-template-dual-row">
      <section className="marketing-template-block marketing-template-admin-note">
        <h3><ChatCircleText size={19} />ملاحظات الأدمن</h3>
        {onAdminNoteChange
          ? <AutoTextarea value={adminNote} ariaLabel="ملاحظات الأدمن" minHeight={92} onChange={onAdminNoteChange} />
          : <p>{adminNote || "لا توجد ملاحظات من الأدمن."}</p>}
      </section>
      <section className="marketing-template-block marketing-template-assignment">
        <h3><CalendarBlank size={19} />مواعيد وملاحظات التكليف</h3>
        <div>
          <article><small>موعد تسليم التاسك</small><strong>{dueDate}</strong></article>
          <article><small>ملاحظات التكليف</small><p>{text(task?.template_department_note || task?.note) || "لا توجد ملاحظات تكليف إضافية."}</p></article>
        </div>
      </section>
    </div>

    <section className="marketing-template-block marketing-template-data-block">
      <h3><CheckCircle size={20} weight="fill" />بيانات Task Template {statusTone === "approved" ? "المعتمد" : ""}</h3>
      <div className="marketing-template-field-grid">
        {cards.map(([key, className]) => <article
          key={key}
          className={`marketing-template-field-card field-${className} ${fieldSelected(key) ? "review-selected" : ""} ${activeReviewField === key ? "review-active" : ""} ${!text(data[key]) ? "is-empty" : ""}`}
          {...cardEvents(key)}
        >
          <header><small>{taskTemplateFieldLabels[key]}</small>{mode === "review" ? <NotePencil size={16} /> : null}</header>
          {key === "hashtags" && !editable
            ? <div className="marketing-template-hashtags">{hashtags.length ? hashtags.map((tag) => <span key={tag}><Hash size={12} />{tag.replace(/^#/, "")}</span>) : <p>—</p>}</div>
            : fieldContent(key)}
          {reviewNote(key)}
        </article>)}
      </div>
    </section>

    <section
      className={`marketing-template-block marketing-template-scenes ${fieldSelected("mainScript") ? "review-selected" : ""} ${activeReviewField === "mainScript" ? "review-active" : ""}`}
      {...cardEvents("mainScript")}
    >
      <div className="marketing-template-scenes-head">
        <h3><MegaphoneSimple size={20} />المشاهد / السلايدات</h3>
        {editable ? <button type="button" onClick={(event) => { event.stopPropagation(); setScriptEditorOpen((value) => !value); }}><NotePencil size={16} />{scriptEditorOpen ? "إغلاق محرر السكريبت" : "تعديل السكريبت الأساسي"}</button> : null}
      </div>
      {scenes.length
        ? <div className="marketing-template-scene-grid">{scenes.map((scene) => <article key={`${scene.number}-${scene.title}`}>
          <header><b>{scene.number}</b><strong>{scene.title}</strong>{scene.time ? <span dir="ltr">{scene.time}</span> : null}</header>
          <small>البيانات</small>
          <p>{scene.body}</p>
        </article>)}</div>
        : <div className={`marketing-template-scenes-empty ${text(data.mainScript) ? "has-script" : ""}`}>{text(data.mainScript) || "لا توجد بيانات داخل السكريبت الأساسي."}</div>}
      {editable && scriptEditorOpen ? <div className="marketing-template-script-editor"><AutoTextarea value={data.mainScript || ""} ariaLabel="السكريبت الأساسي" minHeight={180} onChange={(next) => onDataChange?.("mainScript", next)} /></div> : null}
      {reviewNote("mainScript")}
    </section>
  </section>;
}
