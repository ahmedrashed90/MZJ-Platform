function decodeCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim()); current = "";
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

function parseCsv(content: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const headers = decodeCsvLine(lines.shift() || "");
  return lines.map((line) => Object.fromEntries(headers.map((header, index) => [header, decodeCsvLine(line)[index] || ""])));
}

function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function inflateRaw(data: Uint8Array) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (u32(view, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("ملف Excel غير صالح");
  const entries = u16(view, eocd + 10);
  let directoryOffset = u32(view, eocd + 16);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let entry = 0; entry < entries; entry += 1) {
    if (u32(view, directoryOffset) !== 0x02014b50) break;
    const method = u16(view, directoryOffset + 10);
    const compressedSize = u32(view, directoryOffset + 20);
    const nameLength = u16(view, directoryOffset + 28);
    const extraLength = u16(view, directoryOffset + 30);
    const commentLength = u16(view, directoryOffset + 32);
    const localOffset = u32(view, directoryOffset + 42);
    const name = decoder.decode(bytes.slice(directoryOffset + 46, directoryOffset + 46 + nameLength));
    if (u32(view, localOffset) !== 0x04034b50) throw new Error("تعذر قراءة ملف Excel");
    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    if (method === 0) files.set(name, compressed);
    else if (method === 8) files.set(name, await inflateRaw(compressed));
    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function xmlText(bytes: Uint8Array | undefined) {
  if (!bytes) return "";
  return new TextDecoder().decode(bytes);
}

function columnIndex(reference: string) {
  const letters = reference.replace(/\d/g, "").toUpperCase();
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function parseSharedStrings(xml: string) {
  if (!xml) return [] as string[];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("si")).map((item) => Array.from(item.getElementsByTagName("t")).map((node) => node.textContent || "").join(""));
}

function parseWorksheet(xml: string, sharedStrings: string[]) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("تعذر تحليل ورقة Excel");
  const matrix: string[][] = [];
  for (const rowNode of Array.from(doc.getElementsByTagName("row"))) {
    const row: string[] = [];
    for (const cell of Array.from(rowNode.getElementsByTagName("c"))) {
      const reference = cell.getAttribute("r") || "A1";
      const type = cell.getAttribute("t") || "";
      const valueNode = cell.getElementsByTagName("v")[0];
      const inlineNode = cell.getElementsByTagName("is")[0];
      const raw = valueNode?.textContent || "";
      let value = raw;
      if (type === "s") value = sharedStrings[Number(raw)] || "";
      else if (type === "inlineStr" && inlineNode) value = Array.from(inlineNode.getElementsByTagName("t")).map((node) => node.textContent || "").join("");
      else if (type === "b") value = raw === "1" ? "نعم" : "لا";
      row[columnIndex(reference)] = value;
    }
    matrix.push(row);
  }
  const headers = (matrix.shift() || []).map((value) => String(value || "").trim());
  return matrix.filter((row) => row.some((value) => String(value || "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]).filter(([header]) => header)));
}

async function parseXlsx(file: File) {
  const files = await unzip(await file.arrayBuffer());
  const workbookXml = xmlText(files.get("xl/workbook.xml"));
  const relsXml = xmlText(files.get("xl/_rels/workbook.xml.rels"));
  const workbook = new DOMParser().parseFromString(workbookXml, "application/xml");
  const rels = new DOMParser().parseFromString(relsXml, "application/xml");
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  if (!firstSheet) throw new Error("ملف Excel لا يحتوي على ورقة بيانات");
  const relationshipId = firstSheet.getAttribute("r:id") || firstSheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || "";
  const relationship = Array.from(rels.getElementsByTagName("Relationship")).find((item) => item.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target") || "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sharedStrings = parseSharedStrings(xmlText(files.get("xl/sharedStrings.xml")));
  return parseWorksheet(xmlText(files.get(sheetPath)), sharedStrings);
}

export async function readSpreadsheetRows(file: File): Promise<Array<Record<string, unknown>>> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(await file.text());
  if (lower.endsWith(".xlsx")) return parseXlsx(file);
  throw new Error("الملفات المدعومة هي XLSX وCSV فقط");
}
