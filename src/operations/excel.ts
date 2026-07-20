function escapeHtml(value:unknown){return String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char));}
export function exportExcel(fileName:string,headers:string[],rows:unknown[][]){
  const html=`<!doctype html><html dir="rtl"><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headers.map((h)=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row)=>`<tr>${row.map((cell)=>`<td style="mso-number-format:'\\@'">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${fileName}.xls`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
export function exportCsvTemplate(fileName:string,headers:string[]){
  const csv=`\ufeff${headers.join(',')}\r\n`;const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${fileName}.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}
export async function parseDelimitedFile(file:File){
  const text=await file.text();const lines=text.replace(/^\ufeff/,'').split(/\r?\n/).filter((line)=>line.trim());if(!lines.length)return [];
  const delimiter=lines[0].includes('\t')?'\t':',';
  const parse=(line:string)=>{const cells:string[]=[];let current='';let quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){cells.push(current.trim());current='';}else current+=c;}cells.push(current.trim());return cells;};
  const headers=parse(lines[0]);return lines.slice(1).map((line)=>{const values=parse(line);return Object.fromEntries(headers.map((header,index)=>[header,values[index]??'']));});
}
