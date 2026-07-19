function textFromBytes(bytes: Uint8Array) { return new TextDecoder("utf-8").decode(bytes); }
function columnIndex(reference: string) {
  const letters=(reference.match(/[A-Z]+/i)?.[0]||"").toUpperCase(); let value=0; for(const char of letters)value=value*26+(char.charCodeAt(0)-64); return Math.max(0,value-1);
}
async function inflateRaw(data: Uint8Array) {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipEntries(buffer: ArrayBuffer) {
  const view=new DataView(buffer); const bytes=new Uint8Array(buffer); let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error("ملف Excel غير صالح");
  const count=view.getUint16(eocd+10,true); const offset=view.getUint32(eocd+16,true); let cursor=offset; const entries=new Map<string,Uint8Array>();
  for(let i=0;i<count;i+=1){if(view.getUint32(cursor,true)!==0x02014b50)break;const method=view.getUint16(cursor+10,true);const compressedSize=view.getUint32(cursor+20,true);const nameLength=view.getUint16(cursor+28,true);const extraLength=view.getUint16(cursor+30,true);const commentLength=view.getUint16(cursor+32,true);const localOffset=view.getUint32(cursor+42,true);const name=textFromBytes(bytes.slice(cursor+46,cursor+46+nameLength));if(view.getUint32(localOffset,true)!==0x04034b50)throw new Error("بنية ملف Excel غير مدعومة");const localNameLength=view.getUint16(localOffset+26,true);const localExtraLength=view.getUint16(localOffset+28,true);const dataStart=localOffset+30+localNameLength+localExtraLength;const compressed=bytes.slice(dataStart,dataStart+compressedSize);let content:Uint8Array;if(method===0)content=compressed;else if(method===8)content=await inflateRaw(compressed);else throw new Error("نوع ضغط Excel غير مدعوم");entries.set(name,content);cursor+=46+nameLength+extraLength+commentLength;}
  return entries;
}
function xmlText(xml: string) { const doc=new DOMParser().parseFromString(xml,"application/xml"); if(doc.querySelector("parsererror"))throw new Error("تعذر قراءة ملف Excel"); return doc; }
async function parseXlsx(buffer:ArrayBuffer){
  const entries=await unzipEntries(buffer); const sharedEntry=entries.get("xl/sharedStrings.xml"); const shared:string[]=[];
  if(sharedEntry){const doc=xmlText(textFromBytes(sharedEntry));doc.querySelectorAll("si").forEach((node)=>shared.push(Array.from(node.querySelectorAll("t")).map((t)=>t.textContent||"").join("")));}
  const workbookEntry=entries.get("xl/workbook.xml"); let sheetPath="xl/worksheets/sheet1.xml";
  if(workbookEntry){const workbook=xmlText(textFromBytes(workbookEntry));const first=workbook.querySelector("sheet");const relationId=first?.getAttribute("r:id");const relEntry=entries.get("xl/_rels/workbook.xml.rels");if(relationId&&relEntry){const rel=xmlText(textFromBytes(relEntry)).querySelector(`Relationship[Id="${relationId}"]`);const target=rel?.getAttribute("Target");if(target)sheetPath=target.startsWith("/")?target.slice(1):`xl/${target.replace(/^\.\//,"")}`;}}
  const sheetEntry=entries.get(sheetPath)||entries.get("xl/worksheets/sheet1.xml"); if(!sheetEntry)throw new Error("لا يوجد Sheet قابل للقراءة");
  const sheet=xmlText(textFromBytes(sheetEntry));const matrix:string[][]=[];sheet.querySelectorAll("sheetData > row").forEach((rowNode)=>{const row:string[]=[];rowNode.querySelectorAll("c").forEach((cell)=>{const index=columnIndex(cell.getAttribute("r")||"");const type=cell.getAttribute("t");let value="";if(type==="inlineStr")value=Array.from(cell.querySelectorAll("is t")).map((t)=>t.textContent||"").join("");else{const raw=cell.querySelector("v")?.textContent||"";value=type==="s"?shared[Number(raw)]||"":raw;}row[index]=value;});matrix.push(row);});return matrix;
}
function parseDelimited(text:string){const delimiter=text.includes("\t")?"\t":",";const rows:string[][]=[];let row:string[]=[];let cell="";let quoted=false;for(let i=0;i<text.length;i+=1){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i+=1;}else quoted=!quoted;}else if(char===delimiter&&!quoted){row.push(cell);cell="";}else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i+=1;row.push(cell);if(row.some((v)=>v.trim()))rows.push(row);row=[];cell="";}else cell+=char;}row.push(cell);if(row.some((v)=>v.trim()))rows.push(row);return rows;}
function parseHtmlTable(text:string){const doc=new DOMParser().parseFromString(text,"text/html");return Array.from(doc.querySelectorAll("tr")).map((tr)=>Array.from(tr.querySelectorAll("th,td")).map((cell)=>cell.textContent?.trim()||""));}
export async function parseSpreadsheet(file:File){
  const name=file.name.toLowerCase();let matrix:string[][];
  if(name.endsWith(".xlsx"))matrix=await parseXlsx(await file.arrayBuffer());else{const text=await file.text();matrix=text.trim().startsWith("<")?parseHtmlTable(text):parseDelimited(text.replace(/^\ufeff/,""));}
  if(matrix.length<2)throw new Error("الملف لا يحتوي على بيانات");const headers=matrix[0].map((h)=>h.trim());return matrix.slice(1).filter((row)=>row.some((v)=>String(v||"").trim())).map((row)=>Object.fromEntries(headers.map((header,index)=>[header,String(row[index]??"").trim()])));
}
