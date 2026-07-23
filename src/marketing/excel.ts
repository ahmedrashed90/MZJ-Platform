type SheetCell = { v?: unknown; t?: string };
type Sheet = Record<string, SheetCell | unknown>;
type Workbook = { SheetNames: string[]; Sheets: Record<string, Sheet> };
type XlsxApi = {
  read(data: ArrayBuffer, options: Record<string, unknown>): Workbook;
  utils: {
    sheet_to_json<T>(sheet: Sheet, options: Record<string, unknown>): T[];
    json_to_sheet(rows: Array<Record<string, unknown>>): Sheet;
    book_new(): Workbook;
    book_append_sheet(workbook: Workbook, sheet: Sheet, name: string): void;
  };
  writeFile(workbook: Workbook, filename: string, options?: Record<string, unknown>): void;
};

declare global { interface Window { XLSX?: XlsxApi } }

export const taskTemplateLabels = [
  ["campaignName", "اسم الحملة", ["اسم الحمله", "اسم الحملة"]],
  ["campaignCode", "رقم الحملة", ["رقم الحمله", "رقم الحملة"]],
  ["campaignType", "نوع الحملة", ["نوع الحمله", "نوع الحملة"]],
  ["taskNo", "رقم التاسك", ["رقم التاسك"]],
  ["suggestedCreativeName", "الاسم المقترح للكرييتيف", ["الاسم المقترح للكرييتيف", "الاسم المقترح للكريتييف", "الاسم المقترح للكرياتيف", "الاسم المقترح للكريتيف"]],
  ["contentType", "نوع المحتوى", ["نوع المحتوي", "نوع المحتوى"]],
  ["goal", "الهدف", ["الهدف"]],
  ["message", "الرسالة الأساسية", ["الرساله الاساسيه", "الرسالة الأساسية", "الرسالة الاساسية", "الرسالة الأساسيه"]],
  ["hook", "الهوك", ["الهوك"]],
  ["script", "السكريبت الأساسي", ["السكريبت الاساسي", "السكريبت الأساسي", "السكربت الأساسي", "السكربت الاساسي"]],
  ["cta", "CTA", ["cta", "CTA"]],
  ["caption", "الكابشن", ["الكابشن"]],
  ["hashtags", "هاشتاج", ["هاشتاج", "الهاشتاج"]],
] as const;

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[ةه]/g, "ه").replace(/[ىي]/g, "ي").replace(/[\s\u200f\u200e]+/g, " ").replace(/[^\u0600-\u06FFa-zA-Z0-9 ]/g, "").trim().toLowerCase();
}

export function xlsxAvailable() { return Boolean(window.XLSX); }

function setSheetValue(sheet: Sheet, cell: string, value: unknown) {
  const current = sheet[cell];
  const cellObject = current && typeof current === "object" ? current as SheetCell : {};
  sheet[cell] = { ...cellObject, t: "s", v: String(value ?? "") };
}

