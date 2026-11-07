/** Verifies all configurable MZJ lead-form options without production API calls. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
function moduleFrom(file,extra='',requireStub=()=>({})) {
  const compiled=ts.transpileModule(source(file),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file+' must parse');
  const exported={};
  vm.runInNewContext(compiled.outputText+'\n'+extra,{exports:exported,require:requireStub,URL,Math,Date,process,console,Set,JSON});
  return exported;
}
const design=moduleFrom('shared/lead-form-design.ts');
const base=moduleFrom('shared/lead-forms.ts','',id=>id.includes('lead-form-design')?design:{});
const rules=moduleFrom('shared/lead-form-rules.ts');
const server=moduleFrom('server/marketing/lead-forms.ts','\nexports.sanitizeConfigForTest=sanitizeConfig;',id=>{
  if(id.includes('shared/lead-form-design'))return design;
  if(id.includes('shared/lead-form-rules'))return rules;
  if(id.includes('shared/lead-forms'))return base;
  if(id==='node:crypto')return require('node:crypto');
  return {};
});
const conditions=[{fieldId:'vehicle',equals:'هيونداي'},{fieldId:'purchase',equals:'كاش'}];
const data={
  fields:[
    {id:'vehicle',type:'choice',label:'الماركة',required:true,options:['هيونداي','تويوتا']},
    {id:'purchase',type:'choice',label:'طريقة الدفع',required:true,options:['كاش','تمويل']},
    {id:'trim',type:'choice',label:'السيارة',required:true,options:['لسه ما حددت','أخرى'],
      optionRules:[
        {conditions,options:['أكسنت كاش','كونا كاش']},
        {conditions:[{fieldId:'vehicle',equals:'هيونداي'},{fieldId:'purchase',equals:'تمويل'}],options:['أكسنت تمويل','سوناتا تمويل']},
        {conditions:[{fieldId:'not-yet',equals:'invalid'}],options:['غير صالح','منتهي']},
      ],
      optionImages:{'أكسنت كاش':'https://example.com/hyundai-logo.png'},
      optionImageModes:{'أكسنت كاش':'logo'},
    },
  ],
  contact:{askName:false},privacy:{mode:'notice'},
  style:{...base.DEFAULT_FORM_CONFIG.style,subtitle:'احجز سيارتك من MZJ',coverHeight:120},
};
const sanitized=server.sanitizeConfigForTest(data);
assert.equal(sanitized.contact.askName,false);
assert.equal(sanitized.privacy.mode,'notice');
assert.equal(sanitized.style.subtitle,'احجز سيارتك من MZJ');
assert.equal(sanitized.style.coverHeight,120);
assert.equal(sanitized.fields[2].optionRules.length,2,'Invalid future conditions must be rejected');
assert.equal(sanitized.fields[2].optionImageModes['أكسنت كاش'],'logo');
assert.deepEqual(JSON.parse(JSON.stringify(rules.effectiveChoiceOptions(sanitized.fields[2],{vehicle:'هيونداي',purchase:'كاش'}))),['أكسنت كاش','كونا كاش']);
assert.deepEqual(JSON.parse(JSON.stringify(rules.effectiveChoiceOptions(sanitized.fields[2],{vehicle:'هيونداي',purchase:'تمويل'}))),['أكسنت تمويل','سوناتا تمويل']);
assert.deepEqual(JSON.parse(JSON.stringify(rules.effectiveChoiceOptions(sanitized.fields[2],{vehicle:'تويوتا',purchase:'كاش'}))),['لسه ما حددت','أخرى']);
const oldAnswers={vehicle:'هيونداي',purchase:'كاش',trim:'أكسنت كاش'};
const newAnswers=rules.validFormAnswers(sanitized.fields,{...oldAnswers,purchase:'تمويل'});
assert.ok(!newAnswers.trim,'Changing cash to finance must remove an incompatible previous choice');
const legacy=server.sanitizeConfigForTest(base.DEFAULT_FORM_CONFIG);
assert.equal(legacy.contact.askName,true,'Existing forms still request name by default');
assert.equal(legacy.privacy.mode,'notice','New forms use a standalone privacy-policy link without explicit consent');
assert.equal(server.sanitizeConfigForTest({...base.DEFAULT_FORM_CONFIG,privacy:{mode:'checkbox'}}).privacy.mode,'checkbox','Legacy checkbox submissions remain supported');
assert.equal(legacy.style.subtitle,'طلب سيارة إلكتروني');
assert.match(source('src/marketing/MarketingLayout.tsx'),/\/marketing\/packages[^\n]+marketing\.packages\.view/);
assert.match(source('src/marketing/lead-forms/LeadFormRenderer.tsx'),/effectiveChoiceOptions\(current,answers\)/);
assert.match(source('src/marketing/lead-forms/LeadFormRenderer.tsx'),/mlf-option-logo/);
assert.match(source('src/marketing/lead-forms/LeadFormRenderer.tsx'),/consent:false,noticeProvided:true/);
assert.match(source('src/marketing/lead-forms/lead-forms.css'),/object-fit:contain;object-position:center/);
assert.match(source('src/marketing/lead-forms/LeadFormsPage.tsx'),/ConditionalChoicesEditor/);
console.log('PASS: packages tab, cover containment, choice logos, configurable subtitle/contact, two-condition car choices, server sanitization, legacy compatibility, standalone privacy-policy link, stale-answer pruning');
