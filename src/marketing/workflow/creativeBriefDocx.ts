import { getJSZip } from '../zip';

const xml=(value:string)=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const textParagraph=(line:string)=>{
 const m=line.match(/^([^:：]{2,55})[:：]\s*(.*)$/);
 const heading=Boolean(m)||/^(المشهد\s+\d+|الصورة\s+\d+|السيناريو التفصيلي|المعالجة الإبداعية)/.test(line);
 return `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/><w:spacing w:after="${heading?170:100}" w:line="340" w:lineRule="auto"/></w:pPr>
 <w:r><w:rPr><w:rtl/><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Tajawal"/>${heading?'<w:b/>':''}<w:sz w:val="${heading?25:22}"/><w:color w:val="${heading?'4A211C':'39271F'}"/></w:rPr><w:t xml:space="preserve">${xml(line||' ')}</w:t></w:r></w:p>`;
};
/** A real offline OOXML .docx, generated from the unchanged approved brief.
 * No shortened text, third-party document API, or interim draft. */
export async function downloadCreativeBriefDocx(title:string,brief:string){
 if(!brief.trim())throw Error('البريف الإبداعي الكامل غير متوفر');
 const Zip=await getJSZip(),zip=new Zip();
 const name=(title||'البريف الإبداعي').replace(/[\\/:*?"<>|\r\n]/g,' ').trim().slice(0,80);
 zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
 <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
 </Types>`);
 zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
 </Relationships>`);
 zip.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
 </Relationships>`);
 zip.file('word/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Tajawal"/><w:sz w:val="22"/><w:rtl/></w:rPr></w:rPrDefault></w:docDefaults>
 <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr></w:style>
 </w:styles>`);
 const paragraphs=[title,'محمد ذعار العجمي للسيارات — MZJ','',...brief.replace(/\r\n/g,'\n').split('\n')].map(textParagraph).join('');
 zip.file('word/document.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
 ${paragraphs}
 <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720"/></w:sectPr>
 </w:body></w:document>`);
 const blob=await zip.generateAsync({type:'blob'});
 const url=URL.createObjectURL(new Blob([blob],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
 try{const anchor=document.createElement('a');anchor.href=url;anchor.download=(name||'MZJ-Creative-Brief')+'.docx';
  document.body.appendChild(anchor);anchor.click();anchor.remove();}
 finally{window.setTimeout(()=>URL.revokeObjectURL(url),5000);}
}
