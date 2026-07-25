import { readXlsx } from "../crm/xlsxReader";

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeSpreadsheetText(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

const writerFields = [
  ["proposedName", "الاسم المقترح للكرييتيف"],
  ["goal", "الهدف"],
  ["mainMessage", "الرسالة الأساسية"],
  ["hook", "الهوك"],
  ["mainScript", "السكريبت الأساسي"],
  ["cta", "CTA"],
  ["caption", "Caption"],
  ["hashtags", "Hashtag"],
] as const;

const writerKeys = new Set(writerFields.map(([key]) => key));

function u16(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipStore(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const stamp = dosDateTime();
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    localParts.push(local);
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }

  const centralDirectory = concat(centralParts);
  return concat([
    ...localParts,
    centralDirectory,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);
}

function inlineCell(reference: string, value: unknown, style: number) {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(safeSpreadsheetText(value))}</t></is></c>`;
}

function safeFileName(value: unknown) {
  return String(value || "task-template").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "task-template";
}

export function buildTaskTemplateWorkbook(task: any) {
  const rows: Array<{ key: string; label: string; value: string; writer: boolean; height: number; long?: boolean }> = [
    { key: "campaignName", label: "اسم الحملة", value: task.source_name || "", writer: false, height: 25 },
    { key: "campaignCode", label: "رقم الحملة", value: task.campaign_code || "", writer: false, height: 25 },
    { key: "campaignType", label: "نوع الحملة", value: task.campaign_type_name || task.campaign_type || (task.source_type === "agenda" ? "أجندة" : ""), writer: false, height: 25 },
    { key: "taskNo", label: "رقم التاسك", value: task.task_no || task.instance_code || "", writer: false, height: 25 },
    { key: "creativeType", label: "نوع الكرييتيف", value: task.creative_name || "", writer: false, height: 28 },
    { key: "dueDate", label: "تاريخ التسليم", value: String(task.template_due_on || task.due_at || "").slice(0, 10), writer: false, height: 25 },
    { key: "departmentNote", label: "ملاحظة القسم", value: task.template_department_note || task.note || "", writer: false, height: 46, long: true },
    ...writerFields.map(([key, label]) => ({
      key,
      label,
      value: String(task.template_data?.[key] || ""),
      writer: true,
      height: key === "mainScript" ? 120 : key === "mainMessage" || key === "caption" ? 66 : key === "goal" || key === "hook" || key === "hashtags" ? 44 : 30,
      long: ["goal", "mainMessage", "hook", "mainScript", "caption", "hashtags"].includes(key),
    })),
  ];

  const bodyRows = rows.map((row, index) => {
    const excelRow = index + 2;
    const keyStyle = row.writer ? 5 : 2;
    const labelStyle = row.writer ? 6 : 3;
    const valueStyle = row.writer ? (row.long ? 8 : 7) : (row.long ? 9 : 4);
    return `<row r="${excelRow}" ht="${row.height}" customHeight="1">${inlineCell(`A${excelRow}`, row.key, keyStyle)}${inlineCell(`B${excelRow}`, row.label, labelStyle)}${inlineCell(`C${excelRow}`, row.value, valueStyle)}</row>`;
  }).join("");

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Tajawal"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Tajawal"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Tajawal"/><family val="2"/></font>
    <font><color rgb="FF2563EB"/><sz val="11"/><name val="Tajawal"/><family val="2"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF7C3B2E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7EEE9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFBF8"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE7C8B8"/></left>
      <right style="thin"><color rgb="FFE7C8B8"/></right>
      <top style="thin"><color rgb="FFE7C8B8"/></top>
      <bottom style="thin"><color rgb="FFE7C8B8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" readingOrder="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top" readingOrder="2" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:C${rows.length + 1}"/>
  <sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="C9" sqref="C9"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="22"/>
  <cols>
    <col min="1" max="1" width="27" customWidth="1"/>
    <col min="2" max="2" width="34" customWidth="1"/>
    <col min="3" max="3" width="58" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1" ht="30" customHeight="1">${inlineCell("A1", "key", 1)}${inlineCell("B1", "الحقل", 1)}${inlineCell("C1", "القيمة", 1)}</row>
    ${bodyRows}
  </sheetData>
  <autoFilter ref="A1:C${rows.length + 1}"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="portrait" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  return zipStore([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Task Template" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", content: styles },
    { name: "xl/worksheets/sheet1.xml", content: worksheet },
  ]);
}

export function downloadTaskTemplate(task: any) {
  const bytes = buildTaskTemplateWorkbook(task);
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${safeFileName(task.task_no || task.instance_code || "task-template")}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

export async function parseTaskTemplate(file: File) {
  const rows = await readXlsx(file);
  if (!rows.length) throw new Error("ملف Task Template فارغ أو غير صالح");

  const output: Record<string, string> = {};
  for (const row of rows) {
    const key = String(row.key || row.Key || "").trim();
    if (!writerKeys.has(key as (typeof writerFields)[number][0])) continue;
    output[key] = String(row["القيمة"] ?? row.value ?? row.Value ?? "").trim();
  }

  if (!Object.keys(output).length) throw new Error("ارفع نفس ملف Task Template بصيغة .xlsx بدون تغيير أعمدة key والحقل والقيمة");
  for (const [key] of writerFields) if (!(key in output)) output[key] = "";
  return output;
}

export function relationshipCsv(rows: Array<Record<string, unknown>>) {
  const headers = ["اليوم", "الكرييتيف", "القسم", "المسؤول", "كاتب المحتوى", "تاريخ الاستلام", "الملاحظة"];
  const keys = ["day", "creative", "department", "user", "contentUser", "dueOn", "note"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return `\uFEFF${headers.map(escape).join(",")}\n${rows.map((row) => keys.map((key) => escape(row[key])).join(",")).join("\n")}`;
}