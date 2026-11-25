/** Typed form builder regression: use the actual components with an in-memory hook/JSX harness. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function compile(file,imports={},extra='') {
  const result=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  const exports={};
  vm.runInNewContext(result.outputText+'\n'+extra,{exports,require:id=>imports[id]||{},structuredClone,URL,URLSearchParams,console,process,crypto:require('node:crypto').webcrypto,window:{location:{search:''},alert(){},confirm(){return true;}},document:{referrer:''},sessionStorage:{getItem:()=>null,setItem(){}}},{filename:file});
  return exports;
}
const design=compile('shared/lead-form-design.ts');
const rules=compile('shared/lead-form-rules.ts');
const forms=compile('shared/lead-forms.ts',{'./lead-form-design.js':design});
const server=compile('server/marketing/lead-forms.ts',{'../../shared/lead-form-design.js':design,'../../shared/lead-form-rules.js':rules,'../../shared/lead-forms.js':forms,'node:crypto':require('node:crypto')},'exports.sanitize=sanitizeConfig;');
const jsx=(type,props)=>({type,props});
const jsxRuntime={jsx,jsxs:jsx,Fragment:'fragment'};
function hooks(){
  let slot=0;const states=[];
  return {reset(){slot=0;},useState(initial){const i=slot++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef(initial){const i=slot++;if(!(i in states))states[i]={current:initial};return states[i];},useMemo(fn){return fn();},useEffect(){}};
}
function find(tree,predicate){
  if(Array.isArray(tree)){for(const child of tree){const match=find(child,predicate);if(match)return match;}return;}
  if(!tree||typeof tree!=='object'||!tree.props)return;
  if(predicate(tree))return tree;
  return find(tree.props.children,predicate);
}
function click(tree,predicate){const node=find(tree,predicate);assert.ok(node,'Expected interactive control');node.props.onClick({stopPropagation(){}});}
const base=plain(forms.DEFAULT_FORM_CONFIG);
base.fields=[{id:'vehicle',label:'Vehicle',type:'choice',required:true,options:['A','B']}];
base.design=plain(design.createTemplateDesign('steps',base.fields));
const state=hooks();
const icons=new Proxy({}, {get:(_,key)=>String(key)});
const imports={'react':state,'react/jsx-runtime':jsxRuntime,'@phosphor-icons/react':icons,'../../../shared/lead-forms':forms,'../../../shared/lead-form-design':design,'../../../shared/lead-form-rules':rules,'./ConditionalChoicesEditor':{ConditionalChoicesEditor:'ConditionalChoicesEditor'}};
const editor=compile('src/marketing/lead-forms/FormVisualDesigner.tsx',imports).FormVisualDesigner;
let config=structuredClone(base);
const renderEditor=()=>{state.reset();return editor({config,template:'steps',onChange:next=>{config=next;}});};
const edit=(tree,predicate,value)=>{const el=find(tree,predicate);assert.ok(el,'Editable control expected');el.props.onChange({target:{value,checked:value}});};
const byLabel=(tree,label,type)=>find(tree,n=>n.type==='label'&&Array.isArray(n.props.children)&&n.props.children[0]===label&&find(n,c=>c.type===type));
const changeLabel=(tree,label,type,value)=>{const el=byLabel(tree,label,type);assert.ok(el,label);edit(el,n=>n.type===type,value);};
// Change the existing question in place. No duplicate step or change to the stable field ID.
changeLabel(renderEditor(),'نوع الإجابة','select','text');
changeLabel(renderEditor(),'نص السؤال','input','ما السيارة اللي ترغب فيها؟');
changeLabel(renderEditor(),'النص الإرشادي داخل الإجابة','input','اكتب السيارة والموديل');
assert.equal(config.fields[0].id,'vehicle');assert.equal(config.fields[0].type,'text');
assert.equal(config.design.screens.vehicle.find(b=>b.kind==='question').fieldId,'vehicle');
// Add the remaining field types using the actual palette click handlers.
const typeLabels=Object.fromEntries(forms.FORM_FIELD_TYPES.map(t=>[t.value,t.label]));
for(const type of ['choice','multi','dropdown','number','longtext','phone','email','date','consent']){
 const ui=renderEditor();const button=find(ui,n=>n.props.title===`إضافة ${typeLabels[type]}`&&n.props.className==='mlf-tool mlf-question-tool');
 assert.ok(button&&!button.props.disabled,type);button.props.onClick({detail:0});
 changeLabel(renderEditor(),'نص السؤال','input',type.toUpperCase());
 if(['choice','multi','dropdown'].includes(type)){
  edit(renderEditor(),n=>n.type==='input'&&n.props['aria-label']==='الاختيار 1','A');
  edit(renderEditor(),n=>n.type==='input'&&n.props['aria-label']==='الاختيار 2','B');
 }
}
assert.equal(config.fields.length,10);
assert.deepEqual(plain(design.formStepIds(config.fields)),['vehicle']);
assert.equal(config.design.screens.vehicle.filter(b=>b.kind==='question').length,10);
assert.equal(new Set(config.fields.map(f=>f.id)).size,10);
const saved=server.sanitize(plain(config));
assert.equal(saved.fields.length,10);
assert.equal(saved.design.screens.vehicle.filter(b=>b.kind==='question').length,10);
assert.deepEqual(plain(saved.fields.map(f=>f.type)),['text','choice','multi','dropdown','number','longtext','phone','email','date','consent']);
assert.equal(saved.fields[0].placeholder,'اكتب السيارة والموديل');
assert.equal(saved.fields[3].options[1],'B');
assert.equal(saved.fields[2].stepId,'vehicle');
// Independent question bindings, duplicate, and deletion persist.
const beforeDuplicate=structuredClone(config);
const duplicate=find(renderEditor(),n=>n.props.title==='نسخ العنصر');
assert.ok(duplicate);duplicate.props.onClick({stopPropagation(){}});
assert.equal(config.fields.length,11);
assert.equal(new Set(config.fields.map(f=>f.id)).size,11);
click(renderEditor(),n=>n.props.title==='تراجع');
assert.deepEqual(plain(config),plain(beforeDuplicate));
// Add a separate step. Old group remains unchanged.
click(renderEditor(),n=>n.type==='button'&&find(n,c=>c.type==='Plus')&&Array.isArray(n.props.children)&&n.props.children.includes(' إضافة خطوة'));
assert.equal(design.formStepIds(config.fields).length,2);
assert.equal(config.fields.length,11);
click(renderEditor(),n=>n.props.title==='حذف الخطوة');
assert.equal(design.formStepIds(config.fields).length,1);
// Validation contract used by the public renderer and server.
const byType=Object.fromEntries(saved.fields.map(f=>[f.type,f]));
const assertValid=(type,value)=>assert.equal(rules.validateFormAnswer(byType[type],value,{}),null,type);
const assertInvalid=(type,value)=>assert.ok(rules.validateFormAnswer(byType[type],value,{}),type);
for(const [type,value] of Object.entries({text:'Toyota Camry',choice:'A',multi:'["A","B"]',dropdown:'B',number:'5000.50',longtext:'Details',phone:'0501234567',email:'test@example.com',date:'2026-11-25',consent:'نعم'}))assertValid(type,value);
for(const [type,value] of Object.entries({text:' ',choice:'bad',multi:'["A","bad"]',dropdown:'bad',number:'-1',longtext:'x'.repeat(1001),phone:'123',email:'bad',date:'2026-02-30',consent:'لا'}))assertInvalid(type,value);
assertInvalid('multi','[]');assertInvalid('multi','A');
const conditional={...byType.multi,optionRules:[{conditions:[{fieldId:byType.choice.id,equals:'A'}],options:['B']}]};
const conditionalSaved=server.sanitize({...saved,fields:saved.fields.map(f=>f.id===conditional.id?conditional:f)});
const pruned=rules.validFormAnswers(conditionalSaved.fields,{[byType.choice.id]:'A',[byType.multi.id]:'["A","B"]'},conditionalSaved.design);
assert.equal(pruned[byType.multi.id],'["B"]');
// Duplicate/misbound blocks are ignored; unsafe video links do not persist.
const blocks=saved.design.screens.vehicle;
const unsafe=server.sanitize({...saved,design:{...saved.design,screens:{...saved.design.screens,vehicle:[...blocks,{id:'dupe',kind:'question',fieldId:byType.choice.id},{id:'wrong',kind:'question',fieldId:'invalid'},{id:'video1',kind:'video',videoUrl:'javascript:alert(1)'},{id:'video2',kind:'video',videoUrl:'https://example.com/video.mp4'}]}}});
assert.equal(unsafe.design.screens.vehicle.filter(b=>b.kind==='question').length,10);
assert.equal(unsafe.design.screens.vehicle.find(b=>b.id==='video1').videoUrl,'');
assert.equal(unsafe.design.screens.vehicle.find(b=>b.id==='video2').videoUrl,'https://example.com/video.mp4');
// Actual public renderer: all input types appear in one screen; required validation and navigation work.
const publicState=hooks();
const renderer=compile('src/marketing/lead-forms/LeadFormRenderer.tsx',{...imports,react:publicState,'./pixel-tracking':{formLeadAttribution:()=>({source:'direct',campaign:'',medium:'',adId:''})}}).LeadFormRenderer;
const render=()=>{publicState.reset();return renderer({form:{title:'Finance request',description:'',template:'steps',config:saved},preview:true});};
const clickNext=()=>click(render(),n=>n.type==='button'&&n.props.className==='mlf-public-button');
clickNext();assert.ok(find(render(),n=>n.props.role==='alert'),'Required question must block navigation');
edit(render(),n=>n.type==='input'&&n.props.placeholder==='اكتب السيارة والموديل','Toyota Camry');
const choiceGroup=(type)=>find(render(),n=>n.props.role==='group'&&n.props['aria-label']===type.toUpperCase());
click(choiceGroup('choice'),n=>n.type==='button'&&n.props['aria-pressed']===false);
assert.ok(choiceGroup('multi'),'New choice must not auto-advance a multi-question step');
click(choiceGroup('multi'),n=>n.type==='button'&&n.props['aria-pressed']===false);
click(choiceGroup('multi'),n=>n.type==='button'&&n.props['aria-pressed']===false);
assert.equal(find(choiceGroup('multi'),n=>n.type==='button'&&n.props['aria-pressed']===false),undefined);
edit(render(),n=>n.type==='select','B');
edit(render(),n=>n.type==='input'&&n.props.type==='number','5000');
edit(render(),n=>n.type==='textarea','Details');
edit(render(),n=>n.type==='input'&&n.props.type==='tel','0501234567');
edit(render(),n=>n.type==='input'&&n.props.type==='email','bad');
edit(render(),n=>n.type==='input'&&n.props.type==='date','2026-11-25');
edit(render(),n=>n.type==='input'&&n.props.type==='checkbox',true);
clickNext();assert.ok(find(render(),n=>n.props.role==='alert'),'Invalid email must block navigation');
edit(render(),n=>n.type==='input'&&n.props.type==='email','test@example.com');
clickNext();assert.ok(find(render(),n=>n.props.className==='mlf-contact'),'After validating all questions, proceed to normal CRM contact screen');
edit(render(),n=>n.type==='input'&&n.props.autoComplete==='name','Test Customer');
edit(render(),n=>n.type==='input'&&n.props.autoComplete==='tel','0501234567');
clickNext();assert.ok(find(render(),n=>n.props.role==='status'),'Preview completes without API calls');
console.log('PASS typed form builder: all 10 types, in-place conversion, grouped steps, duplication, undo, save/restore, independent IDs, conditional multi choices, safe media, actual public renderer, required and typed validation, unchanged contact flow.');
