import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const p='server/crm/inbox.ts';
const js=ts.transpileModule(read(p),{fileName:p,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const id='11111111-1111-4111-8111-111111111111', lastMessage=new Date().toISOString();
const calls=[];
const sql=async(parts,...params)=>{
 const q=parts.join(' ? ').replace(/\s+/g,' ').trim();calls.push({q,params});
 if(q.startsWith('select c.id::text,c.last_customer_message_at'))return [{id,last_customer_message_at:lastMessage}];
 if(q.startsWith('update crm.conversations set'))return [{id}];
 if(q.includes('from crm.conversations c')&&q.includes('order by coalesce'))return [];
 if(q.includes('count(*)::int as total'))return [{total:0}];
 return [];
};
const aud=[];
const allowed={id:'22222222-2222-4222-8222-222222222222'};
let isManager=true;
const imports={
 '../_crm-utils.js':{audit:async(...x)=>{aud.push(x)},clean:x=>String(x??'').trim(),isCrmManager:()=>isManager,
  parseBody:r=>r.body||{},requireCrmUser:async()=>allowed,userScope:()=>({all:true,branchRestricted:false,branchCodes:[],includeAssigned:false}),crmLeadScopeSql:()=>'(true)'},
 '../_crm-lifecycle.js':{classifyConversationService:async()=>({})},
 '../_db.js':{getSql:()=>sql},'../_crm-window.js':{withMessagingWindow:x=>x},
};
const mod={exports:{}};
vm.runInNewContext(js,{module:mod,exports:mod.exports,require:k=>{assert.ok(k in imports,k);return imports[k]},console,String,Number,Boolean,Date,Array});
const handler=mod.exports.default;
async function send(method='DELETE',conversationId=id){const r={statusCode:200,payload:null,status(s){this.statusCode=s;return this},json(x){this.payload=x;return this}};await handler({method,query:{conversationId},headers:{}},r);return r;}
let result=await send();assert.equal(result.statusCode,200);assert.equal(result.payload.dismissed,true);assert.equal(aud.length,1);
const upd=calls.find(x=>x.q.startsWith('update crm.conversations set'));
assert.ok(upd.q.includes("'inboxDismissedAt'"));assert.ok(upd.q.includes('service_request_id is null'));
assert.ok(upd.q.includes('last_customer_message_at is not distinct from'));
assert.equal(calls.some(x=>/^delete\s+from\s+crm\./i.test(x.q)),false);
result=await send('DELETE','bad-id');assert.equal(result.statusCode,400);
isManager=false;result=await send();assert.equal(result.statusCode,403);isManager=true;
result=await send('GET');assert.equal(result.statusCode,200);assert.equal(result.payload.canClassify,true);
const getQueries=calls.filter(x=>x.q.includes('from crm.conversations c')&&x.q.includes('classification_state'));
assert.ok(getQueries.some(x=>x.q.includes("metadata->>'inboxDismissedAt'")));
console.log('PASS: scoped administrator-only dismiss, audit, preserve historical messages, reappear on new inbound, summary filters');
