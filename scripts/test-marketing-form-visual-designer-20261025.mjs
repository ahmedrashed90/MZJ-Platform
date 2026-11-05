/** Dependency-free test of MZJ Form Design presets, server validation, and integration wiring. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const ts=require('typescript');
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
function moduleFrom(file, extra='', fakeRequire=()=>({})){
  const js=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js+'\n'+extra,{exports:module.exports,module,require:fakeRequire,Buffer,URL,process,console,Set,Math,Date}, {filename:file});
  return module.exports;
}
const design=moduleFrom('shared/lead-form-design.ts');
const fieldList=[{id:'vehicle'},{id:'purchase'},{id:'timeline'}];
const templates=['steps','visual','chat','quiz','minimal','classic'];
const signatures=[];
for(const name of templates){
  const d=design.createTemplateDesign(name,fieldList);
  assert.equal(d.version,1);
  assert.deepEqual(Object.keys(d.screens).sort().join(','),['vehicle','purchase','timeline','contact','success'].sort().join(','));
  assert.equal(d.screens.vehicle.filter(b=>b.kind==='question').length,1);
  assert.equal(d.screens.contact.filter(b=>b.kind==='contact').length,1);
  assert.equal(d.screens.success.filter(b=>b.kind==='success').length,1);
  signatures.push([d.choices,d.surface,d.animation,d.maxWidth,d.screens.vehicle.map(b=>b.kind).join(',')].join('|'));
}
assert.equal(new Set(signatures).size,6,'The initial six presets must be distinct');
const defaults=design.createTemplateDesign('visual',fieldList);
const saved={...defaults,screens:{...defaults.screens,vehicle:[{id:'title123',kind:'text',text:'MZJ'},{id:'q1',kind:'question'},{id:'go1',kind:'actions'}]}};
const resolved=design.resolveFormDesign(saved,'visual',fieldList);
assert.equal(resolved.screens.vehicle[0].text,'MZJ');
assert.equal(resolved.screens.contact.some(b=>b.kind==='contact'),true);
assert.equal(design.resolveFormDesign(undefined,'chat',fieldList).choices,'pills');
const shared=moduleFrom('shared/lead-forms.ts','',id=>id.includes('lead-form-design')?design:{});
const server=moduleFrom('server/marketing/lead-forms.ts','\nexports.__sanitizeConfig=sanitizeConfig;\n',id=>{
  if(id.includes('shared/lead-form-design'))return design;
  if(id.includes('shared/lead-forms'))return shared;
  if(id==='node:crypto')return require('node:crypto');
  return {};
});
const sanitize=server.__sanitizeConfig;
const config={fields:shared.DEFAULT_FORM_CONFIG.fields,style:shared.DEFAULT_FORM_CONFIG.style,design:saved};
const clean=sanitize(config);
assert.equal(clean.design.screens.vehicle[0].text,'MZJ');
assert.equal(clean.design.choices,'cards');
assert.equal(clean.fields.length,3);
const invalid={...config,design:{...saved,screens:{...saved.screens,vehicle:[{id:'q1',kind:'question'}, {id:'q2',kind:'question'},{id:'unsafe',kind:'script',text:'alert(1)'}]}}};
const protectedConfig=sanitize(invalid);
assert.equal(protectedConfig.design.screens.vehicle.filter(b=>b.kind==='question').length,1,'Duplicate mandatory input block must be deduplicated');
assert.equal(protectedConfig.design.screens.vehicle.some(b=>b.kind==='script'),false,'Unknown blocks rejected');
assert.equal(protectedConfig.design.screens.vehicle.some(b=>b.kind==='actions'),true,'Mandatory submit/navigation must survive');
const uploadedImage='data:image/webp;base64,'+'A'.repeat(256);
const media=sanitize({...config,style:{...config.style,coverUrl:uploadedImage},design:{...saved,screens:{...saved.screens,vehicle:[{id:'image_1',kind:'image',imageUrl:uploadedImage},{id:'q1',kind:'question'},{id:'go1',kind:'actions'}]}}});
assert.equal(media.style.coverUrl,uploadedImage);
assert.equal(media.design.screens.vehicle[0].imageUrl,uploadedImage);
const unsafe=sanitize({...config,style:{...config.style,coverUrl:'javascript:alert(1)'},design:{...saved,screens:{...saved.screens,vehicle:[{id:'image_1',kind:'image',imageUrl:'data:image/svg+xml;base64,'+'AAAA'},{id:'q1',kind:'question'},{id:'go1',kind:'actions'}]}}});
assert.equal(unsafe.style.coverUrl,'');
assert.equal(unsafe.design.screens.vehicle[0].imageUrl,'');
assert.ok(read('server/_marketing-lead-forms-schema.ts').includes('marketing.form_design_templates'));
assert.ok(read('database/migrations/20261025_marketing_lead_forms.sql').includes('marketing.form_design_templates'));
assert.ok(read('server/marketing/lead-forms.ts').includes('design_template_save'));
assert.ok(read('src/marketing/lead-forms/LeadFormsPage.tsx').includes('FormVisualDesigner'));
assert.ok(read('src/marketing/lead-forms/LeadFormsPage.tsx').includes('حفظ في مكتبة التصاميم'));
assert.ok(!read('src/marketing/lead-forms/LeadFormsPage.tsx').includes('6 تصاميم مختلفة تعتمد على محرك واحد'));
assert.ok(!read('src/marketing/lead-forms/LeadFormsPage.tsx').includes('مكتبة قوالب تفاعلية، إنشاء ونشر الفورمات'));
assert.ok(read('src/marketing/lead-forms/lead-forms.css').includes('.mlf-admin .mlf-tabs{justify-content:center'));
console.log('PASS 6 distinct layout engines; required fields; serialized layout; published flow; safe images; template library; centered tabs; removed notes.');
