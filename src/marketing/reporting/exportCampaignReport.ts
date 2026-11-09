import type { CampaignReportRow, CampaignReportProvider } from '../../../shared/campaign-report';

/** Use the same filtered campaigns for the on-screen report and Excel export. */
export function filterCampaignReportRows(rows: CampaignReportRow[], platform: string, search: string): CampaignReportRow[] {
  const searchText = search.trim().toLocaleLowerCase();
  return rows.filter(item => (platform === 'all' || item.platform === platform) &&
    (!searchText || `${item.campaignName} ${item.accountName} ${item.platformName}`.toLocaleLowerCase().includes(searchText)));
}


/** Self-contained Office Open XML export: genuine .xlsx without an external
 * library, not CSV renamed as Excel. No uploaded fonts or downloaded services.
 */
const sanitizeXml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// Treat provider campaign names as literal text; XML/HTML escaping is handled
// at serialization time. Stripping <...> can silently remove real name data.
const safeText = (value: unknown) => String(value ?? '').slice(0, 32767);
const cell = (col: string, row: number, value: unknown, style = 0, numeric = false) => numeric && typeof value === 'number' && Number.isFinite(value)
  ? `<c r="${col}${row}" s="${style}"><v>${value}</v></c>`
  : `<c r="${col}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${sanitizeXml(value === null || value === undefined ? '—' : safeText(value))}</t></is></c>`;
