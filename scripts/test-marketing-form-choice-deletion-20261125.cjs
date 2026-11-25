/** Form editor deletion regression: use the actual components with an in-memory hook/JSX harness. */
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
  vm.runInNewContext(result.outputText+'\n'+extra,{exports,require:id=>imports[id]||{},structuredClone,URL,URLSearchParams,console,process,crypto:require('node:crypto').webcrypto,window:{location:{search:''}},document:{referrer:''},sessionStorage:{getItem:()=>null,setItem(){}}},{filename:file});
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
base.fields=[{id:'vehicle',type:'choice',label:'Vehicle',required:true,options:['A','B'],optionImages:{A:'https://example.com/a.png',B:'https://example.com/b.png'},optionImageModes:{A:'logo',B:'photo'}},
  {id:'purchase',type:'choice',label:'Purchase',required:true,options:['Cash','Finance'],optionRules:[{conditions:[{fieldId:'vehicle',equals:'A'}],options:['Cash','Other']}]},
  {id:'detail',type:'text',label:'Dependent',required:true,options:[],showIf:{fieldId:'vehicle',equals:'A'}}];
base.design=plain(design.createTemplateDesign('steps',base.fields));
const state=hooks();
const icons=new Proxy({}, {get:(_,key)=>String(key)});
const imports={'react':state,'react/jsx-runtime':jsxRuntime,'@phosphor-icons/react':icons,'../../../shared/lead-forms':forms,'../../../shared/lead-form-design':design,'../../../shared/lead-form-rules':rules,'./ConditionalChoicesEditor':{ConditionalChoicesEditor:'ConditionalChoicesEditor'}};
const editor=compile('src/marketing/lead-forms/FormVisualDesigner.tsx',imports).FormVisualDesigner;
let config=structuredClone(base);
const renderEditor=()=>{state.reset();return editor({config,template:'steps',onChange:next=>{config=next;}});};
let tree=renderEditor();
click(tree,node=>node.props.title==='حذف الاختيار: A');
assert.deepEqual(plain(config.fields[0].options),['B']);
assert.equal(config.fields[0].optionImages.A,undefined);
assert.equal(config.fields[0].optionImageModes.A,undefined);
assert.deepEqual(plain(config.fields[1]),base.fields[1],'Other question untouched in editor');
let saved=server.sanitize(plain(config));
assert.deepEqual(plain(saved.fields[0].options),['B'],'A single remaining option survives save');
assert.equal(saved.fields[0].optionImages.B,'https://example.com/b.png');
assert.equal(rules.isVisibleField(saved.fields[2],{}),false,'Removing the parent choice does not reveal a dependent question');
click(renderEditor(),node=>node.props.title==='حذف الاختيار: B');
assert.deepEqual(plain(config.fields[0].options),[]);
saved=server.sanitize(plain(config));
assert.equal(rules.acceptsFieldAnswer(saved.fields[0],{},saved.design),false);
assert.equal(rules.acceptsFieldAnswer(saved.fields[1],{},saved.design),true);
// Undo the last option deletion, then undo the first deletion.
click(renderEditor(),node=>node.props.title==='تراجع');
assert.deepEqual(plain(config.fields[0].options),['B']);
click(renderEditor(),node=>node.props.title==='تراجع');
assert.deepEqual(plain(config.fields[0].options),['A','B']);
// Deleting the answer block preserves question metadata/options and all sibling screens.
click(renderEditor(),node=>node.props.title==='حذف بلوك الإجابات والاختيارات');
assert.deepEqual(plain(config.fields),base.fields);
assert.equal(config.design.screens.vehicle.some(b=>b.kind==='question'),false);
saved=server.sanitize(plain(config));
assert.equal(saved.design.screens.vehicle.some(b=>b.kind==='question'),false);
assert.equal(saved.design.screens.vehicle.some(b=>b.kind==='actions'),true);
assert.equal(design.resolveFormDesign(saved.design,'steps',saved.fields).screens.vehicle.some(b=>b.kind==='question'),false);
assert.equal(saved.design.screens.contact.some(b=>b.kind==='contact'),true);
assert.equal(saved.design.screens.success.some(b=>b.kind==='success'),true);
assert.deepEqual(plain(rules.validFormAnswers(saved.fields,{vehicle:'A',purchase:'Cash',detail:'old'},saved.design)),{purchase:'Cash'});
assert.equal(rules.acceptsFieldAnswer(base.fields[0],{},undefined),true,'Legacy form still requires answers');
// Re-add from the palette and keep original options.
const palette=find(renderEditor(),node=>node.props.className==='mlf-tool'&&find(node,n=>n.type==='span'&&n.props.children==='الإجابات والاختيارات'));
assert.ok(palette&&!palette.props.disabled);
const event={button:0,clientX:0,clientY:0,pointerId:1,currentTarget:{setPointerCapture(){}}};
palette.props.onPointerDown(event);palette.props.onPointerUp(event);
assert.equal(config.design.screens.vehicle.some(b=>b.kind==='question'),true);
assert.deepEqual(plain(config.fields[0].options),['A','B']);
// Empty conditional group is intentionally empty, not silently replaced by base choices.
const conditional=rules.removeChoiceOption({...base.fields[1],optionRules:[{conditions:[{fieldId:'vehicle',equals:'A'}],options:['Other']}]},'Other');
const conditionalConfig=server.sanitize({...base,fields:[base.fields[0],conditional]});
assert.equal(rules.acceptsFieldAnswer(conditionalConfig.fields[1],{vehicle:'A'},conditionalConfig.design),false);
assert.equal(rules.acceptsFieldAnswer(conditionalConfig.fields[1],{vehicle:'B'},conditionalConfig.design),true);
// Actual public renderer: informational step can proceed to a normal required choice.
function checkPublic(config){
  const state=hooks();
  const renderer=compile('src/marketing/lead-forms/LeadFormRenderer.tsx',{...imports,react:state,'./pixel-tracking':{formLeadAttribution:()=>({source:'direct',campaign:'',medium:'',adId:''})}}).LeadFormRenderer;
  const render=()=>{state.reset();return renderer({form:{title:'Test',description:'',template:'steps',config},preview:true});};
  let ui=render();
  assert.equal(find(ui,n=>n.props.className==='mlf-choice selected'),undefined);
  click(ui,n=>n.type==='button'&&n.props.className==='mlf-public-button');
  ui=render();
  const choice=find(ui,n=>n.type==='button'&&n.props.className==='mlf-choice ');
  assert.ok(choice,'Next required question retains its choices');
  choice.props.onClick();
  ui=render();
  assert.ok(find(ui,n=>n.props.className==='mlf-contact'),'Customer can reach contact step');
}
checkPublic(saved);
checkPublic(server.sanitize({...base,fields:[{...base.fields[0],options:[]},...base.fields.slice(1)]}));
// Transpile all changed TSX, including the settings editor.
compile('src/marketing/lead-forms/LeadFormsPage.tsx',{...imports,react:{...state,memo:fn=>fn}});
console.log('PASS choice deletion: real editor buttons, single/zero choices, undo, persistence, restore block, conditional steps, stale answers, required contact/navigation, public preview.');
