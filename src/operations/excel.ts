const encoder = new TextEncoder();
const decoder = new TextDecoder();

function xml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function columnIndex(reference: string) {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + (letter.charCodeAt(0) - 64);
  return result - 1;
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

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}
function u32(value: number) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}
function join(parts: Uint8Array[]) {
  const total = parts.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const item of parts) { output.set(item, offset); offset += item.length; }
  return output;
}

function zipStore(entries: Array<{ name: string; data: Uint8Array }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = join([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name, entry.data,
    ]);
    localParts.push(local);
    centralParts.push(join([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = join(centralParts);
  const end = join([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return join([...localParts, central, end]);
}

function sheetXml(headers: string[], rows: Array<Record<string, unknown>>) {
  const all = [Object.fromEntries(headers.map((header) => [header, header])), ...rows];
  const rowXml = all.map((row, rowIndex) => {
    const cells = headers.map((header, column) => {
      const reference = `${columnName(column)}${rowIndex + 1}`;
      const value = row[header];
      return `<c r="${reference}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const last = `${columnName(Math.max(0, headers.length - 1))}${Math.max(1, all.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>${rowXml}</sheetData></worksheet>`;
}

export function downloadXlsx(filename: string, sheetName: string, rows: Array<Record<string, unknown>>, headers?: string[]) {
  const columns = headers?.length ? headers : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const entries = [
    { name: "[Content_Types].xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheetXml(columns, rows)) },
  ];
  const blob = new Blob([zipStore(entries) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`; anchor.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = "", row: string[] = [], quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(current); current = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(current); rows.push(row); current = ""; row = [];
    } else current += char;
  }
  if (current || row.length) { row.push(current); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((item) => item.some(Boolean)).map((item) => Object.fromEntries(headers.map((header, column) => [header.replace(/^\ufeff/, ""), item[column] || ""])));
}

async function unzipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("ملف Excel غير صالح");
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const result = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error("تعذر قراءة ملف Excel");
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.slice(pointer + 46, pointer + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) {
      const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error("طريقة ضغط غير مدعومة داخل ملف Excel");
    result.set(name, data);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

export async function readSpreadsheet(file: File): Promise<Array<Record<string, string>>> {
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsv(await file.text());
  const entries = await unzipEntries(await file.arrayBuffer());
  const sheetBytes = entries.get("xl/worksheets/sheet1.xml");
  if (!sheetBytes) throw new Error("لا توجد ورقة بيانات داخل الملف");
  const sharedBytes = entries.get("xl/sharedStrings.xml");
  const parser = new DOMParser();
  const shared = sharedBytes ? Array.from(parser.parseFromString(decoder.decode(sharedBytes), "application/xml").getElementsByTagName("si")).map((node) => Array.from(node.getElementsByTagName("t")).map((text) => text.textContent || "").join("")) : [];
  const documentXml = parser.parseFromString(decoder.decode(sheetBytes), "application/xml");
  const rows = Array.from(documentXml.getElementsByTagName("row")).map((row) => {
    const values: string[] = [];
    Array.from(row.getElementsByTagName("c")).forEach((cell) => {
      const reference = cell.getAttribute("r") || "A1";
      const type = cell.getAttribute("t");
      const raw = cell.getElementsByTagName("v")[0]?.textContent || "";
      const inline = Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
      values[columnIndex(reference)] = type === "s" ? (shared[Number(raw)] || "") : type === "inlineStr" ? inline : raw;
    });
    return values;
  });
  const headers = rows.shift() || [];
  return rows.filter((row) => row.some((value) => value !== undefined && value !== "")).map((row) => Object.fromEntries(headers.map((header, index) => [header || `عمود ${index + 1}`, row[index] || ""])));
}
