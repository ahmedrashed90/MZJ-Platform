const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function setU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function setU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

type ZipEntry = { name: string; data: Uint8Array };

function createZip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    setU32(localView, 0, 0x04034b50);
    setU16(localView, 4, 20);
    setU16(localView, 6, 0x0800);
    setU16(localView, 8, 0);
    setU16(localView, 10, 0);
    setU16(localView, 12, 0);
    setU32(localView, 14, checksum);
    setU32(localView, 18, entry.data.length);
    setU32(localView, 22, entry.data.length);
    setU16(localView, 26, name.length);
    setU16(localView, 28, 0);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    setU32(centralView, 0, 0x02014b50);
    setU16(centralView, 4, 20);
    setU16(centralView, 6, 20);
    setU16(centralView, 8, 0x0800);
    setU16(centralView, 10, 0);
    setU16(centralView, 12, 0);
    setU16(centralView, 14, 0);
    setU32(centralView, 16, checksum);
    setU32(centralView, 20, entry.data.length);
    setU32(centralView, 24, entry.data.length);
    setU16(centralView, 28, name.length);
    setU16(centralView, 30, 0);
    setU16(centralView, 32, 0);
    setU16(centralView, 34, 0);
    setU16(centralView, 36, 0);
    setU32(centralView, 38, 0);
    setU32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  setU32(endView, 0, 0x06054b50);
  setU16(endView, 4, 0);
  setU16(endView, 6, 0);
  setU16(endView, 8, entries.length);
  setU16(endView, 10, entries.length);
  setU32(endView, 12, centralSize);
  setU32(endView, 16, centralOffset);
  setU16(endView, 20, 0);

  const total = localParts.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function worksheetXml(headers: string[], rows: unknown[][]) {
  const allRows = [headers, ...rows];
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastColumn = columnName(Math.max(0, headers.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${Math.max(1, allRows.length)}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastColumn}1"/></worksheet>`;
}

export function buildXlsxBytes(headers: string[], rows: unknown[][], sheetName = "البيانات") {
  const safeSheetName = sheetName.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "البيانات";
  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><bookViews><workbookView/></bookViews><sheets><sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>`) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(worksheetXml(headers, rows)) },
  ];
  return createZip(files);
}

export function exportXlsx(filename: string, headers: string[], rows: unknown[][], sheetName = "البيانات") {
  const bytes = buildXlsxBytes(headers, rows, sheetName);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.(xls|xlsx)$/i, "") + ".xlsx";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function parseDelimitedFile(text: string) {
  const normalized = text.replace(/^\ufeff/, "");
  const delimiter = normalized.includes("\t") ? "\t" : normalized.includes(";") ? ";" : ",";
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const parseLine = (line: string) => {
    const result: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) { result.push(current.trim()); current = ""; }
      else current += char;
    }
    result.push(current.trim());
    return result;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function unzipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let endOffset = -1;
  for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset += 1) {
    if (view.getUint32(offset, true) === 0x06054b50) endOffset = offset;
  }
  if (endOffset < 0) throw new Error("ملف XLSX غير صالح: لم يتم العثور على دليل ZIP.");
  const entriesCount = view.getUint16(endOffset + 10, true);
  let centralOffset = view.getUint32(endOffset + 16, true);
  const result = new Map<string, Uint8Array>();
  for (let index = 0; index < entriesCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error("ملف XLSX غير صالح: دليل الملفات تالف.");
    const compression = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength));
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ملف XLSX غير صالح: رأس الملف الداخلي تالف.");
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (compression === 0) data = compressed;
    else if (compression === 8 && typeof DecompressionStream !== "undefined") {
      const stream = new Blob([compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error("نوع ضغط XLSX غير مدعوم في هذا المتصفح.");
    result.set(name, data);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function xmlDocument(bytes: Uint8Array | undefined, label: string) {
  if (!bytes) throw new Error(`ملف XLSX لا يحتوي على ${label}.`);
  const document = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`تعذر قراءة ${label} داخل XLSX.`);
  return document;
}

function cellColumn(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

async function parseXlsx(buffer: ArrayBuffer) {
  const entries = await unzipEntries(buffer);
  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? [...xmlDocument(entries.get("xl/sharedStrings.xml"), "النصوص المشتركة").querySelectorAll("si")].map((item) => [...item.querySelectorAll("t")].map((node) => node.textContent || "").join(""))
    : [];
  const sheetEntry = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort()[0];
  if (!sheetEntry) throw new Error("ملف XLSX لا يحتوي على ورقة بيانات.");
  const sheet = xmlDocument(entries.get(sheetEntry), "ورقة البيانات");
  const matrix: string[][] = [];
  for (const row of [...sheet.querySelectorAll("sheetData > row")]) {
    const values: string[] = [];
    for (const cell of [...row.querySelectorAll(":scope > c")]) {
      const index = cellColumn(cell.getAttribute("r") || "A1");
      const type = cell.getAttribute("t");
      const raw = type === "inlineStr"
        ? [...cell.querySelectorAll("is t")].map((node) => node.textContent || "").join("")
        : cell.querySelector("v")?.textContent || "";
      values[index] = type === "s" ? sharedStrings[Number(raw)] || "" : raw;
    }
    matrix.push(values.map((value) => value ?? ""));
  }
  const headers = matrix.shift()?.map((value) => value.trim()) || [];
  return matrix
    .filter((row) => row.some((value) => String(value).trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export async function parseExcelFile(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseXlsx(buffer);
  const text = decoder.decode(bytes).replace(/^\ufeff/, "");
  if (/<table[\s>]/i.test(text)) {
    const doc = new DOMParser().parseFromString(text, "text/html");
    const tableRows = [...doc.querySelectorAll("table tr")];
    const headers = [...(tableRows.shift()?.querySelectorAll("th,td") || [])].map((cell) => cell.textContent?.trim() || "");
    return tableRows.map((tr) => Object.fromEntries([...tr.querySelectorAll("td")].map((cell, index) => [headers[index], cell.textContent?.trim() || ""])));
  }
  return parseDelimitedFile(text);
}
