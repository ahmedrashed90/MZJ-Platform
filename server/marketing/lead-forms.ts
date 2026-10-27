/** MZJ marketing lead forms: isolated admin/public endpoint. No CRM or ads API calls. */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createSign, randomUUID } from 'node:crypto';
import { getSql, withDatabaseAdvisoryLock } from '../_db.js';
import { requireUser, requestIp } from '../_auth.js';
import { requirePermissionForUser } from '../_access-control.js';
import { ensureMarketingLeadFormsSchema } from '../_marketing-lead-forms-schema.js';
import { DEFAULT_FORM_CONFIG, DEFAULT_SHEET_COLUMNS, FORM_TEMPLATES, AVAILABLE_SHEET_COLUMNS, type FormConfig, type FormField, type SheetColumnMapping } from '../../shared/lead-forms.js';
import { DESIGN_BLOCK_LABELS, REQUIRED_DESIGN_BLOCKS, SYSTEM_DESIGN_BLOCKS, createTemplateDesign, type FormDesign, type DesignBlock, type DesignBlockKind } from '../../shared/lead-form-design.js';

const clean = (v: unknown, max = 250) => String(v ?? '').trim().slice(0, max);
const sourceName = (v: unknown) => clean(v, 100).replace(/[\r\n\t]/g, ' ') || 'direct';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const bool = (v: unknown) => v === true;
class FormInputError extends Error {}
function body(req: VercelRequest): Record<string, any> {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  return {};
}
function fail(res: VercelResponse, status: number, error: string) { return res.status(status).json({ ok:false, error }); }
function validStyleColor(input: unknown, fallback: string) { const value = clean(input, 12); return /^#[a-f0-9]{6}$/i.test(value) ? value : fallback; }
function imageUrl(input: unknown) {
  const raw=String(input ?? '').trim();
  // Embedded images are produced by the in-browser editor after resize/compression.
  // Never allow SVG/data:text or arbitrary data URLs in public form content.
  if(raw.length<=250000 && /^data:image\/(?:webp|png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(raw))return raw;
  const url = clean(input, 1000);
  if (!url) return '';
  if (url === '/logo.png') return url;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? url : ''; } catch { return ''; }
}
/** Save only declarative, bounded layout data; no arbitrary HTML/CSS or executable content. */
function sanitizeDesign(input:unknown, fields:FormField[]):FormDesign|undefined {
  if(!input || typeof input!=='object' || Array.isArray(input))return undefined;
  const raw=input as Record<string,any>;
  const defaults=createTemplateDesign('steps',fields);
  const validScreens=new Set([...fields.map(f=>f.id),'contact','success']);
  const validKinds=new Set(Object.keys(DESIGN_BLOCK_LABELS));
  const animation=['slide','fade','zoom','none'].includes(raw.animation)?raw.animation:'slide';
  const choices=['list','cards','tiles','pills'].includes(raw.choices)?raw.choices:'list';
  const surface=['paper','soft','dark','borderless'].includes(raw.surface)?raw.surface:'paper';
  const buttonShape=['rounded','pill','square'].includes(raw.buttonShape)?raw.buttonShape:'rounded';
  const maxWidth=Math.max(360,Math.min(860,Math.round(Number(raw.maxWidth)||490)));
  const screens:FormDesign['screens']={};
  const source=raw.screens&&typeof raw.screens==='object'&&!Array.isArray(raw.screens)?raw.screens:{};
  for(const screen of validScreens){
    const rows=Array.isArray(source[screen])?source[screen].slice(0,30):defaults.screens[screen];
    const blocks:DesignBlock[]=[];const seen=new Set<string>();const systemKinds=new Set<string>();
    for(const [index,entry] of rows.entries()){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
      const kind=clean(entry.kind,24) as DesignBlockKind;
      if(!validKinds.has(kind))continue;
      if(kind==='question'&&['contact','success'].includes(screen))continue;
      if(kind==='contact'&&screen!=='contact')continue;
      if(kind==='success'&&screen!=='success')continue;
      if(kind==='actions'&&screen==='success')continue;
      if(SYSTEM_DESIGN_BLOCKS.includes(kind) && systemKinds.has(kind))continue;
      systemKinds.add(kind);
      const id=clean(entry.id,60) || `${screen}_${kind}_${index}`;
      if(!/^[a-zA-Z0-9_-]{1,60}$/.test(id)||seen.has(id))continue;
      seen.add(id);
      const align=['right','center','left'].includes(entry.align)?entry.align:'right';
      const width=['full','half'].includes(entry.width)?entry.width:'full';
      const size=['sm','md','lg'].includes(entry.size)?entry.size:'md';
      const height=Math.max(8,Math.min(280,Math.round(Number(entry.height)||24)));
      blocks.push({id,kind,text:clean(entry.text,550),imageUrl:imageUrl(entry.imageUrl),align,width,size,height});
    }
    const mandatory:DesignBlockKind[]=screen==='contact'?['contact','actions']:screen==='success'?['success']:['question','actions'];
    for(const kind of mandatory){if(!blocks.some(b=>b.kind===kind))blocks.push({id:`required_${screen}_${kind}`,kind,align:'right',width:'full',size:'md'});}
    screens[screen]=blocks;
  }
  return {version:1,screens,animation,choices,surface,buttonShape,maxWidth};
}
function sanitizeConfig(input: unknown): FormConfig {
  if(JSON.stringify(input ?? {}).length>3_000_000)throw new FormInputError('ملفات الصور أو إعدادات الفورم أكبر من الحجم المسموح');
  const obj = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string,any> : {};
  const rawFields: unknown[] = Array.isArray(obj.fields) ? obj.fields : DEFAULT_FORM_CONFIG.fields;
  if (rawFields.length > 14) throw new FormInputError('الحد الأقصى 14 سؤالًا لكل فورم');
  const fields: FormField[] = [];
  for (const [index, f] of rawFields.entries()) {
    if (!f || typeof f !== 'object') continue;
    const id = clean((f as any).id, 45) || `field_${index + 1}`;
    if (!/^[a-zA-Z0-9_-]{1,45}$/.test(id) || fields.some(x=>x.id===id) || ['name','phone'].includes(id)) continue;
    const type: FormField['type'] = ['choice','text','number'].includes((f as any).type) ? (f as any).type : 'choice';
    const options = Array.isArray((f as any).options) ? [...new Set((f as any).options.map((v:unknown)=>clean(v,80)).filter(Boolean))].slice(0,12) as string[] : [];
    if (type === 'choice' && options.length < 2) throw new FormInputError(`السؤال ${index+1}: أضف اختيارين على الأقل`);
    const showIfRaw = (f as any).showIf;
    const showIf = showIfRaw && typeof showIfRaw==='object' ? { fieldId: clean(showIfRaw.fieldId,45), equals: clean(showIfRaw.equals,80) } : null;
    const rawImages=(f as any).optionImages && typeof (f as any).optionImages==='object' ? (f as any).optionImages as Record<string,unknown> : {};
    const optionImages:Record<string,string>={};
    for(const option of options){const url=imageUrl(rawImages[option]);if(url)optionImages[option]=url;}
    fields.push({ id, label: clean((f as any).label, 120) || `السؤال ${index+1}`, type, options: type==='choice'?options:[], optionImages, description:clean((f as any).description,200), required: (f as any).required !== false, showIf });
  }
  if (!fields.length) throw new FormInputError('أضف سؤالًا واحدًا على الأقل');
  // Only allow conditions pointing to an earlier question and one of its options.
  fields.forEach((field,index)=>{
    const dep = fields.slice(0,index).find(item=>item.id===field.showIf?.fieldId);
    if (!dep || dep.type!=='choice' || !dep.options.includes(field.showIf?.equals || '')) field.showIf=null;
  });
  const rawStyle = obj.style && typeof obj.style === 'object' ? obj.style as Record<string,unknown> : {};
  const base = DEFAULT_FORM_CONFIG.style;
  return { fields, design:sanitizeDesign(obj.design,fields), style: {
    brown: validStyleColor(rawStyle.brown,base.brown), cream: validStyleColor(rawStyle.cream,base.cream),
    welcome: clean(rawStyle.welcome,140) || base.welcome,
    actionLabel: clean(rawStyle.actionLabel,60) || base.actionLabel,
    successTitle: clean(rawStyle.successTitle,140) || base.successTitle,
    successMessage: clean(rawStyle.successMessage,350) || base.successMessage,
    coverUrl: imageUrl(rawStyle.coverUrl), logoUrl: imageUrl(rawStyle.logoUrl) || '/logo.png',
  } };
}
function publicConfig(row: any) {
  const published = row.published_metadata || {};
  return { id:row.id, title:published.title || row.title, description:published.description ?? row.description, template:published.template || row.template,
    config:row.published_config || row.config };
}
function metadata(req: VercelRequest, data: Record<string,any>) {
  return {
    source: sourceName(data.source), campaign: clean(data.campaign,160),
    medium: clean(data.medium,120), adId: clean(data.adId,140),
  };
}
function ipHash(req: VercelRequest) {
  // Rotate periodically to avoid retaining raw IP addresses in lead records.
  const salt = process.env.LEAD_FORMS_IP_SALT || process.env.DATABASE_URL || 'mzj-forms';
  return createHash('sha256').update(salt + ':' + (requestIp(req) || 'unknown')).digest('hex');
}
function sheetServiceAccount() {
  const raw = String(process.env.MZJ_GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { client_email?: string; private_key?: string; token_uri?: string };
    return value.client_email && value.private_key ? value : null;
  } catch { return null; }
}
let tokenCache: { token: string; until: number } | null = null;
async function googleToken() {
  const account = sheetServiceAccount();
  if (!account) throw new Error('لم يتم إعداد حساب خدمة Google Sheets على السيرفر');
  if (tokenCache && tokenCache.until > Date.now()+60_000) return tokenCache.token;
  const now = Math.floor(Date.now()/1000);
  const encoded = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${encoded({ alg:'RS256',typ:'JWT' })}.${encoded({ iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600 })}`;
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key!).toString('base64url')}`;
  const reply = await fetch('https://oauth2.googleapis.com/token', { method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(9000) });
  if (!reply.ok) throw new Error(`تعذر تصريح Google Sheets (${reply.status})`);
  const json = await reply.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('تعذر استخراج توكن Google Sheets');
  tokenCache={token:json.access_token,until:Date.now()+(json.expires_in || 3600)*1000};
  return json.access_token;
}
/** The sheet's first row is authoritative; reading never changes any existing cells. */
function parseSheetId(input: unknown): string {
  let sheetId=clean(input,2100);
  if (sheetId.startsWith('https://')) {
    try {
      const url=new URL(sheetId);
      if (url.hostname!=='docs.google.com') throw new FormInputError('استخدم رابط Google Sheets الصحيح');
      const match=url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
      sheetId=match?.[1] || '';
    } catch { throw new FormInputError('رابط Google Sheets غير صحيح'); }
  }
  if (!/^[\w-]{15,180}$/.test(sheetId)) throw new FormInputError('معرف Google Sheets غير صالح');
  return sheetId;
}
function safeTab(input: unknown) {
  const title=clean(input,100);
  if (!title || /[\[\]*?:/\\]/.test(title)) throw new FormInputError('اسم ورقة العمل غير صالح');
  return title;
}
function tabRange(title: string, cells: string) { return `'${title.replace(/'/g,"''")}'!${cells}`; }
async function readSheets<T>(sheetId: string, path: string): Promise<T> {
  const token=await googleToken();
  const response=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}${path}`,{
    headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000),cache:'no-store',
  });
  if (!response.ok) {
    if (response.status===403) throw new FormInputError('حساب الخدمة لا يملك صلاحية الوصول للشيت. شارك الملف مع بريد حساب الخدمة بصلاحية محرر.');
    if (response.status===404) throw new FormInputError('تعذر العثور على الشيت أو ورقة العمل؛ تحقق من الرابط والاسم والصلاحيات.');
    if (response.status===400) throw new FormInputError('تعذر قراءة الورقة؛ تحقق من الاسم الصحيح الموجود أسفل الشيت.');
    throw new Error(`تعذر قراءة Google Sheets (${response.status})`);
  }
  return response.json() as Promise<T>;
}
async function listSheetTabs(sheetId: string) {
  const response=await readSheets<{sheets?: {properties?: {title?: string;hidden?: boolean}}[]}>(sheetId,'?fields=sheets(properties(title,hidden))');
  return (response.sheets||[]).map(s=>({title:s.properties?.title||'',hidden:!!s.properties?.hidden})).filter(x=>x.title);
}
async function readSheetHeaders(sheetId: string, tab: string): Promise<string[]> {
  const range=tabRange(safeTab(tab),'1:1');
  const response=await readSheets<{values?: unknown[][]}>(sheetId,`/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  const row=Array.isArray(response.values?.[0])?response.values![0]:[];
  if (!row.length || !row.some(v=>String(v??'').trim())) throw new FormInputError('الصف الأول في هذه الورقة فارغ. أضف عناوين الأعمدة أولًا.');
  if (row.length>120) throw new FormInputError('الورقة تحتوي على أكثر من 120 عمودًا؛ لا يمكن ربطها بهذا الفورم.');
  return row.map(v=>clean(v,200));
}
function riyadhSheetTimestamp(value: unknown) {
  const date=new Date(value as string);
  const parts=new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const part=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
function mappedLeadValue(key: string, lead: any, allowed: Set<string>, extra: Set<string>, matchLocalSheetFormat=false) {
  if ((!allowed.has(key) && !extra.has(key)) || !key) return '';
  if (key==='form') return String(lead.form_title || '');
  if (key==='lead_id') return String(lead.id || '');
  if (key==='submitted_at') return matchLocalSheetFormat?riyadhSheetTimestamp(lead.created_at):new Date(lead.created_at).toISOString();
  if (key.startsWith('answers.')) return String(lead.answers?.[key.slice(8)] || '');
  if (['vehicle','purchase','timeline'].includes(key)) return String(lead.answers?.[key] || '');
  return String(lead[key] || '');
}
async function syncLead(leadId: string) {
  const sql = getSql();
  const [row] = await sql<any[]>`
    select l.*,f.title form_title,f.sheet_id,f.sheet_tab,f.sheet_columns,f.config
    from marketing.form_leads l join marketing.lead_forms f on f.id=l.form_id
    where l.id=${leadId}::uuid`;
  if (!row || row.sheet_status==='sent') return;
  if (!row.sheet_id) { await sql`update marketing.form_leads set sheet_status='not_configured' where id=${leadId}::uuid`; return; }
  try {
    const token = await googleToken();
    const allowed = new Set(['name','phone','source','campaign','medium','ad_id','form','vehicle','purchase','timeline','submitted_at','lead_id']);
    const extra = new Set<string>((row.config?.fields || []).map((f:any)=>`answers.${f.id}`));
    const columns: unknown[] = Array.isArray(row.sheet_columns) ? row.sheet_columns : DEFAULT_SHEET_COLUMNS;
    const mapped=columns.length>0 && columns.every(v=>v && typeof v==='object' && !Array.isArray(v));
    let values: string[];
    if (mapped) {
      const mapping=columns as SheetColumnMapping[];
      // Do not append in the wrong positions if somebody edits/reorders the linked sheet later.
      const currentHeaders=await readSheetHeaders(row.sheet_id,String(row.sheet_tab||'Sheet1'));
      if (mapping.length!==currentHeaders.length || mapping.some((m,i)=>m.header!==currentHeaders[i]))
        throw new Error('عناوين الأعمدة تغيرت في Google Sheets؛ راجع الربط قبل إرسال الليد.');
      values=mapping.map(col=>col.source==='fixed' ? String(col.value||'') : mappedLeadValue(col.source,row,allowed,extra,true));
    } else {
      const legacy=columns.filter(v=>typeof v==='string' && (allowed.has(v)||extra.has(v))) as string[];
      values=(legacy.length?legacy:DEFAULT_SHEET_COLUMNS).map(key=>mappedLeadValue(key,row,allowed,extra));
    }
    const range=tabRange(String(row.sheet_tab || 'Sheet1'),'A:DP');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(row.sheet_id)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({values:[values]}),signal:AbortSignal.timeout(10000)});
    if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${clean(await res.text(),120)}`);
    await sql`update marketing.form_leads set sheet_status='sent',sheet_error=null,sheet_synced_at=now() where id=${leadId}::uuid`;
  } catch (error) {
    const msg = error instanceof Error ? clean(error.message,200) : 'خطأ غير معروف';
    await sql`update marketing.form_leads set sheet_status='failed',sheet_error=${msg} where id=${leadId}::uuid`;
  }
}
async function handlePublic(req: VercelRequest,res: VercelResponse,action: string,params: Record<string,any>) {
  res.setHeader('Cache-Control','no-store');
  if ((req.method !== 'GET' && req.method !== 'POST') || !slugPattern.test(clean(params.slug,110))) return fail(res,400,'رابط الفورم غير صالح');
  const sql = getSql();
  const [form] = await sql<any[]>`select * from marketing.lead_forms where slug=${clean(params.slug,110)} and status='published'`;
  if (!form) return fail(res,404,'الفورم غير متاح حاليًا');
  if (action==='public' && req.method==='GET') return res.json({ok:true,form:publicConfig(form)});
  if (req.method!=='POST') return fail(res,405,'الطريقة غير مدعومة');
  const visitor = clean(params.visitor,50);
  if (!uuidPattern.test(visitor)) return fail(res,400,'معرف الجلسة غير صالح');
  const visitorKey = createHash('sha256').update(`${form.id}:${visitor}`).digest('hex');
  const meta = metadata(req,params);
  if (action==='view') {
    await sql`insert into marketing.form_visits(form_id,visitor_key,source,campaign,medium,ad_id)
      values(${form.id}::uuid,${visitorKey},${meta.source},${meta.campaign},${meta.medium},${meta.adId}) on conflict do nothing`;
    return res.json({ok:true});
  }
  if (action==='step') {
    const stepId = clean(params.step,45);
    const fields = sanitizeConfig(form.published_config || form.config).fields;
    if (stepId && (fields.some(f=>f.id===stepId) || stepId==='contact')) {
      await sql`insert into marketing.form_step_events(form_id,visitor_key,step_id)
        values(${form.id}::uuid,${visitorKey},${stepId}) on conflict do nothing`;
    }
    return res.json({ok:true});
  }
  if (action!=='submit') return fail(res,404,'عملية غير معروفة');
  if (clean(params.website,200)) return res.json({ok:true}); // honeypot: do not store bot-generated leads
  if (!bool(params.consent)) return fail(res,400,'يلزم الموافقة على سياسة الخصوصية');
  const key=clean(params.submissionKey,50), name=clean(params.name,130), rawPhone=clean(params.phone,28).replace(/[\s()-]/g,'');
  if (!uuidPattern.test(key)) return fail(res,400,'معرف الطلب غير صالح');
  if (name.length<2) return fail(res,400,'يرجى كتابة الاسم');
  const localPhone=rawPhone.replace(/^(\+?966)/,'0');
  if (!/^05\d{8}$/.test(localPhone)) return fail(res,400,'رقم جوال سعودي غير صالح');
  const phone=`966${localPhone.slice(1)}`;
  const fields = sanitizeConfig(form.published_config || form.config).fields;
  const rawAnswers: Record<string,unknown> = params.answers && typeof params.answers==='object' && !Array.isArray(params.answers) ? params.answers : {};
  const answers: Record<string,string>={};
  for (const field of fields) {
    if (field.showIf && answers[field.showIf.fieldId] !== field.showIf.equals) continue;
    const value=clean(rawAnswers[field.id],180);
    if (field.required && !value) return fail(res,400,`يرجى الإجابة عن: ${field.label}`);
    if (field.type==='choice' && value && !field.options.includes(value)) return fail(res,400,'إجابة اختيار غير صالحة');
    if (field.type==='number' && value && !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return fail(res,400,'قيمة رقمية غير صالحة');
    if (value) answers[field.id]=value;
  }
  // Count submissions by IP to limit automated abuse without storing raw addresses.
  const hash=ipHash(req);
  const [recent] = await sql<{total:number}[]>`select count(*)::int total from marketing.form_leads where ip_hash=${hash} and created_at>now()-interval '10 minutes'`;
  if (Number(recent?.total||0)>=60) {
    const [prior]=await sql<{id:string}[]>`select id::text from marketing.form_leads where form_id=${form.id}::uuid and submission_key=${key}`;
    if(prior) return res.json({ok:true,id:prior.id});
    return fail(res,429,'طلبات كثيرة من نفس الاتصال. جرّب بعد قليل');
  }
  // The stored view/campaign is authoritative when present; avoid arbitrary changing of UTM on submission.
  const [visit] = await sql<any[]>`select source,campaign,medium,ad_id from marketing.form_visits where form_id=${form.id}::uuid and visitor_key=${visitorKey}`;
  const info = visit || { source:meta.source,campaign:meta.campaign,medium:meta.medium,ad_id:meta.adId };
  const [lead] = await sql<{id:string;sheet_status:string}[]>`
    insert into marketing.form_leads(form_id,submission_key,name,phone,answers,source,campaign,medium,ad_id,sheet_status,ip_hash)
    values(${form.id}::uuid,${key},${name},${phone},${sql.json(answers)},${info.source},${info.campaign},${info.medium},${info.ad_id},${form.sheet_id?'pending':'not_configured'},${hash})
    on conflict(form_id,submission_key) do update set submission_key=excluded.submission_key
    returning id::text,sheet_status`;
  if (lead?.sheet_status==='pending' && sheetServiceAccount()) await withDatabaseAdvisoryLock(`mzj:form-sheet:${lead.id}`,()=>syncLead(lead.id));
  return res.json({ok:true,id:lead.id, sheetEnabled:Boolean(form.sheet_id),sheetConfigured:Boolean(sheetServiceAccount())});
}
export default async function leadFormsHandler(req:VercelRequest,res:VercelResponse) {
  try {
    const action=clean(req.query.view || (req.method==='POST' ? body(req).action : 'list'),40);
    const params=req.method==='POST'?body(req):req.query;
    const publicActions=['public','view','step','submit'];
    if (publicActions.includes(action)) {
      await ensureMarketingLeadFormsSchema();
      return await handlePublic(req,res,action,params);
    }
    const user = await requireUser(req,res);
    if (!user) return;
    const permission = ({
      list:'marketing.lead_forms.view', get:'marketing.lead_forms.view', stats:'marketing.lead_forms.reports.view', leads:'marketing.lead_forms.leads.view',
      create:'marketing.lead_forms.create', save:'marketing.lead_forms.edit', duplicate:'marketing.lead_forms.create', publish:'marketing.lead_forms.publish', pause:'marketing.lead_forms.publish', archive:'marketing.lead_forms.publish',
      sheets:'marketing.lead_forms.sheets.manage', retry_sheet:'marketing.lead_forms.sheets.manage', sheet_status:'marketing.lead_forms.sheets.manage',
      sheet_tabs:'marketing.lead_forms.sheets.manage', sheet_headers:'marketing.lead_forms.sheets.manage',
      design_templates:'marketing.lead_forms.view', design_template_save:'marketing.lead_forms.create',
    } as Record<string,string>)[action];
    if (!permission) return fail(res,404,'عملية غير معروفة');
    if (!await requirePermissionForUser(req,res,user,permission,{systemCode:'marketing',pageCode:'lead_forms',action})) return;
    if (!user.systemAccess.marketing?.enabled) return fail(res,403,'ليس لديك صلاحية الوصول إلى التسويق');
    await ensureMarketingLeadFormsSchema();
    const sql=getSql();
    res.setHeader('Cache-Control','no-store');
    if (action==='design_templates' && req.method==='GET') {
      const rows=await sql<any[]>`select id::text,name,template,config,created_at,updated_at from marketing.form_design_templates order by updated_at desc limit 100`;
      return res.json({ok:true,templates:rows});
    }
    if (action==='design_template_save' && req.method==='POST') {
      const name=clean(params.name,100),template=clean(params.template,25);
      if(name.length<3 || !FORM_TEMPLATES.some(t=>t.id===template))return fail(res,400,'اكتب اسمًا صحيحًا للتصميم');
      const config=sanitizeConfig(params.config);
      if(!config.design) return fail(res,400,'احفظ إعدادات التصميم أولًا');
      const [saved]=await sql<any[]>`insert into marketing.form_design_templates(name,template,config,created_by)
        values(${name},${template},${sql.json(config)},${user.id}::uuid) returning id::text`;
      return res.json({ok:true,id:saved.id,message:'تم حفظ التصميم في مكتبة القوالب'});
    }
    if (action==='sheet_status' && req.method==='GET') {
      const account=sheetServiceAccount(); return res.json({ok:true,configured:!!account,serviceEmail:account?.client_email || ''});
    }
    if (action==='sheet_tabs' && req.method==='GET') {
      if (!sheetServiceAccount()) return fail(res,400,'خدمة Google Sheets غير مُهيأة على السيرفر');
      const sheetId=parseSheetId(params.sheetId);
      return res.json({ok:true,tabs:await listSheetTabs(sheetId)});
    }
    if (action==='sheet_headers' && req.method==='GET') {
      if (!sheetServiceAccount()) return fail(res,400,'خدمة Google Sheets غير مُهيأة على السيرفر');
      const sheetId=parseSheetId(params.sheetId),sheetTab=safeTab(params.sheetTab);
      return res.json({ok:true,headers:await readSheetHeaders(sheetId,sheetTab)});
    }
    if (action==='list' && req.method==='GET') {
      const rows=await sql<any[]>`
        select f.*,coalesce(v.total,0)::int visits,coalesce(l.total,0)::int submissions,coalesce(l.pending,0)::int sheet_pending
        from marketing.lead_forms f
        left join lateral(select count(*) total from marketing.form_visits v where v.form_id=f.id) v on true
        left join lateral(select count(*) total,count(*) filter(where sheet_status in ('failed','pending')) pending from marketing.form_leads l where l.form_id=f.id) l on true
        where f.status<>'archived' order by f.created_at desc`;
      return res.json({ok:true,forms:rows});
    }
    if (action==='get' && req.method==='GET') {
      if (!uuidPattern.test(clean(params.id,45))) return fail(res,400,'معرف الفورم غير صالح');
      const [row]=await sql<any[]>`select * from marketing.lead_forms where id=${clean(params.id)}::uuid and status<>'archived'`;
      return row?res.json({ok:true,form:row}):fail(res,404,'الفورم غير موجود');
    }
    if (action==='stats' && req.method==='GET') {
      const from=clean(params.from,10),to=clean(params.to,10),id=clean(params.id,45);
      const validDate=(s:string)=>!s || /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (!validDate(from)||!validDate(to)||(id&&!uuidPattern.test(id))) return fail(res,400,'فلتر التاريخ غير صحيح');
      const fromDate=from?`${from}T00:00:00Z`:'2000-01-01T00:00:00Z';
      const toDate=to?`${to}T23:59:59Z`:'2100-01-01T00:00:00Z';
      const [byForm,bySource,daily,byStep,byCampaign] = await Promise.all([
        sql<any[]>`select f.id::text,f.title,f.slug,f.status,
          (select count(*)::int from marketing.form_visits v where v.form_id=f.id and v.created_at between ${fromDate}::timestamptz and ${toDate}::timestamptz) visits,
          (select count(*)::int from marketing.form_leads l where l.form_id=f.id and l.created_at between ${fromDate}::timestamptz and ${toDate}::timestamptz) submissions
          from marketing.lead_forms f where f.status<>'archived' and (${id}='' or f.id::text=${id}) order by f.created_at desc`,
        sql<any[]>`select source,count(*)::int submissions from marketing.form_leads where created_at between ${fromDate}::timestamptz and ${toDate}::timestamptz and (${id}='' or form_id::text=${id}) group by source order by submissions desc`,
        sql<any[]>`select to_char(d.date,'YYYY-MM-DD') as date,coalesce(v.total,0)::int visits,coalesce(l.total,0)::int submissions from generate_series(greatest(${fromDate}::date,current_date-interval '90 days'),least(${toDate}::date,current_date),interval '1 day') d(date)
          left join lateral(select count(*) total from marketing.form_visits v where v.created_at::date=d.date::date and (${id}='' or v.form_id::text=${id})) v on true
          left join lateral(select count(*) total from marketing.form_leads l where l.created_at::date=d.date::date and (${id}='' or l.form_id::text=${id})) l on true order by d.date`,
        sql<any[]>`select f.id::text form_id,e.step_id,count(*)::int total from marketing.form_step_events e join marketing.lead_forms f on f.id=e.form_id where e.created_at between ${fromDate}::timestamptz and ${toDate}::timestamptz and (${id}='' or f.id::text=${id}) group by f.id,e.step_id order by f.id,e.step_id`,
        sql<any[]>`select campaign,source,count(*)::int submissions from marketing.form_leads
          where created_at between ${fromDate}::timestamptz and ${toDate}::timestamptz and (${id}='' or form_id::text=${id}) and campaign<>''
          group by campaign,source order by submissions desc limit 50`,
      ]);
      return res.json({ok:true,byForm,bySource,daily,byStep,byCampaign});
    }
    if (action==='leads' && req.method==='GET') {
      const id=clean(params.id,45),search=clean(params.search,90);
      if (id&&!uuidPattern.test(id)) return fail(res,400,'معرف فورم غير صالح');
      const rows=await sql<any[]>`select l.id::text,l.form_id::text,f.title form_title,l.name,l.phone,l.answers,l.source,l.campaign,l.medium,l.ad_id,l.sheet_status,l.sheet_error,l.created_at
        from marketing.form_leads l join marketing.lead_forms f on f.id=l.form_id
        where (${id}='' or l.form_id::text=${id}) and (${search}='' or l.name ilike ${'%'+search+'%'} or l.phone ilike ${'%'+search+'%'})
        order by l.created_at desc limit 2000`;
      return res.json({ok:true,leads:rows});
    }
    if (req.method!=='POST') return fail(res,405,'الطريقة غير مدعومة');
    if (action==='create' || action==='duplicate') {
      const source = action==='duplicate' && uuidPattern.test(clean(params.id,40))
        ? (await sql<any[]>`select * from marketing.lead_forms where id=${clean(params.id)}::uuid`)[0] : null;
      if (action==='duplicate' && !source) return fail(res,404,'الفورم غير موجود');
      const title=clean(params.title || (source ? `${source.title} - نسخة` : 'فورم جديد'),140);
      const slug=clean(params.slug,90).toLowerCase();
      if (title.length<3 || !slugPattern.test(slug)) return fail(res,400,'الاسم أو رمز الرابط غير صالح (حروف إنجليزية وأرقام وشرطة فقط)');
      const template=clean(params.template || source?.template || 'steps',25);
      if (!FORM_TEMPLATES.some(t=>t.id===template)) return fail(res,400,'التصميم غير صالح');
      const config=sanitizeConfig(source?.config || params.config || DEFAULT_FORM_CONFIG);
      const [row]=await sql<any[]>`insert into marketing.lead_forms(slug,title,description,template,config,created_by)
        values(${slug},${title},${clean(source?.description || params.description,600)},${template},${sql.json(config)},${user.id}::uuid) returning id::text`;
      return res.json({ok:true,id:row.id});
    }
    const id=clean(params.id,45);
    if (!uuidPattern.test(id)) return fail(res,400,'معرف الفورم غير صالح');
    const [existing]=await sql<any[]>`select * from marketing.lead_forms where id=${id}::uuid and status<>'archived'`;
    if (!existing) return fail(res,404,'الفورم غير موجود');
    if (action==='save') {
      const slug=clean(params.slug ?? existing.slug,90).toLowerCase();
      const title=clean(params.title ?? existing.title,140);
      const template=clean(params.template ?? existing.template,25);
      if (!slugPattern.test(slug) || title.length<3 || !FORM_TEMPLATES.some(t=>t.id===template)) return fail(res,400,'اسم أو تصميم أو رابط غير صحيح');
      if (existing.published_at && slug!==existing.slug) return fail(res,400,'لا يمكن تغيير رابط الفورم المنشور. انسخ الفورم لرابط جديد.');
      const config=sanitizeConfig(params.config ?? existing.config);
      await sql`update marketing.lead_forms set slug=${slug},title=${title},description=${clean(params.description ?? existing.description,600)},template=${template},config=${sql.json(config)},updated_at=now() where id=${id}::uuid`;
      return res.json({ok:true});
    }
    if (action==='publish') {
      await sql`update marketing.lead_forms set status='published',published_config=config,published_metadata=${sql.json({title:existing.title,description:existing.description,template:existing.template})},published_at=now(),updated_at=now() where id=${id}::uuid`;
      return res.json({ok:true});
    }
    if (action==='pause' || action==='archive') {
      await sql`update marketing.lead_forms set status=${action==='pause'?'paused':'archived'},updated_at=now() where id=${id}::uuid`;
      return res.json({ok:true});
    }
    if (action==='sheets') {
      // Setting an existing sheet never renames, moves or modifies old rows/headers.
      const sheetId=params.sheetId ? parseSheetId(params.sheetId) : '';
      const tab=safeTab(params.sheetTab || 'Sheet1');
      if (!sheetId) {
        await sql`update marketing.lead_forms set sheet_id='',sheet_tab=${tab},sheet_columns=${sql.json(DEFAULT_SHEET_COLUMNS)},updated_at=now() where id=${id}::uuid`;
        return res.json({ok:true});
      }
      if (!sheetServiceAccount()) return fail(res,400,'خدمة Google Sheets غير مُهيأة على السيرفر');
      const actualHeaders=await readSheetHeaders(sheetId,tab);
      const raw=Array.isArray(params.columns)?params.columns:[];
      if (raw.length!==actualHeaders.length) return fail(res,400,'أعد قراءة أعمدة الورقة قبل حفظ الربط');
      const validSources=new Set([...AVAILABLE_SHEET_COLUMNS.map(c=>c.code),...(existing.config?.fields||[]).map((f:any)=>`answers.${f.id}`),'','fixed']);
      const columns:SheetColumnMapping[]=[];
      for (const [i,entry] of raw.entries()) {
        if (!entry || typeof entry!=='object' || Array.isArray(entry)) return fail(res,400,'اربط الأعمدة حسب ترتيبها الفعلي');
        const header=clean(entry.header,200),source=clean(entry.source,75);
        if (header!==actualHeaders[i] || !validSources.has(source)) return fail(res,400,'عناوين الأعمدة تغيرت أو تحتوي على حقل غير صالح. أعد قراءة الورقة.');
        columns.push({header,source,...(source==='fixed'?{value:clean(entry.value,160)}:{})});
      }
      if (!columns.some(c=>c.source==='phone')) return fail(res,400,'اربط عمود رقم الجوال قبل الحفظ حتى تستقبل الليدات بشكل صحيح');
      await sql`update marketing.lead_forms set sheet_id=${sheetId},sheet_tab=${tab},sheet_columns=${sql.json(columns)},updated_at=now() where id=${id}::uuid`;
      return res.json({ok:true});
    }
    if (action==='retry_sheet') {
      if (!existing.sheet_id || !sheetServiceAccount()) return fail(res,400,'الربط بـGoogle Sheets غير مكتمل');
      const [l]=await sql<{id:string}[]>`select id::text from marketing.form_leads where form_id=${id}::uuid and sheet_status in('pending','failed') order by created_at limit 1`;
      if (!l) return res.json({ok:true,message:'لا توجد ليدات غير مرسلة'});
      await withDatabaseAdvisoryLock(`mzj:form-sheet:${l.id}`,()=>syncLead(l.id));
      const [check]=await sql<{sheet_status:string;sheet_error:string}[]>`select sheet_status,sheet_error from marketing.form_leads where id=${l.id}::uuid`;
      return res.json({ok:check.sheet_status==='sent',message:check.sheet_status==='sent'?'تم إرسال الليد إلى الشيت':check.sheet_error});
    }
    return fail(res,404,'عملية غير معروفة');
  } catch (error) {
    if (res.headersSent) return;
    const message=error instanceof Error ? error.message : 'خطأ غير معروف';
    if (error instanceof FormInputError) return fail(res,400,error.message);
    if (message.includes('unique') && message.includes('slug')) return fail(res,409,'رابط الفورم مستخدم بالفعل؛ اختر رابطًا مختلفًا');
    console.error('marketing lead forms',error);
    return fail(res,500,'تعذر إتمام الطلب. راجع إعدادات قاعدة البيانات أو جرّب مرة أخرى.');
  }
}
