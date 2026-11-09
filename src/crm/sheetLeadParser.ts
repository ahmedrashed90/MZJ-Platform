import { readXlsx } from "./xlsxReader";

export type SheetLeadRow = { rowNumber: number; customerName: string; phone: string; source: string };

function headerKey(value: string) {
  return String(value || "").replace(/[\u200b-\u200d\ufeff]/g, "").trim().toLowerCase().replace(/[أإآ]/g, "ا").replace(/[_\s\-]+/g, "");
}

const NAME_HEADERS = new Set(["اسمالعميل", "الاسم", "اسمالكامل", "اسم", "customername", "fullname", "name", "clientname"]);
const PHONE_HEADERS = new Set(["رقمالجوال", "الجوال", "رقمالهاتف", "رقمالعميل", "رقمالموبايل", "رقم", "الهاتف", "رقمالاتصال", "phone", "phonenumber", "mobile", "mobilenumber", "clientphone"]);

const SOURCE_HEADERS = new Set(["source", "leadsource", "platform", "channel", "marketingplatform", "\u0627\u0644\u0645\u0635\u062f\u0631", "\u0645\u0635\u062f\u0631\u0627\u0644\u0639\u0645\u064a\u0644", "\u0645\u0635\u062f\u0631\u0627\u0644\u0644\u064a\u062f", "\u0627\u0644\u0645\u0646\u0635\u0629"]);

export function parseDelimitedSheet(content: string): string[][] {
  const text = String(content || "").replace(/^\ufeff/, "");
  const headerLine = text.split(/\r?\n/, 1)[0] || "";
  const separator = [",", "\t", ";"].sort((a, b) => headerLine.split(b).length - headerLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === separator && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = []; field = "";
    } else { field += char; }
  }
  if (quoted) throw new Error("يوجد حقل غير مغلق بعلامات تنصيص داخل ملف الشيت");
  row.push(field);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

export function extractSheetLeads(records: Array<Record<string, string>>): SheetLeadRow[] {
  if (!records.length) return [];
  const keys = Object.keys(records[0] || {});
  const nameColumn = keys.find((key) => NAME_HEADERS.has(headerKey(key)));
  const phoneColumn = keys.find((key) => PHONE_HEADERS.has(headerKey(key)));
  const sourceColumn = keys.find((key) => SOURCE_HEADERS.has(headerKey(key)));
  if (!nameColumn || !phoneColumn || nameColumn === phoneColumn) {
    throw new Error("الشيت لازم يحتوي على عمودين باسم «اسم العميل» و«رقم الجوال»");
  }
  return records
    .map((row, index) => ({ rowNumber: index + 2, customerName: String(row[nameColumn] ?? "").trim(), phone: String(row[phoneColumn] ?? "").trim(), source: String(sourceColumn ? row[sourceColumn] ?? "" : "").trim() }))
    .filter((row) => row.customerName || row.phone);
}

export async function readSheetLeads(file: File): Promise<SheetLeadRow[]> {
  if (file.size > 20 * 1024 * 1024) throw new Error("حجم الملف أكبر من 20 ميجابايت");
  const extension = file.name.toLowerCase().split(".").pop();
  let rows: Record<string, string>[];
  if (extension === "xlsx") {
    rows = await readXlsx(file);
  } else if (extension === "csv" || extension === "tsv") {
    const grid = parseDelimitedSheet(await file.text());
    const columns = (grid.shift() || []).map((header) => header.trim());
    rows = grid.map((cells) => Object.fromEntries(columns.map((column, index) => [column, String(cells[index] ?? "").trim()])));
  } else {
    throw new Error("الملفات المدعومة: Excel .xlsx أو CSV أو TSV");
  }
  const parsed = extractSheetLeads(rows);
  if (parsed.length > 10000) throw new Error("حد الاستيراد 10000 عميل في الملف الواحد. قسم الملف لعدة أجزاء");
  return parsed;
}