export async function downloadTaskTemplateFile(task: {
  source_type?: string; campaign_name: string; campaign_code: string; campaign_type?: string | null;
  task_code: string; creative_name: string; due_at?: string | null; department_note?: string | null; content_note?: string | null;
}) {
  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("مكتبة Excel لم تُحمّل. أعد تحميل الصفحة وحاول مرة أخرى.");
  const agenda = task.source_type === "agenda";
  const url = agenda ? "/marketing/templates/agenda-task-template.xlsx" : "/marketing/templates/task-template-base.xlsx";
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("تعذر تحميل قالب Task Template الأصلي");
  const workbook = xlsx.read(await response.arrayBuffer(), { type: "array", cellStyles: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("قالب Task Template غير صالح");
  if (agenda) {
    setSheetValue(sheet, "B4", task.campaign_name);
    setSheetValue(sheet, "B5", task.task_code);
    setSheetValue(sheet, "B6", task.creative_name);
    setSheetValue(sheet, "B7", task.due_at ? String(task.due_at).slice(0, 10) : "");
    setSheetValue(sheet, "B8", task.content_note || task.department_note || "");
  } else {
    setSheetValue(sheet, "C2", task.campaign_name);
    setSheetValue(sheet, "C3", task.campaign_code);
    setSheetValue(sheet, "C4", task.campaign_type || "");
    setSheetValue(sheet, "C5", task.task_code);
  }
  const baseName = String(task.campaign_code || task.campaign_name || "campaign").replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, "-");
  xlsx.writeFile(workbook, `${baseName}-${task.task_code}-Task-Template.xlsx`, { bookType: "xlsx", compression: true });
}

export async function parseTaskTemplate(file: File) {
  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("مكتبة Excel لم تُحمّل. أعد تحميل الصفحة وحاول مرة أخرى.");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false, cellStyles: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("ملف Task Template لا يحتوي على شيت قابل للقراءة");
  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  const keyMap = new Map<string, { key: string; label: string }>();
  for (const [key, label, aliases] of taskTemplateLabels) for (const alias of aliases) keyMap.set(normalize(alias), { key, label });
  const values = new Map<string, string>();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
      const found = keyMap.get(normalize(row[colIndex]));
      if (!found || values.get(found.key)) continue;
      const candidates: unknown[] = [];
      for (let offset = 1; offset <= Math.max(8, row.length); offset += 1) {
        if (colIndex + offset < row.length) candidates.push(row[colIndex + offset]);
        if (colIndex - offset >= 0) candidates.push(row[colIndex - offset]);
      }
      for (let nextRowIndex = rowIndex + 1; nextRowIndex < Math.min(rows.length, rowIndex + 8); nextRowIndex += 1) {
        const next = Array.isArray(rows[nextRowIndex]) ? rows[nextRowIndex] : [];
        for (let offset = 0; offset <= Math.max(8, next.length); offset += 1) {
          if (colIndex + offset < next.length) candidates.push(next[colIndex + offset]);
          if (colIndex - offset >= 0 && colIndex - offset !== colIndex + offset) candidates.push(next[colIndex - offset]);
        }
        candidates.push(...next);
      }
      const value = candidates.map((item) => String(item ?? "").trim()).find((item) => {
        if (!item) return false;
        const normalized = normalize(item);
        return !keyMap.has(normalized) && !normalized.includes("بيانات السيستم") && !normalized.includes("بيانات يكتبها قسم المحتوي") && !normalized.includes("task template");
      });
      if (value) values.set(found.key, value);
    }
  }
  const fields = taskTemplateLabels.map(([key, label]) => ({ key, label, value: values.get(key) || "" }));
  if (!fields.some((field) => field.value.trim())) throw new Error("تعذر قراءة بيانات Task Template من الملف. استخدم القالب الحقيقي بعد تعبئته.");
  const row = Object.fromEntries(fields.map((field) => [field.key, field.value]));
  return { templateType: "content_task_template", taskTemplateFields: fields, parsedRows: [{ ...row, taskTemplateFields: fields }], fileName: file.name };
}

export function exportRowsToExcel(rows: Array<Record<string, unknown>>, filename: string, sheetName = "البيانات") {
  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("مكتبة Excel لم تُحمّل");
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.json_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  xlsx.writeFile(workbook, filename, { bookType: "xlsx" });
}

export async function parseWhatsappContacts(file: File) {
  const xlsx = window.XLSX;
  if (!xlsx) throw new Error("مكتبة Excel لم تُحمّل. أعد تحميل الصفحة وحاول مرة أخرى.");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("الملف لا يحتوي على شيت قابل للقراءة");
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", blankrows: false });
  const phoneKeys = ["رقم الجوال", "رقم الهاتف", "الجوال", "الهاتف", "phone", "mobile", "phone number", "phonenumber"];
  const nameKeys = ["الاسم", "اسم العميل", "name", "full name", "fullname"];
  const normalizedKeys = (row: Record<string, unknown>) => Object.entries(row).map(([key, value]) => [normalize(key), value] as const);
  const contacts: Array<{ phone: string; name: string }> = [];
  for (const row of rows) {
    const entries = normalizedKeys(row);
    const phone = String(entries.find(([key]) => phoneKeys.some((candidate) => normalize(candidate) === key))?.[1] ?? Object.values(row).find((value) => /(?:\+?966|0)?5\d{8}/.test(String(value ?? ""))) ?? "").trim();
    if (!phone) continue;
    const name = String(entries.find(([key]) => nameKeys.some((candidate) => normalize(candidate) === key))?.[1] ?? "").trim();
    contacts.push({ phone, name });
  }
  if (!contacts.length) {
    const matrix = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
    for (const row of matrix) {
      if (!Array.isArray(row)) continue;
      const phone = row.map((value) => String(value ?? "").trim()).find((value) => /(?:\+?966|0)?5\d{8}/.test(value));
      if (phone) contacts.push({ phone, name: "" });
    }
  }
  if (!contacts.length) throw new Error("لم يتم العثور على أرقام جوال في الملف");
  return contacts;
}