const fmt = (value: number | null) => value === null ? '—' : value.toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const byteEncoder = new TextEncoder();
const little16 = (output: DataView, offset: number, value: number) => output.setUint16(offset, value, true);
const little32 = (output: DataView, offset: number, value: number) => output.setUint32(offset, value, true);
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let value = i; for (let j = 0; j < 8; j++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1); table[i] = value >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(parts: Array<[string, string]>) {
  const buffers: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of parts) {
    const nameBytes = byteEncoder.encode(name), payload = byteEncoder.encode(content), crc = crc32(payload);
    const local = new Uint8Array(30 + nameBytes.length + payload.length), view = new DataView(local.buffer);
    little32(view, 0, 0x04034b50); little16(view, 4, 20); little16(view, 6, 0x0800); // UTF-8
    little16(view, 8, 0); little32(view, 14, crc); little32(view, 18, payload.length); little32(view, 22, payload.length);
    little16(view, 26, nameBytes.length); local.set(nameBytes, 30); local.set(payload, 30 + nameBytes.length);
    buffers.push(local);
    const entry = new Uint8Array(46 + nameBytes.length), e = new DataView(entry.buffer);
    little32(e, 0, 0x02014b50); little16(e, 4, 20); little16(e, 6, 20); little16(e, 8, 0x0800);
    little32(e, 16, crc); little32(e, 20, payload.length); little32(e, 24, payload.length); little16(e, 28, nameBytes.length);
    little32(e, 42, offset); entry.set(nameBytes, 46); central.push(entry);
    offset += local.length;
  }
  const centralSize = central.reduce((n, entry) => n + entry.length, 0);
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  little32(view, 0, 0x06054b50); little16(view, 8, central.length); little16(view, 10, central.length);
  little32(view, 12, centralSize); little32(view, 16, offset);
  // Assemble the ZIP into an owned ArrayBuffer. BlobPart requires ArrayBuffer,
  // not a Uint8Array whose backing buffer may be SharedArrayBuffer.
  const archive = new ArrayBuffer(offset + centralSize + end.length);
  const output = new Uint8Array(archive);
  let position = 0;
  for (const part of [...buffers, ...central, end]) {
    output.set(part, position);
    position += part.length;
  }
  return new Blob([archive], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function campaignReportXlsx(rows: CampaignReportRow[], providers: CampaignReportProvider[], from: string, to: string) {
  // An empty export previously produced a valid but misleading blank workbook.
  if (!rows.length) throw new Error('لا توجد حملات مطابقة للتاريخ والفلاتر المحددة لتصديرها إلى Excel.');
  const columns = 'ABCDEFGHI'.split('');
  const heading = ['المنصة', 'الحساب الإعلاني', 'الحملة', 'العملة', 'المبلغ المصروف', 'إجمالي الليدات', 'تكلفة الليد', 'تفاعلات الإعلانات', 'النقرات'];
  const values: string[] = [];
  const row = (n: number, cells: string[], height = 22) => `<row r="${n}" ht="${height}" customHeight="1">${cells.join('')}</row>`;
  values.push(row(1, [cell('A', 1, 'محمد ذعار العجمي للسيارات | تقرير الحملات الإعلانية', 2)], 34));
  values.push(row(2, [cell('A', 2, `الفترة: ${from} إلى ${to} | تاريخ الإصدار: ${new Date().toLocaleString('ar-SA-u-nu-latn')}`, 3)], 29));
  values.push(row(4, [cell('A', 4, `عدد الحملات: ${rows.length} | العملة: SAR`, 7), cell('D', 4, `المنصات: ${[...new Set(rows.map(x => x.platformName))].join('، ') || '—'}`, 7)], 28));
  values.push(row(6, columns.map((col, idx) => cell(col, 6, heading[idx], 1)), 30));
  rows.forEach((item, index) => {
    const n = index + 7;
    values.push(row(n, [
      cell('A', n, item.platformName, index % 2 ? 8 : 0),
      cell('B', n, item.accountName, index % 2 ? 8 : 0),
      cell('C', n, item.campaignName, index % 2 ? 8 : 0),
      cell('D', n, 'SAR', index % 2 ? 8 : 0),
      cell('E', n, item.spend, item.spend === null ? 6 : 5, item.spend !== null),
      cell('F', n, item.leads, item.leads === null ? 6 : 4, item.leads !== null),
      cell('G', n, item.costPerLead, item.costPerLead === null ? 6 : 5, item.costPerLead !== null),
      cell('H', n, item.interactions, item.interactions === null ? 6 : 4, item.interactions !== null),
      cell('I', n, item.clicks, item.clicks === null ? 6 : 4, item.clicks !== null),
    ], 25));
  });
  const notesStart = rows.length + 9;
  values.push(row(notesStart, [cell('A', notesStart, 'ملاحظات عن البيانات', 7)], 27));
  values.push(row(notesStart + 1, [cell('A', notesStart + 1, '— تعني أن المنصة لم توفر البيانات أو أن القسمة غير ممكنة. لا تعني صفرًا.', 9)], 27));
  values.push(row(notesStart + 2, [cell('A', notesStart + 2, 'جميع المبالغ بالريال السعودي (SAR). الدولار الأمريكي يحوّل × 3.75؛ العملة غير المحددة لا تُحوّل بالتخمين. تكلفة الليد = الإنفاق ÷ الليدات.', 9)], 27));
  values.push(row(notesStart + 3, [cell('A', notesStart + 3, 'التفاعلات هي مقاييس المنصات الإعلانية المتاحة، وقد تختلف طريقة احتسابها بين المنصات.', 9)], 27));
  values.push(row(notesStart + 4, [cell('A', notesStart + 4, 'المبلغ المصروف يعكس تكلفة الإعلانات خلال الفترة، وليس خصومات البطاقة أو الدفعات والفواتير؛ قد تختلف الضرائب وتواريخ الخصم وفترات الحساب.', 9)], 27));
  providers.forEach((provider, index) => values.push(row(notesStart + 5 + index, [cell('A', notesStart + 5 + index,
    `${provider.name}: ${provider.status === 'ready' ? 'متصل' : 'غير متاح'} | ${provider.note || ''} ${provider.incomplete ? '| بعض النتائج غير مكتملة' : ''}`, 9)], 27)));
  const last = Math.max(6, 6 + rows.length);
  const merges = ['A1:I1','A2:I2','A4:C4','D4:I4', ...Array.from({length: 5 + providers.length}, (_, i) => `A${notesStart + i}:I${notesStart + i}`)];
  const finalRow = notesStart + 4 + providers.length;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:I${finalRow}"/><sheetViews><sheetView workbookViewId="0" rightToLeft="1" showGridLines="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A7" sqref="A7"/></sheetView></sheetViews>`+
    `<sheetFormatPr defaultRowHeight="20"/><cols>${[21,32,56,14,23,23,23,23,19].map((w,i) => `<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`+
    `<sheetData>${values.join('')}</sheetData>`+
    // OOXML CT_Worksheet sequence requires autoFilter BEFORE mergeCells.
    // Reversing these generated files that Excel opened only after repair, dropping sheet1.xml.
    `<autoFilter ref="A6:I${last}"/>`+
    `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`+
    `<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>`+
    `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const fill = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
  const font = (size: number, rgb: string, bold = false, italic = false) => `<font>${bold ? '<b/>' : ''}${italic ? '<i/>' : ''}<sz val="${size}"/><color rgb="${rgb}"/><name val="Arial"/><family val="2"/></font>`;
  const xf = (fontId: number, fillId: number, format = 0, wrap = false) => `<xf numFmtId="${format}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center" ${wrap ? 'wrapText="1"' : ''}/></xf>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="6">${font(11,'FF28394F')}${font(11,'FFFFFFFF',true)}${font(17,'FFFFFFFF',true)}${font(11,'FF607186',true)}${font(11,'FF718099',false,true)}${font(11,'FF136C76',true)}</fonts>`+
    `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('FF1D3853')}${fill('FFEDF4F7')}${fill('FFF3F7FA')}</fills>`+
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`+
    `<cellXfs count="10">${xf(0,0)}${xf(1,2)}${xf(2,2)}${xf(3,3)}${xf(0,0,3)}${xf(0,0,4)}${xf(4,0)}${xf(5,3)}${xf(0,4)}${xf(3,0,0,true)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="تقرير الحملات" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet], ['xl/styles.xml', styles],
  ]);
}

