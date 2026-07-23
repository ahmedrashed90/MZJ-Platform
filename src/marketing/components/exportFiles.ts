type ExportCell = string | number | boolean | null | undefined;

export type ZipTextFile = {
  name: string;
  content: string;
};

function saveBlob(fileName: string, blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function xmlEscape(value: ExportCell) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeWorksheetName(value: string) {
  const cleaned = value.replace(/[\\/?*\[\]:]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

export function downloadSpreadsheetXml(
  fileName: string,
  sheetName: string,
  rows: readonly (readonly ExportCell[])[],
) {
  const tableRows = rows.map((row) => {
    const cells = row.map((cell) => {
      const type = typeof cell === "number" && Number.isFinite(cell) ? "Number" : "String";
      return `<Cell><Data ss:Type="${type}">${xmlEscape(cell)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:ReadingOrder="RightToLeft"/><Font ss:FontName="Tajawal"/></Style>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#F3E2D7" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="${xmlEscape(safeWorksheetName(sheetName))}">
  <Table>${tableRows}</Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><DisplayRightToLeft/></WorksheetOptions>
 </Worksheet>
</Workbook>`;

  saveBlob(fileName, new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" }));
}

function csvEscape(value: ExportCell) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function buildCsv(rows: readonly (readonly ExportCell[])[]) {
  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(",")).join("\r\n")}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F);
  const dosDate = (((year - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
  return { dosDate, dosTime };
}

function concatBytes(parts: readonly Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function localHeader(name: Uint8Array, data: Uint8Array, crc: number, dosDate: number, dosTime: number) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034B50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, data.byteLength, true);
  view.setUint32(22, data.byteLength, true);
  view.setUint16(26, name.byteLength, true);
  view.setUint16(28, 0, true);
  return bytes;
}

function centralHeader(name: Uint8Array, data: Uint8Array, crc: number, dosDate: number, dosTime: number, localOffset: number) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014B50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, data.byteLength, true);
  view.setUint32(24, data.byteLength, true);
  view.setUint16(28, name.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  return bytes;
}

function endOfCentralDirectory(entries: number, centralSize: number, centralOffset: number) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054B50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entries, true);
  view.setUint16(10, entries, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return bytes;
}

export function buildStoredZip(files: readonly ZipTextFile[]) {
  const encoder = new TextEncoder();
  const timestamp = dosDateTime(new Date());
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name.replaceAll("\\", "/"));
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = localHeader(name, data, crc, timestamp.dosDate, timestamp.dosTime);
    localParts.push(header, name, data);
    centralParts.push(centralHeader(name, data, crc, timestamp.dosDate, timestamp.dosTime, localOffset), name);
    localOffset += header.byteLength + name.byteLength + data.byteLength;
  }

  const localData = concatBytes(localParts);
  const centralData = concatBytes(centralParts);
  const end = endOfCentralDirectory(files.length, centralData.byteLength, localData.byteLength);
  const zip = concatBytes([localData, centralData, end]);
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}

export function downloadStoredZip(fileName: string, files: readonly ZipTextFile[]) {
  saveBlob(fileName, new Blob([buildStoredZip(files)], { type: "application/zip" }));
}
