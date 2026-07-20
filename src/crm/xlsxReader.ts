type ZipEntry = { method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

async function inflateRaw(bytes: Uint8Array) {
  if (!("DecompressionStream" in window)) throw new Error("المتصفح لا يدعم قراءة ملفات Excel المضغوطة");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new Error("ارفع ملف Excel بصيغة .xlsx");
  if (file.size > 20 * 1024 * 1024) throw new Error("حجم ملف Excel أكبر من الحد المسموح 20MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (u32(view, offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error("ملف Excel غير صالح");
  const entryCount = u16(view, endOffset + 10);
  if (entryCount > 1000) throw new Error("ملف Excel يحتوي على عدد غير طبيعي من المكونات");
  let offset = u32(view, endOffset + 16);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, offset) !== 0x02014b50) throw new Error("تعذر قراءة فهرس ملف Excel");
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    if (uncompressedSize > 30 * 1024 * 1024) throw new Error("أحد مكونات ملف Excel أكبر من الحد الآمن");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("محتوى ملف Excel بعد فك الضغط أكبر من الحد الآمن");
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  async function read(name: string) {
    const entry = entries.get(name);
    if (!entry) return "";
    if (u32(view, entry.localOffset) !== 0x04034b50) throw new Error(`مدخل Excel غير صالح: ${name}`);
    const nameLength = u16(view, entry.localOffset + 26);
    const extraLength = u16(view, entry.localOffset + 28);
    const start = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = bytes.slice(start, start + entry.compressedSize);
    const data = entry.method === 0 ? compressed : entry.method === 8 ? await inflateRaw(compressed) : null;
    if (!data) throw new Error(`طريقة ضغط غير مدعومة داخل Excel: ${entry.method}`);
    if (entry.uncompressedSize && data.length !== entry.uncompressedSize) throw new Error(`حجم مكون Excel غير متطابق: ${name}`);
    return decoder.decode(data);
  }
  return { read };
}

function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("تعذر قراءة مكونات ملف Excel");
  return doc;
}

function excelDate(serial: number, date1904: boolean) {
  if (!Number.isFinite(serial)) return "";
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86400000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function dateStyleIndexes(stylesText: string) {
  const indexes = new Set<number>();
  if (!stylesText) return indexes;
  const styles = xml(stylesText);
  const builtInDateIds = new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
  const custom = new Map<number, string>();
  for (const item of styles.querySelectorAll("numFmts > numFmt")) {
    custom.set(Number(item.getAttribute("numFmtId")), item.getAttribute("formatCode") || "");
  }
  [...styles.querySelectorAll("cellXfs > xf")].forEach((item, index) => {
    const id = Number(item.getAttribute("numFmtId") || 0);
    const cleaned = (custom.get(id) || "").replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
    if (builtInDateIds.has(id) || /[ymd]/i.test(cleaned)) indexes.add(index);
  });
  return indexes;
}

export async function readXlsx(file: File): Promise<Record<string, string>[]> {
  const archive = await unzip(file);
  const [sharedXml, stylesText, workbookText] = await Promise.all([
    archive.read("xl/sharedStrings.xml"),
    archive.read("xl/styles.xml"),
    archive.read("xl/workbook.xml"),
  ]);
  const shared = sharedXml ? [...xml(sharedXml).querySelectorAll("si")].map((item) => [...item.querySelectorAll("t")].map((node) => node.textContent || "").join("")) : [];
  const dateStyles = dateStyleIndexes(stylesText);
  const date1904 = Boolean(workbookText && /date1904=["'](?:1|true)["']/i.test(workbookText));
  const sheetText = await archive.read("xl/worksheets/sheet1.xml");
  if (!sheetText) throw new Error("لم يتم العثور على أول شيت داخل الملف");
  const sheet = xml(sheetText);
  const matrix: string[][] = [];
  for (const row of sheet.querySelectorAll("sheetData > row")) {
    const values: string[] = [];
    for (const cell of row.querySelectorAll("c")) {
      const index = columnIndex(cell.getAttribute("r") || "A1");
      const type = cell.getAttribute("t") || "";
      const raw = cell.querySelector("v")?.textContent || "";
      const styleIndex = Number(cell.getAttribute("s") || 0);
      const value = type === "s"
        ? shared[Number(raw)] || ""
        : type === "inlineStr"
          ? [...cell.querySelectorAll("is t")].map((node) => node.textContent || "").join("")
          : dateStyles.has(styleIndex) && raw !== ""
            ? excelDate(Number(raw), date1904)
            : raw;
      values[index] = value;
    }
    matrix.push(values);
  }
  const headers = (matrix.shift() || []).map((value) => value.trim());
  if (!headers.length) return [];
  return matrix
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
}