/** PDF export uses Chromium/Edge's native Arabic layout and Save as PDF.
 * Unlike a tiny ASCII-only PDF generator, this preserves Arabic glyph shaping,
 * RTL tables, colors, and page breaks without uploading a font file.
 */
const html = (value: unknown) => sanitizeXml(safeText(value));
export function printCampaignReportPdf(rows: CampaignReportRow[], providers: CampaignReportProvider[], from: string, to: string) {
  const printWindow = window.open('', '_blank', 'width=1200,height=900');
  if (!printWindow) throw new Error('اسمح بفتح نافذة الطباعة لتصدير PDF، ثم اختر «حفظ كملف PDF».');
  const stat = (label: string, value: string) => `<div class="stat"><small>${html(label)}</small><b>${html(value)}</b></div>`;
  const spendKnown = rows.length > 0 && rows.every(row => row.spend !== null);
  const leadsKnown = rows.length > 0 && rows.every(row => row.leads !== null);
  const spend = rows.reduce((sum, row) => sum + (row.spend || 0), 0);
  const leads = rows.reduce((sum, row) => sum + (row.leads || 0), 0);
  const sums = stat('الإنفاق (SAR)', spendKnown ? fmt(spend) : 'غير مكتمل') +
    stat('الليدات', leadsKnown ? fmt(leads) : 'غير مكتمل') +
    stat('CPL (SAR)', spendKnown && leadsKnown && leads > 0 ? fmt(spend / leads) : '—');
  const charts = ([['interactions', 'تفاعلات الإعلانات'], ['leads','عدد الليدات'], ['costPerLead','تكلفة الليد']] as const).map(([key, label]) => {
    const sorted = [...rows].filter(row => row[key] !== null).sort((a,b) => (b[key] || 0) - (a[key] || 0)).slice(0, 9);
    const max = Math.max(1, ...sorted.map(row => row[key] || 0));
    return `<section class="chart"><h2>${html(label)}</h2>${sorted.length ? sorted.map(row => `<div class="barrow"><span>${html(row.campaignName)}</span><i><u style="width:${Math.max(0,((row[key]||0)/max)*100)}%"></u></i><strong>${html(fmt(row[key]))}${key === 'costPerLead' ? ' ر.س' : ''}</strong></div>`).join('') : '<p>لا توجد بيانات متاحة لهذا المقياس.</p>'}</section>`;
  }).join('');
  const page = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>تقرير حملات MZJ ${from} - ${to}</title><style>
    @page { size:A4 landscape; margin:11mm; } * { box-sizing:border-box; } body { margin:0; padding:26px; font-family:Tahoma,Arial,sans-serif; font-size:10px; color:#24364b; direction:rtl; background:#fff; }
    .cover { padding:22px 24px; color:#fff; border-radius:14px; background:#1d3853; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    h1 { font-size:24px; margin:0 0 7px; } .cover p {margin:0;color:#d5e9ef;font-size:12px} .facts { margin:16px 0; display:flex; flex-wrap:wrap; gap:9px; }
    .stat {background:#edf4f7;border:1px solid #dae5eb;border-radius:9px;padding:12px 17px;min-width:125px; -webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .stat small{display:block;color:#657487;font-size:10px}.stat b{display:block;font-size:16px;margin-top:6px}
    h2 {font-size:13px;margin:0 0 12px;color:#1d3853;} table {width:100%;border-collapse:collapse;table-layout:fixed;} th {background:#1d3853;color:white;padding:10px 7px;text-align:right;-webkit-print-color-adjust:exact;print-color-adjust:exact;} td {padding:9px 7px;border-bottom:1px solid #e6edf1;vertical-align:middle;overflow-wrap:anywhere;} tbody tr:nth-child(even) {background:#f2f7f9;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    th:nth-child(3){width:29%} .n{direction:ltr;unicode-bidi:isolate;white-space:nowrap;text-align:center} .chart {border:1px solid #e0e8ee;border-radius:10px;margin:20px 0;padding:14px;break-inside:avoid;page-break-inside:avoid;} .barrow {display:grid;grid-template-columns:150px 1fr 95px;gap:10px;align-items:center;margin:8px 0;} .barrow span {overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.barrow i {height:10px;display:block;background:#edf4f7;border-radius:9px;overflow:hidden;} .barrow u{display:block;height:100%;border-radius:9px;background:#258995;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.barrow strong{font-weight:600;text-align:left}
    .notice {color:#5c6f82;line-height:1.8;background:#f7fafb;border-radius:9px;padding:10px;margin:16px 0;}.footer {margin-top:24px;border-top:1px solid #d9e4eb;padding-top:12px;color:#718296;}thead{display:table-header-group}tr{break-inside:avoid;}@media print{body{padding:0;}}
    </style></head><body><header class="cover"><h1>تقرير الحملات الإعلانية</h1><p>محمد ذعار العجمي للسيارات • من ${html(from)} إلى ${html(to)} • أُعد ${html(new Date().toLocaleString('ar-SA-u-nu-latn'))}</p></header>
    <div class="facts">${stat('عدد الحملات', String(rows.length))}${sums}</div>
    <h2>الحملات ومؤشرات الأداء</h2><table><thead><tr>${['المنصة','الحساب','الحملات','العملة','المبلغ المصروف','إجمالي الليدات','تكلفة الليد','تفاعلات الإعلانات','النقرات'].map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td>${html(row.platformName)}</td><td>${html(row.accountName)}</td><td>${html(row.campaignName)}</td><td class="n">SAR</td><td class="n">${html(fmt(row.spend))}</td><td class="n">${html(fmt(row.leads))}</td><td class="n">${html(fmt(row.costPerLead))}</td><td class="n">${html(fmt(row.interactions))}</td><td class="n">${html(fmt(row.clicks))}</td></tr>`).join('') || '<tr><td colspan="9">لا توجد حملات في النطاق المحدد.</td></tr>'}</tbody></table>
    <div class="charts">${charts}</div><aside class="notice">— تعني أن منصة الإعلانات لم توفر المقياس أو لا يمكن حسابه؛ لا تعني صفرًا. تكلفة الليد = الإنفاق ÷ عدد الليدات. جميع المبالغ بالريال السعودي؛ الدولار الأمريكي يُحوّل × 3.75. العملات غير المعروفة لا تُحوّل بالتخمين. مقاييس التفاعلات تختلف بين المنصات. ${providers.filter(p=>p.status!=='ready'||p.incomplete).map(p=>`${html(p.name)}: ${html(p.note||'البيانات غير مكتملة')}`).join(' • ')}</aside>
    <footer class="footer">تقرير MZJ • مصدر البيانات: واجهات المنصات الإعلانية المرتبطة بالنظام، وليس سجلات CRM.</footer>
    <script>window.addEventListener('load',()=>{setTimeout(()=>{window.focus();window.print()},250)});<\/script></body></html>`;
  printWindow.document.open(); printWindow.document.write(page); printWindow.document.close();
  return printWindow;
}

export function downloadCampaignReportXlsx(rows: CampaignReportRow[], providers: CampaignReportProvider[], from: string, to: string) {
  const blob = campaignReportXlsx(rows, providers, from, to);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `MZJ-Campaign-Report-${from}-to-${to}.xlsx`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
