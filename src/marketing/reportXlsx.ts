type ReportCellValue = string | number | boolean | null | undefined;

export type MarketingReportColumn<Row> = {
  key: keyof Row | string;
  label: string;
  width?: number;
  align?: "right" | "center" | "left";
};

export type MarketingReportOptions<Row extends Record<string, ReportCellValue>> = {
  filename: string;
  sheetName: string;
  title: string;
  subtitle?: string;
  generatedAtLabel?: string;
  columns: MarketingReportColumn<Row>[];
  rows: Row[];
};

type ZipEntry = { name: string; content: string | Uint8Array };

function sanitizeXmlText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\r\n?/g, "\n");
}

function xmlEscape(value: unknown) {
  return sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeSpreadsheetText(value: unknown) {
  const text = sanitizeXmlText(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
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

function dosDateTime(date = new Date()) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipStore(files: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const stamp = dosDateTime();
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);
    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    const localEntry = concat([localHeader, data]);
    localParts.push(localEntry);
    centralParts.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.day),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name,
    ]));
    offset += localEntry.length;
  }

  const centralDirectory = concat(centralParts);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return concat([...localParts, centralDirectory, end]);
}

function cellXml(ref: string, value: ReportCellValue, style: number) {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = safeSpreadsheetText(value);
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function cleanSheetName(value: string) {
  return sanitizeXmlText(value).replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || "تقرير";
}

export function safeMarketingReportFilename(value: string) {
  return sanitizeXmlText(value).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "تقرير";
}

export function buildMarketingReportXlsxBytes<Row extends Record<string, ReportCellValue>>(options: MarketingReportOptions<Row>) {
  if (!options.columns.length) throw new Error("يجب إضافة عمود واحد على الأقل إلى تقرير Excel");

  const columns = options.columns;
  const lastColumn = columnName(columns.length - 1);
  const sheetName = cleanSheetName(options.sheetName);
  const generatedAt = options.generatedAtLabel || `تاريخ التصدير: ${new Date().toLocaleString("ar-SA-u-nu-latn")}`;
  const sheetRows: string[] = [];

  sheetRows.push(`<row r="1" ht="36" customHeight="1">${cellXml("A1", options.title, 1)}</row>`);
  sheetRows.push(`<row r="2" ht="27" customHeight="1">${cellXml("A2", options.subtitle || "", 2)}</row>`);
  sheetRows.push(`<row r="3" ht="23" customHeight="1">${cellXml("A3", generatedAt, 3)}</row>`);
  sheetRows.push('<row r="4" ht="9" customHeight="1"/>');
  sheetRows.push(`<row r="5" ht="30" customHeight="1">${columns.map((column, index) => cellXml(`${columnName(index)}5`, column.label, 4)).join("")}</row>`);

  options.rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 6;
    const stripedRightStyle = rowIndex % 2 === 0 ? 5 : 6;
    const stripedCenterStyle = rowIndex % 2 === 0 ? 7 : 9;
    const stripedLeftStyle = rowIndex % 2 === 0 ? 8 : 10;
    const cells = columns.map((column, columnIndex) => {
      const style = column.align === "center" ? stripedCenterStyle : column.align === "left" ? stripedLeftStyle : stripedRightStyle;
      return cellXml(`${columnName(columnIndex)}${excelRow}`, row[String(column.key)], style);
    }).join("");
    sheetRows.push(`<row r="${excelRow}" ht="27" customHeight="1">${cells}</row>`);
  });

  if (!options.rows.length) {
    sheetRows.push(`<row r="6" ht="42" customHeight="1">${cellXml("A6", "لا توجد بيانات متاحة للتصدير", 11)}</row>`);
  }

  const dataEndRow = Math.max(6, options.rows.length + 5);
  const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(60, Math.max(10, Number(column.width || 18)))}" bestFit="1" customWidth="1"/>`).join("");
  const titleMerges = columns.length > 1
    ? `<mergeCells count="3"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/><mergeCell ref="A3:${lastColumn}3"/></mergeCells>`
    : "";
  const nowIso = new Date().toISOString();

  const files: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(options.title)}</dc:title><dc:creator>MZJ Platform</dc:creator><cp:lastModifiedBy>MZJ Platform</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>MZJ Platform</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${xmlEscape(sheetName)}</vt:lpstr></vt:vector></TitlesOfParts><Company>MZJ Workspace</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.19.4</AppVersion></Properties>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Arial"/><family val="2"/><charset val="178"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="18"/><name val="Arial"/><family val="2"/><charset val="178"/></font><font><b/><color rgb="FF6A382E"/><sz val="11"/><name val="Arial"/><family val="2"/><charset val="178"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/><family val="2"/><charset val="178"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7A3B2E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5EAE4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCF7F4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE5D6CF"/></left><right style="thin"><color rgb="FFE5D6CF"/></right><top style="thin"><color rgb="FFE5D6CF"/></top><bottom style="thin"><color rgb="FFE5D6CF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" readingOrder="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" readingOrder="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastColumn}${dataEndRow}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths}</cols><sheetData>${sheetRows.join("")}</sheetData>${titleMerges}<autoFilter ref="A5:${lastColumn}${dataEndRow}"/><printOptions horizontalCentered="1" verticalCentered="0"/><pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`,
    },
  ];

  return zipStore(files);
}

export function downloadMarketingReportXlsx<Row extends Record<string, ReportCellValue>>(options: MarketingReportOptions<Row>) {
  const bytes = buildMarketingReportXlsxBytes(options);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeMarketingReportFilename(options.filename).replace(/\.xlsx$/i, "")}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
