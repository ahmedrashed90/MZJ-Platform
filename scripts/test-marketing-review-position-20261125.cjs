'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports) {
  const code = ts.transpileModule(read(file), { fileName:file, reportDiagnostics:true, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX} });
  assert.equal(code.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  const module={exports:{}};
  new Function('require','module','exports',code.outputText)(name=>imports[name]||{},module,module.exports);
  return module.exports;
}
const {hasPreparationPostLink:linked,preparationLinesByMissingLink:sort,preparationReturnAnchor:anchor,preparationLinesByDate:dateSort} = load('src/marketing/workflow/campaignOverview.tsx',{});
const row=(id,day,other={})=>({id,scheduled_on:day,platform_name:'Google',post_type_name:'Video',...other});
const original=Object.freeze([
 row('done-early','2026-11-01',{effective_post_url:'https://example.com/1'}),
 row('edit','2026-11-25'),row('same-day','2026-11-25'),row('previous','2026-11-20'),
 row('done-late','2026-11-26',{manual_post_url:'https://example.com/2'}),
 row('later','2026-11-26',{manual_post_url:'  ',published_ready:true}),row('undated',''),
 row('paid','2026-11-24',{strategy_campaign_link:{campaignId:'1'}}),
]);
const ids=rows=>rows.map(r=>r.id);
assert.deepEqual(ids(sort(original)),['previous','paid','edit','same-day','later','undated','done-early','done-late']);
assert.equal(dateSort(original)[0].id,'done-early','Report/date-only order remains independent');
assert.equal(linked({effective_post_url:' ',manual_post_url:'https://example.com/'}),true);
assert.equal(linked({effective_post_url:' ',manual_post_url:' '}),false);
assert.equal(original[0].id,'done-early');
const pos={id:'edit',day:'2026-11-25',linked:false,nearbyIds:['same-day','later','undated','done-early','done-late','paid','previous']};
assert.equal(anchor(sort(original),pos),'edit');
const changed=sort(original.map(r=>r.id==='edit'?{...r,manual_post_url:'https://example.com/new'}:r));
assert.equal(anchor(changed,pos),'same-day');
assert.equal(anchor(changed.filter(r=>r.id!=='same-day'),pos),'later');
assert.equal(anchor(changed.filter(linked),pos),'edit');
assert.equal(anchor([],pos),'');
console.log('PASS: missing URLs first, date order per group, real manual/automatic URLs only; same-day return after saving');
// Exercise the actual Products tab's click/close behavior, with a controlled React state stub.
let selection=null;
const fixture={itemStatus:'approved',ratingPercentage:92.5,itemId:'requirement-1',taskId:'task-1',assignmentNo:'TSK-001-02',taskNo:'TSK-001',ideaName:'Example',mediaKind:'image',readiness:50,publishOn:'2026-11-25',category:'Example'};
const element=(type,props)=>({type,props:props||{}});
const detail=()=>null;
const status=()=>null;
const Star=()=>null;
const ratingDomain=load('shared/marketing-workflow.ts',{});
const {RatingStars}=load('src/marketing/workflow/TaskDetail.tsx',{
 'react/jsx-runtime':{jsx:element,jsxs:element},
 '@phosphor-icons/react':{Star},
 '../../../shared/marketing-workflow':ratingDomain,
});
let productRows=[fixture];
const productOrder=load('src/marketing/workflow/strategyProductOrder.ts',{});
const {StrategyProductsTab}=load('src/marketing/workflow/StrategyDrafts.tsx',{
 'react':{useState:()=>[selection,next=>{selection=next;}]},
 'react/jsx-runtime':{jsx:element,jsxs:element},
 './api':{useWorkQuery:()=>({data:{rows:productRows},reload:async()=>{}}),showDate:String},
 './components':{W:{noData:'empty'},WorkAlert:()=>null,Empty:()=>null,Status:status},
 './strategyProductOrder':productOrder,'./TaskDetail':{TaskDetail:detail,RatingStars},
});
function find(node, predicate) {
 if(Array.isArray(node))return node.flatMap(n=>find(n,predicate));
 if(!node||typeof node!=='object')return [];
 return [...(predicate(node)?[node]:[]),...find(node.props?.children,predicate)];
}
let view=StrategyProductsTab({search:''});
const nodeText=node=>Array.isArray(node)?node.map(nodeText).join(''):node==null||typeof node==='boolean'?'':typeof node==='object'?nodeText(node.props?.children):String(node);
const headers=find(view,n=>n.type==='th').map(nodeText);
assert.deepEqual(headers.slice(headers.indexOf('اسم الفكرة'),headers.indexOf('اسم الفكرة')+4),['اسم الفكرة','الحالة','الجاهزية','التقييم']);
assert.equal(find(view,n=>n.type===status)[0].props.value,'approved');
assert.ok(find(view,n=>n.type==='strong').some(n=>nodeText(n)==='92.5%'));
assert.equal(find(view,n=>n.type===RatingStars)[0].props.percentage,92.5);
// The Products tab must use the existing five-star scale, not a new calculation.
for(const [percentage,filled,css] of [[0,1,'unsuitable'],[49.99,1,'unsuitable'],[50,2,'weak'],[60,3,'acceptable'],[72.22,3,'acceptable'],[89.99,3,'acceptable'],[90,4,'good'],[99.99,4,'good'],[100,5,'excellent']]){
 productRows=[{...fixture,ratingPercentage:percentage}];
 const ratingCell=find(StrategyProductsTab({search:''}),n=>n.type==='td')[11];
 const [starsNode]=find(ratingCell,n=>n.type===RatingStars);
 assert.ok(starsNode);assert.equal(starsNode.props.percentage,percentage);
 const rendered=RatingStars(starsNode.props);
 assert.equal(rendered.props.className,`mkw-rating-stars is-${css}`);
 const stars=find(rendered,n=>n.type===Star);
 assert.equal(stars.length,5);assert.equal(stars.filter(n=>n.props.weight==='fill').length,filled);
 assert.equal(stars.filter(n=>n.props.weight==='regular').length,5-filled);
 assert.equal(nodeText(find(ratingCell,n=>n.type==='strong')[0]),`${percentage.toLocaleString('ar-SA-u-nu-latn',{maximumFractionDigits:2})}%`);
}
console.log('PASS: products rating reuses the existing five-star levels, preserves the percentage and handles all thresholds');
productRows=[{...fixture,ratingPercentage:0},{...fixture,itemId:'unrated',ratingPercentage:null,itemStatus:'submitted'}];
const mixed=StrategyProductsTab({search:''});
assert.ok(find(mixed,n=>n.type==='strong').some(n=>nodeText(n)==='0%'));
assert.equal(find(mixed,n=>n.type==='tr').length,4);
const bodyRows=find(mixed,n=>n.type==='tbody').flatMap(n=>find(n,n=>n.type==='tr'));
assert.equal(nodeText(find(bodyRows[1],n=>n.type==='td')[11]),'—');
assert.equal(find(find(bodyRows[1],n=>n.type==='td')[11],n=>n.type===RatingStars).length,0);
assert.equal(find(find(bodyRows[0],n=>n.type==='td')[11],n=>n.type===RatingStars)[0].props.percentage,0);
productRows=[fixture];
console.log('PASS: strategy products column order, real status, percentage rating, zero rating and unrated placeholder');
const [button]=find(view,n=>n.type==='button'&&n.props.className==='mkw-assignment-open');
assert.ok(button);button.props.onClick();
view=StrategyProductsTab({search:''});
const [popup]=find(view,n=>n.type===detail);
assert.ok(popup);assert.equal(popup.props.id,'task-1');assert.deepEqual(popup.props.onlyItems,['requirement-1']);assert.equal(popup.props.focusItemId,'requirement-1');assert.equal(popup.props.popup,true);
popup.props.onClose();assert.equal(find(StrategyProductsTab({search:''}),n=>n.type===detail).length,0);
console.log('PASS: assignment opens the exact requirement in a local popup and closes without routing');
const dashboard=read('src/marketing/pages/MarketingDashboardPage.tsx');
assert.match(dashboard,/onClick=\{event => openChooserLine\(line, event\)\}/);
assert.doesNotMatch(dashboard,/setSelectPlan\(''\);\s*(?:if \(line|setPrepareId\(line)/);
assert.match(dashboard,/level=\{selectPlan \? 1 : 0\}/);
assert.match(dashboard,/body\.scrollTop = row/);
assert.match(dashboard,/table\.scrollLeft = position\.left/);
assert.match(read('src/marketing/workflow/PublishPage.tsx'),/await query\.reload\(\); await onChanged\(\)/);
assert.match(read('src/marketing/workflow/TaskDetail.tsx'),/className=\{popup \? "mkw-modal" : "mkw-fullscreen"\}/);
assert.match(read('src/components/Modal.tsx'),/useEscapeToClose\(open, onClose\)/);
assert.match(read('src/components/useEscapeToClose.ts'),/openOverlayStack\.at\(-1\) !== id/);
console.log('PASS: chooser stays mounted, child is layered, restoration uses scroll offsets, existing Escape stack remains in use');

// Exercise the actual strategy-products API with controlled read-only rows.
(async()=>{
 const {createLoader,scriptedSql}=require('./marketing-workflow-test-support.cjs');
 const server=createLoader(process.cwd(),{'../_access-control.js':{},'../_marketing-workflow-schema.js':{marketingStrategyDraftsReady:async()=>false}});
 const {strategyProducts}=server('server/marketing/strategy-drafts.ts');
 const rows=[['item-a','approved'],['item-b','submitted'],['item-c','revision']].map(([item_id,item_status],i)=>({item_id,item_status,task_id:'task-a',idea_name:item_id,media_kind:'image',requirement_number:i+1,task_no:'TSK-001',task_created_at:'2026-11-25',marker:{},client_key:item_id}));
 const sql=scriptedSql([{match:'from marketing.work_items i join marketing.work_tasks',rows}]);
 const user={id:'admin',permissions:['platform.superadmin']};
 const items=rows.map((r,i)=>({id:r.item_id,status:r.item_status,formats:[],files:[],rating:i===0?{percentage:92.5}:i===1?{percentage:0}:null}));
 const result=await strategyProducts(sql,user,{productManager:true,manager:true,departments:[]},async(_,taskId)=>{assert.equal(taskId,'task-a');return items;});
 sql.assertDone();
 assert.deepEqual(result.rows.map(r=>r.itemStatus),['approved','submitted','revision']);
 assert.deepEqual(result.rows.map(r=>r.ratingPercentage),[92.5,0,null]);
 assert.deepEqual(result.rows.map(r=>r.readiness),[0,0,0]);
 console.log('PASS: strategy products API returns actual execution status and rating, preserving readiness and requirement identity');
})().catch(error=>{console.error(error);process.exitCode=1;});
