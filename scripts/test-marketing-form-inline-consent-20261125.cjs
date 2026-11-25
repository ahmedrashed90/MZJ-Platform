/** Public form consent UX + CRM JSON contract regression. Runs with TypeScript only;
 * the DB contract check uses a strict JSON-only mock, not a live postgres client. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const jsx=(type,props)=>({type,props});
const jsxRuntime={jsx,jsxs:jsx,Fragment:'fragment'};
function load(file,imports={},context={}){
  const r=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}});
  assert.equal(r.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  const exports={};
  vm.runInNewContext(r.outputText,{exports,require:id=>imports[id]||{},URL,URLSearchParams,console,Date,structuredClone,crypto:require('node:crypto').webcrypto,...context},{filename:file});
  return exports;
}
function hooks(){
  let cursor=0;const states=[],effects=[],pending=[];
  return {
    reset(){cursor=0;},flush(){for(const fn of pending.splice(0))fn();},
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},
    useRef(initial){const i=cursor++;if(!(i in states))states[i]={current:initial};return states[i];},
    useMemo(fn,deps){const i=cursor++;const old=states[i];if(!old||!deps||deps.some((v,k)=>!Object.is(v,old.deps[k])))states[i]={deps,value:fn()};return states[i].value;},
    useEffect(fn,deps){const i=cursor++;const old=effects[i];if(!old||!deps||deps.some((v,k)=>!Object.is(v,old.deps[k]))){effects[i]={deps};pending.push(()=>{old?.cleanup?.();effects[i].cleanup=fn();});}},
  };
}
function find(node,test){
  if(Array.isArray(node)){for(const child of node){const match=find(child,test);if(match)return match;}return;}
  if(!node||typeof node!=='object'||!node.props)return;
  return test(node)?node:find(node.props.children,test);
}
const design=load('shared/lead-form-design.ts');
const forms=load('shared/lead-forms.ts',{'./lead-form-design.js':design});
const rules=load('shared/lead-form-rules.ts');
const pixelSettings=load('shared/lead-form-pixels.ts');
const config=JSON.parse(JSON.stringify(forms.DEFAULT_FORM_CONFIG));
config.fields=[{id:'vehicle',label:'Vehicle',type:'text',required:true,options:[]}];
config.design=design.createTemplateDesign('steps',config.fields);
const form={title:'Finance request',description:'',template:'steps',config};
const settings={...pixelSettings.DEFAULT_LEAD_FORM_PIXELS,google:{...pixelSettings.DEFAULT_LEAD_FORM_PIXELS.google,enabled:true}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function harness({saved=null,source='google',enabled=true,failSubmit=false}={}){
  let choice=saved,reloads=0;const scripts=[],submissions=[];
  const query=source==='google'?'?utm_source=google&utm_medium=cpc':'';
  const window={location:{pathname:'/forms/test',search:query,reload(){reloads++;}},localStorage:{getItem:()=>choice,setItem:(_k,v)=>{choice=v;}}};
  const document={referrer:'',head:{appendChild:tag=>scripts.push(tag)},createElement:()=>({})};
  const fetch=async(_url,options)=>{
    if(!options?.body)return {ok:true,json:async()=>({ok:true,form,pixels:{...settings,google:{...settings.google,enabled}}})};
    const body=JSON.parse(options.body);
    if(body.action==='submit'){submissions.push(body);return {ok:!failSubmit,json:async()=>failSubmit?{ok:false,error:'test failure'}:{ok:true,id:'test-lead',created:true,crmStatus:'linked'}};}
    return {ok:true,json:async()=>({ok:true})};
  };
  const context={window,document,fetch,sessionStorage:{getItem:()=>null,setItem(){}}};
  const pageHooks=hooks(),rendererHooks=hooks();
  const pixels=load('src/marketing/lead-forms/pixel-tracking.ts',{},context);
  const renderer=load('src/marketing/lead-forms/LeadFormRenderer.tsx',{
    'react':rendererHooks,'react/jsx-runtime':jsxRuntime,'@phosphor-icons/react':new Proxy({},{get:(_,k)=>String(k)}),
    '../../../shared/lead-forms':forms,'../../../shared/lead-form-design':design,'../../../shared/lead-form-rules':rules,'./pixel-tracking':pixels,
  },context).LeadFormRenderer;
  const page=load('src/marketing/lead-forms/PublicLeadFormPage.tsx',{
    'react':pageHooks,'react/jsx-runtime':jsxRuntime,'react-router-dom':{useParams:()=>({slug:'test'}),useLocation:()=>({search:query})},
    './LeadFormRenderer':{LeadFormRenderer:'renderer'},'./pixel-tracking':pixels,
  },context).PublicLeadFormPage;
  function render(){pageHooks.reset();const tree=page();pageHooks.flush();if(tree.type!=='renderer')return tree;rendererHooks.reset();const ui=renderer(tree.props);rendererHooks.flush();return ui;}
  const findUi=test=>{const node=find(render(),test);assert.ok(node,'Expected UI control');return node;};
  const checkbox=()=>findUi(n=>n.type==='input'&&n.props.type==='checkbox');
  async function contact(){render();await settle();const first=render();assert.equal(find(first,n=>n.type==='input'&&n.props.type==='checkbox'),undefined,'No consent checkbox on initial question');assert.equal(find(first,n=>n.type==='aside'),undefined,'No automatic prompt');findUi(n=>n.type==='input'&&n.props.placeholder).props.onChange({target:{value:'Camry'}});findUi(n=>n.type==='button'&&n.props.className==='mlf-public-button').props.onClick();findUi(n=>n.props.autoComplete==='name').props.onChange({target:{value:'Test customer'}});findUi(n=>n.props.autoComplete==='tel').props.onChange({target:{value:'0501234567'}});return render();}
  const events=name=>(window.dataLayer||[]).filter(args=>args[0]==='event'&&args[1]===name);
  async function submit(){findUi(n=>n.type==='button'&&n.props.className==='mlf-public-button').props.onClick();await settle();return render();}
  return {render,contact,submit,checkbox,findUi,scripts,submissions,events,choice:()=>choice,reloads:()=>reloads};
}
function checkJsonContract(){
  // Compile the actual bridge, with only its external DB / workflow dependencies
  // replaced by typed interfaces. Keep the real mapping module and route logic.
  const bridge=path.join(root,'server/marketing/lead-forms-crm.ts');
  const stubs={
    'server/_db.ts':`type JSONValue = string | number | boolean | null | readonly JSONValue[] | { [key:string]: JSONValue }; interface Sql { <T=unknown[]>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>; json(value:JSONValue):unknown; } export declare function getSql():Sql; export declare function withDatabaseAdvisoryLock<T>(key:string,work:()=>Promise<T>):Promise<T>;`,
    'server/_crm-schema.ts':'export declare function ensureCrmSchema():Promise<void>;',
    'server/_phone-utils.ts':'export declare function normalizePhone(value:unknown):string;',
    'server/_crm-lead-import.ts':'export declare function processLeadImportEvent(route:string,id:string,payload:unknown):Promise<{lead?:{id:string;assigned_to?:string;call_center_assigned_to?:string;branch_code?:string;department_code?:string};existedBefore:boolean;createLead:boolean}>;',
    'server/_crm-lifecycle.ts':'export declare function isRecoverableMarketingFormLead(...args:unknown[]):Promise<boolean>;',
    'server/_notifications.ts':'export declare function createNotification(payload:unknown):Promise<void>; export declare function notificationDedupe(...args:string[]):string;',
    'server/marketing/form-crm-profile.ts':'export declare function saveMarketingFormProfile(id:string,row:unknown,newlyCreated:boolean):Promise<void>;',
  };
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,skipLibCheck:true,types:[]};
  function diagnostics(old){
    const host=ts.createCompilerHost(options);const real=host.getSourceFile.bind(host);
    host.getSourceFile=(name,version,...args)=>{
      const rel=path.relative(root,name).replace(/\\/g,'/');
      if(Object.hasOwn(stubs,rel))return ts.createSourceFile(name,stubs[rel],version,true);
      if(old&&name===bridge)return ts.createSourceFile(name,read(rel).replace('answerCrmFields: sanitizeFormCrmFields(row.answer_crm_fields)','answerCrmFields: row.answer_crm_fields || {}'),version,true);
      return real(name,version,...args);
    };
    return ts.getPreEmitDiagnostics(ts.createProgram([bridge],options,host));
  }
  assert.ok(diagnostics(true).some(d=>d.code===2345&&ts.flattenDiagnosticMessageText(d.messageText,' ').includes('answerCrmFields')),'Old code must reproduce the incompatible JSON error');
  const fixed=diagnostics(false);assert.equal(fixed.length,0,fixed.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
  const mapping=load('shared/lead-form-crm-fields.ts');
  const input=JSON.parse('{"salary":"salary","job":"notes","bad":{},"assigned":"assigned_to","null":null,"__proto__":"notes"}');
  assert.deepEqual(JSON.parse(JSON.stringify(mapping.sanitizeFormCrmFields(input))),JSON.parse('{"salary":"salary","job":"notes","__proto__":"notes"}'));
  assert.equal(JSON.stringify(mapping.sanitizeFormCrmFields(null)),'{}');
  assert.equal(JSON.stringify(mapping.sanitizeFormCrmFields(['salary'])),'{}');
  console.log('PASS: reproduced TS2345 against strict JSON contract; actual fixed bridge typechecks; invalid mapping values removed.');
}
(async()=>{
  checkJsonContract();
  let h=harness();await h.contact();assert.equal(h.checkbox().props.checked,false);assert.equal(h.checkbox().props.required,undefined);assert.equal(h.scripts.length,0);
  h.checkbox().props.onChange({currentTarget:{checked:true}});assert.equal(h.checkbox().props.checked,true);assert.equal(h.scripts.length,0);
  h.checkbox().props.onChange({currentTarget:{checked:false}});assert.equal(h.reloads(),0);
  let ui=await h.submit();assert.ok(find(ui,n=>n.props.role==='status'));assert.equal(h.submissions.length,1);assert.equal(h.submissions[0].consent,false);assert.equal(h.events('conversion').length,0);assert.equal(h.scripts.length,0);assert.equal(h.choice(),'deny');
  h=harness();await h.contact();h.checkbox().props.onChange({currentTarget:{checked:true}});ui=await h.submit();assert.ok(find(ui,n=>n.props.role==='status'));assert.equal(h.choice(),'allow');assert.equal(h.scripts.length,1);assert.equal(h.events('page_view').length,1);assert.equal(h.events('conversion').length,1);h.render();assert.equal(h.events('conversion').length,1);
  h=harness({failSubmit:true});await h.contact();h.checkbox().props.onChange({currentTarget:{checked:true}});ui=await h.submit();assert.ok(find(ui,n=>n.props.role==='alert'));assert.equal(h.scripts.length,0);assert.equal(h.choice(),null);
  h=harness({saved:'allow'});await h.contact();assert.equal(h.checkbox().props.checked,true);assert.equal(h.events('page_view').length,1);h.checkbox().props.onChange({currentTarget:{checked:false}});assert.equal(h.choice(),'deny');assert.equal(h.reloads(),1);
  h=harness({saved:'deny'});await h.contact();assert.equal(h.checkbox().props.checked,false);assert.equal(h.scripts.length,0);h.checkbox().props.onChange({currentTarget:{checked:true}});await h.submit();assert.equal(h.events('conversion').length,1);
  for(const args of [{source:'direct'},{enabled:false}]){h=harness(args);ui=await h.contact();assert.equal(find(ui,n=>n.type==='input'&&n.props.type==='checkbox'),undefined);await h.submit();assert.equal(h.scripts.length,0);}
  const css=read('src/marketing/lead-forms/lead-forms.css');assert.doesNotMatch(css,/\.mlf-pixel-(?:consent|privacy-control)/);
  console.log('PASS: no opening popup, optional unchecked consent, no pixels without opt-in, one conversion after success, failed submit, revocation, disabled and direct visits.');
})().catch(e=>{console.error(e);process.exitCode=1;});
