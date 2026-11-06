/** Per-question form choice layouts, option logos, contact title and minimal privacy copy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = (file, stubs = {}, extra = '') => {
  const code = ts.transpileModule(read(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  });
  assert.deepEqual(code.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [], file + ' must transpile');
  const exports = {};
  vm.runInNewContext(code.outputText + '\n' + extra, {
    exports, require: id => stubs[id] || {}, URL, Math, Date, process, console, Set, JSON,
  });
  return exports;
};
const design = compile('shared/lead-form-design.ts');
const forms = compile('shared/lead-forms.ts', {'./lead-form-design.js': design});
const server = compile('server/marketing/lead-forms.ts', {
  '../../shared/lead-form-design.js': design,
  '../../shared/lead-forms.js': forms,
  'node:crypto': require('node:crypto'),
}, 'exports.testSanitize = sanitizeConfig;');
const fields = [
  {id:'vehicle',label:'الماركة',type:'choice',options:['هيونداي','تويوتا'],required:true},
  {id:'purchase',label:'طريقة الشراء',type:'choice',options:['كاش','تمويل','ما حددت الحين'],required:true,
    optionImages:{'كاش':'https://example.com/cash.png','تمويل':'https://example.com/finance.png','ما حددت الحين':'https://example.com/other.png'},
    optionImageModes:{'كاش':'logo','تمويل':'logo','ما حددت الحين':'logo'}},
];
const baseline = design.createTemplateDesign('visual',fields);
assert.equal(design.choiceLayoutFor(baseline,'vehicle'),'cards');
assert.equal(design.choiceLayoutFor(baseline,'purchase'),'cards');
const vehicleCards = {...baseline,choiceLayouts:{vehicle:'cards',purchase:'list'}};
assert.equal(design.choiceLayoutFor(vehicleCards,'vehicle'),'cards');
assert.equal(design.choiceLayoutFor(vehicleCards,'purchase'),'list');
const purchaseTiles = {...vehicleCards,choiceLayouts:{...vehicleCards.choiceLayouts,purchase:'tiles'}};
assert.equal(design.choiceLayoutFor(purchaseTiles,'vehicle'),'cards','Second question update must not alter first question');
assert.equal(design.choiceLayoutFor(purchaseTiles,'purchase'),'tiles');
assert.equal(design.choiceLayoutFor({...baseline,choiceLayouts:undefined},'purchase'),'cards','Old forms retain their global layout');
const config = server.testSanitize({
  fields,
  style:{...forms.DEFAULT_FORM_CONFIG.style,contactTitle:'اطلب عرض سعر الآن'},
  contact:{askName:false},
  design:{...vehicleCards,choiceLayouts:{vehicle:'cards',purchase:'list',orphan:'pills',__bad__:'invalid'}},
  privacy:{mode:'notice'},
});
assert.equal(config.design.choiceLayouts.vehicle,'cards');
assert.equal(config.design.choiceLayouts.purchase,'list');
assert.equal(config.design.choiceLayouts.orphan,undefined,'Deleted questions must not leave saved layouts');
assert.equal(config.style.contactTitle,'اطلب عرض سعر الآن');
assert.equal(config.contact.askName,false);
assert.deepEqual(JSON.parse(JSON.stringify(config.fields[1].optionImages)),fields[1].optionImages,'Payment icons must survive server sanitization');
assert.equal(config.fields[1].optionImageModes['ما حددت الحين'],'logo');
const screen = read('src/marketing/lead-forms/LeadFormRenderer.tsx');
assert.match(screen,/mlf-choice-mode-\$\{choiceLayoutFor\(design,current\.id\)\}/,'Public form must use question-specific choice layout');
assert.match(screen,/style\.contactTitle \|\| block\.text/,'Public contact screen uses editable title');
assert.match(screen,/noticeProvided:true/,'Policy notice is disclosed without opt-in');
assert.match(screen,/consent:false/,'Explicit consent must never be fabricated');
assert.doesNotMatch(screen,/أوافق على استخدام بياناتي للتواصل معي/);
assert.doesNotMatch(screen,/يتم استخدام بياناتك للرد على طلبك فقط/);
assert.match(screen,/<a href="\/privacy"/,'Privacy policy stays accessible through a short link');
const editor = read('src/marketing/lead-forms/FormVisualDesigner.tsx');
assert.match(editor,/choiceLayouts:\{\.\.\.design\.choiceLayouts,\[currentField\.id\]:/);
assert.match(editor,/mlf-dv-options-\$\{questionChoiceLayout\}/);
assert.match(editor,/صور وشعارات اختيارات هذا السؤال/);
assert.match(editor,/عنوان خطوة التواصل/);
const page = read('src/marketing/lead-forms/LeadFormsPage.tsx');
assert.match(page,/عنوان خطوة التواصل<input/);
assert.doesNotMatch(page,/<option value="checkbox">موافقة صريحة/);
assert.match(read('src/marketing/MarketingLayout.tsx'),/\/marketing\/packages[^\n]+marketing\.packages\.view/);
console.log('PASS: per-question layout isolation; legacy fallback; payment choice logos; editable contact heading; privacy copy removed without false consent; packages still available');
