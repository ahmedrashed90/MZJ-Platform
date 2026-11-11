/** Browser-side, dependency-free DOCX export for strategy creative treatments.
 * Creates a standards-compliant WordprocessingML ZIP with Unicode RTL text.
 * Nothing is sent to an external document-generation service. */
const utf8 = new TextEncoder();
const xmlText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function packageZip(entries: Array<[string, string]>): Uint8Array {
  const pieces: Uint8Array[] = [], directory: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, pos: number, n: number) => view.setUint16(pos, n, true);
  const u32 = (view: DataView, pos: number, n: number) => view.setUint32(pos, n, true);
  for (const [filename, content] of entries) {
    const name = utf8.encode(filename), data = utf8.encode(content), crc = checksum(data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800); // UTF-8
    u16(view, 8, 0); u16(view, 10, 0); u16(view, 12, 33); // stored, 1980-01-01
    u32(view, 14, crc); u32(view, 18, data.length); u32(view, 22, data.length);
    u16(view, 26, name.length); u16(view, 28, 0); local.set(name, 30);
    pieces.push(local, data);
    const entry = new Uint8Array(46 + name.length);
    const center = new DataView(entry.buffer);
    u32(center, 0, 0x02014b50); u16(center, 4, 20); u16(center, 6, 20);
    u16(center, 8, 0x0800); u16(center, 10, 0); u16(center, 12, 0); u16(center, 14, 33);
    u32(center, 16, crc); u32(center, 20, data.length); u32(center, 24, data.length);
    u16(center, 28, name.length); u32(center, 42, offset); entry.set(name, 46);
    directory.push(entry); offset += local.length + data.length;
  }
  const directoryLength = directory.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22), tail = new DataView(end.buffer);
  u32(tail, 0, 0x06054b50); u16(tail, 8, entries.length); u16(tail, 10, entries.length);
  u32(tail, 12, directoryLength); u32(tail, 16, offset);
  const output = new Uint8Array(offset + directoryLength + end.length);
  let cursor = 0;
  for (const part of [...pieces, ...directory, end]) { output.set(part, cursor); cursor += part.length; }
  return output;
}

export function creativeTreatmentDocxBytes(title: string, treatment: string): Uint8Array {
  const paragraphs = [title, ...treatment.replace(/\r\n?/g, '\n').split('\n')].map((line, index) => {
    const heading = index === 0 || /^\s*(?:الهوك|المعالجة|النص \/|السيناريو|المشهد\s+\d+|الصورة\s+\d+|مطلوبات التصوير|معايير الجودة)/.test(line);
    const size = index === 0 ? '34' : heading ? '27' : '24';
    const headingProps = heading ? '<w:b/><w:bCs/><w:color w:val="4A211C"/>' : '';
    return `<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="${heading ? '190' : '105'}"/>${heading ? '<w:keepNext/>' : ''}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Tajawal" w:hAnsi="Tajawal" w:cs="Tajawal"/><w:rtl/><w:lang w:bidi="ar-SA"/>${headingProps}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlText(line || ' ')}</w:t></w:r></w:p>`;
  }).join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return packageZip([['[Content_Types].xml', contentTypes], ['_rels/.rels', rels], ['word/document.xml', document]]);
}

export function downloadCreativeTreatmentDocx(title: string, treatment: string) {
  const bytes = creativeTreatmentDocxBytes(title, treatment);
  // The bytes are generated locally. A copied Uint8Array also avoids TS BlobPart
  // complaints on runtimes whose ArrayBuffer generic includes SharedArrayBuffer.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = `المعالجة الإبداعية - ${title.replace(/[\\/:*?"<>|]/g, '').slice(0, 90)}.docx`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
