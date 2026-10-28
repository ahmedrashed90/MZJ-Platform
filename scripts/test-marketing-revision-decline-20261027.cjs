// Regression checks for the current immutable, three-revision marketing workflow.
// Replaces the superseded single "decline revision" contract used before Oct 28.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {createLoader}=require('./marketing-workflow-test-support.cjs');
const load=createLoader(root);
const {parseReviewNote}=load('shared/marketing-review-note-format.ts');
const {workReviewableFormats,workReadiness}=load('shared/marketing-workflow.ts');
const source=read('server/marketing/workflow.ts');
const ui=read('src/marketing/workflow/TaskDetail.tsx');
const css=read('src/marketing/workflow/workflow.css');
const evals=read('server/marketing/evaluations.ts');
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
test('Document notes preserve paragraphs, lists and headings',()=>{
 const rows=parseReviewNote('## الجودة\n1. وضوح الصورة\n• رقم الهاتف\n\nارجع إلى حاسبة التمويل');
 assert.deepEqual(rows.map(row=>row.kind),['heading','numbered','bullet','paragraph']);
 assert.equal(rows.at(-1).text,'ارجع إلى حاسبة التمويل');
});
test('Old plus-separated notes render as bullet points without editing stored content',()=>{
 assert.deepEqual(parseReviewNote('شاشة حقيقية + وضوح الهاتف + حاسبة التمويل').map(x=>x.text), ['شاشة حقيقية','وضوح الهاتف','حاسبة التمويل']);
});
test('Phone numbers and simple arithmetic are not split into notes',()=>{
 assert.deepEqual(parseReviewNote('اتصل +966550000000 للمتابعة 2+3').map(x=>x.kind),['paragraph']);
});
test('Previously approved formats remain outside a new revision',()=>{
 const fmt={id:'a',platform_id:'p',platform_name:'Meta',name:'صورة'};
 const second={...fmt,id:'b'};
 const itm={formats:[fmt,second],files:[{id:'f',format_id:'a',category:'final',status:'ready',name:'design.png'}],media_kind:'image',format_reviews:[{format_id:'a',status:'submitted'},{format_id:'b',status:'approved'}]};
 assert.deepEqual(workReviewableFormats(itm,'revise').map(x=>x.id),['a']);
});
test('Reject remains in task and counts as terminal 100% readiness',()=>{
 const approved={status:'approved',formats:[{id:'f1'}],files:[{id:'u1',format_id:'f1',category:'final',status:'ready'}]};
 const rejected={status:'rejected',formats:[],files:[]};
 assert.deepEqual(workReadiness([rejected,rejected]),{total:2,approved:0,percent:100,complete:true});
 assert.deepEqual(workReadiness([approved,rejected]),{total:2,approved:1,percent:100,complete:true});
});
test('Server retains the rejected item and its files instead of deleting it',()=>{
 const section=source.slice(source.indexOf("if (decision === 'reject')"),source.indexOf('} else {',source.indexOf("if (decision === 'reject')")));
 assert(section.includes("status='rejected'"));
 assert(!section.includes('delete from marketing.work_items'));
 assert(!section.includes('delete from marketing.work_item_files'));
});
test('Executor accept and decline share one authoritative response handler',()=>{
 assert(source.includes('async function respondToItemRevision('));
 assert(source.includes("accept ? 'editing' : 'submitted'"));
 assert(source.includes("action === 'work_accept_revision'"));
 assert(source.includes("action === 'work_decline_revision'"));
});
test('Executor response validates owner, permission, pending revision and version',()=>{
 const section=source.slice(source.indexOf('async function respondToItemRevision('),source.indexOf('async function reviewItem('));
 for(const term of ["requirePermission(user, 'marketing.task.final_file.upload')","current.assigned_to !== user.id","locked.version !== Number(body.version)","locked.status !== 'revision'",'for update']) assert(section.includes(term));
});
test('Revision limit is enforced under SQL row lock, not just UI',()=>{
 const section=source.slice(source.indexOf('async function reviewItem('),source.indexOf('async function unapproveItem('));
 assert(section.includes('for update'));
 assert(section.includes('max(revision_number)'));
 assert(section.includes('nextRevisionNumber > 3'));
});
test('Saved revision notes cannot be edited or removed from API',()=>{
 assert(evals.includes('export async function manageItemReviewNote'));
 assert(evals.includes('ملاحظات التعديل المحفوظة نهائية'));
 assert(!ui.includes('manageNote('));
 assert(!ui.includes('editNote('));
});
test('UI offers explicit accept/decline and three permanent named notes',()=>{
 for(const term of ['+ إضافة تعديل','قبول التعديل','رفض التعديل','قيد التعديل','قيد المراجعة','التعديل {entry.revision_number','revisionNotes.length','revisionsLeft'])assert(ui.includes(term));
});
test('Reviewer and executor actions have distinct permissions',()=>{
 assert(source.includes("requirePermission(user, 'marketing.task.review')"));
 assert(source.includes("requirePermission(user, 'marketing.task.final_file.upload')"));
});
test('Safe formatted notes, reviewer controls and rejected item visual remain',()=>{
 assert(ui.includes('ReviewNoteDocument text={entry.note}'));
 assert(ui.includes('<textarea ref={noteEditorRef}'));
 assert(css.includes('.mkw-review-document'));
 assert(ui.includes('مرفوض — تم حسم المطلوب'));
 assert(!ui.includes('dangerouslySetInnerHTML'));
});
(async()=>{let passed=0;for(const [name,fn] of tests){try{await fn();console.log('PASS',name);passed++;}catch(e){console.error('FAIL',name,e.stack||e);process.exitCode=1;}}console.log(`${passed}/${tests.length} immutable-revision regression checks passed`);})().catch(e=>{console.error(e);process.exitCode=1});
