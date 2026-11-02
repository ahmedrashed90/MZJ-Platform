'use strict';
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const {createLoader} = require('./marketing-workflow-test-support.cjs');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('PASS:', label); }
const {ratingDatesForSelection, selectionForRatingDates, isValidRatingPeriod} = createLoader(process.cwd())('src/marketing/pages/ratingsDateFilters.ts');
check('Selecting October 2026 defines exactly its dates', () => {
  assert.deepEqual(ratingDatesForSelection('10', '2026', '2026-11-03'), {month:'10',year:'2026',from:'2026-10-01',to:'2026-10-31'});
});
check('Selecting November 2026 includes the last day, not just today', () => {
  assert.deepEqual(ratingDatesForSelection('11', '2026', '2026-11-03'), {month:'11',year:'2026',from:'2026-11-01',to:'2026-11-30'});
});
check('Leap February gets its real last day', () => {
  assert.equal(ratingDatesForSelection('02', '2024', '2026-11-03').to, '2024-02-29');
  assert.equal(ratingDatesForSelection('02', '2025', '2026-11-03').to, '2025-02-28');
});
check('Year-only selection covers its whole year', () => {
  assert.deepEqual(ratingDatesForSelection('all', '2025', '2026-11-03'), {month:'all',year:'2025',from:'2025-01-01',to:'2025-12-31'});
});
check('All years stays under the server five-year bound and resets month', () => {
  const selection=ratingDatesForSelection('all', 'all', '2026-11-03');
  assert.deepEqual(selection,{month:'all',year:'all',from:'2022-01-01',to:'2026-12-31'});
  assert(isValidRatingPeriod(selection.from,selection.to));
});
check('Month-only selection while year is all becomes current-year month', () => {
  assert.deepEqual(ratingDatesForSelection('10', 'all', '2026-11-03'), {month:'10',year:'2026',from:'2026-10-01',to:'2026-10-31'});
});
check('Manual October dates select October and year 2026', () => {
  assert.deepEqual(selectionForRatingDates('2026-10-05','2026-10-21'),{month:'10',year:'2026'});
});
check('Manual range crossing months selects all months within its year', () => {
  assert.deepEqual(selectionForRatingDates('2026-10-15','2026-11-03'),{month:'all',year:'2026'});
});
check('Manual range crossing years selects all months and years', () => {
  assert.deepEqual(selectionForRatingDates('2025-12-30','2026-01-03'),{month:'all',year:'all'});
});
check('Manual invalid ranges and API-banned spans cannot be applied', () => {
  assert.equal(isValidRatingPeriod('2026-11-03','2026-10-01'),false);
  assert.equal(isValidRatingPeriod('2026-02-31','2026-03-01'),false);
  assert.equal(isValidRatingPeriod('2018-01-01','2026-12-31'),false);
  assert.equal(isValidRatingPeriod('2026-10-01','2026-11-03'),true);
});

// Freeze the simulated browser clock so this regression test remains valid
// in later years (production always uses the real Riyadh date).
const ActualDate = Date;
const fixedTime = ActualDate.parse('2026-11-03T09:00:00.000Z');
class FixedTestDate extends ActualDate {
  constructor(...args) { if (!args.length) super(fixedTime); else super(...args); }
  static now() { return fixedTime; }
}
global.Date = FixedTestDate;
// Render the actual component with minimal React hook and API shims, so the
// selectors, apply callback, query and displayed rankings are exercised together.
const states = []; let cursor = 0; let lastQuery;
const fakeReact = {
  Fragment:'Fragment',
  useState(initial) {
    const index=cursor++;
    if (!(index in states)) states[index]= typeof initial === 'function' ? initial() : initial;
    return [states[index],value=>{ states[index]=typeof value === 'function' ? value(states[index]) : value; }];
  },
  useEffect(){},
  useMemo(callback){return callback();},
};
const jsx = (type,props)=>({type,props:props||{}});
const ratingRows = [
  {item_id:'old',assignee_id:'a',assignee_name:'أكتوبر',percentage:90,created_at:'2026-10-15T10:00:00Z',scores:[],outcome:'approved'},
  {item_id:'current',assignee_id:'b',assignee_name:'نوفمبر',percentage:95,created_at:'2026-11-02T10:00:00Z',scores:[],outcome:'approved'},
  {item_id:'prior',assignee_id:'c',assignee_name:'قديم',percentage:80,created_at:'2025-10-02T10:00:00Z',scores:[],outcome:'approved'},
];
const fakeWorkQuery = (_key,query) => {
  lastQuery = query;
  return {data:{rows:ratingRows.filter(r=>r.created_at.slice(0,10)>=query.dateFrom && r.created_at.slice(0,10)<=query.dateTo)},loading:false,error:null,reload:()=>{}};
};
const loadPage=createLoader(process.cwd(),{
  'react':fakeReact,
  'react/jsx-runtime':{jsx,jsxs:jsx},
  '@phosphor-icons/react': {Medal:'Medal',TrendUp:'TrendUp',UsersThree:'UsersThree',CalendarBlank:'CalendarBlank'},
  '../../../shared/marketing-workflow':{workRatingLevel:()=>({css:'good',label:'جيد'})},
  '../workflow/TaskDetail':{RatingStars:'RatingStars'},
  '../workflow/api':{useWorkQuery:fakeWorkQuery},
  '../marketing.css':{},
});
const {MarketingRatingsPage}=loadPage('src/marketing/pages/MarketingRatingsPage.tsx');
function render(){cursor=0;return MarketingRatingsPage();}
function allElements(root){
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(allElements);
  return [root,...allElements(root.props?.children)];
}
function field(root,label,type){
  const labeled=allElements(root).find(node=>node.type==='label' &&
    (Array.isArray(node.props.children)?node.props.children[0]:node.props.children)===label);
  assert(labeled,`Missing label ${label}`);
  const child=allElements(labeled).find(node=>node.type===type);
  assert(child,`Missing ${type} for ${label}`);
  return child;
}
function applyButton(root){return allElements(root).find(node=>node.type==='button' && node.props.onClick &&
  JSON.stringify(node.props.children).includes('تطبيق التاريخ'));}
function change(root,label,type,value){field(root,label,type).props.onChange({target:{value}});}
function summary(root){return allElements(root).filter(node=>node.type==='article').map(node=>JSON.stringify(node.props.children)).join('|');}
check('Component month picker updates both dates without changing applied query before apply',()=>{
  let root=render();
  change(root,'الشهر','select','10');root=render();
  assert.equal(field(root,'من تاريخ','input').props.value,'2026-10-01');
  assert.equal(field(root,'إلى تاريخ','input').props.value,'2026-10-31');
  assert.equal(field(root,'السنة','select').props.value,'2026');
  assert.notDeepEqual(lastQuery,{dateFrom:'2026-10-01',dateTo:'2026-10-31'});
});
check('Apply actually queries October and shows October evaluation instead of zero',()=>{
  let root=render(); applyButton(root).props.onClick(); root=render();
  assert.deepEqual(lastQuery,{dateFrom:'2026-10-01',dateTo:'2026-10-31'});
  assert(summary(root).includes('أكتوبر'));
  assert(!summary(root).includes('نوفمبر'));
});
check('Selecting previous year preserves month and re-queries its real period',()=>{
  let root=render();
  const year=field(root,'السنة','select');
  assert(allElements(year).some(node=>node.type==='option' && node.props.value==='2025'),'Previous year missing from dropdown');
  change(root,'السنة','select','2025');root=render();
  assert.equal(field(root,'من تاريخ','input').props.value,'2025-10-01');
  assert.equal(field(root,'إلى تاريخ','input').props.value,'2025-10-31');
  applyButton(root).props.onClick();root=render();
  assert.deepEqual(lastQuery,{dateFrom:'2025-10-01',dateTo:'2025-10-31'});
  assert(summary(root).includes('قديم'));
});
check('Manual date range synchronizes year/month without accidentally hiding cross-month results',()=>{
  let root=render();
  change(root,'من تاريخ','input','2026-10-15');root=render();
  change(root,'إلى تاريخ','input','2026-11-03');root=render();
  assert.equal(field(root,'الشهر','select').props.value,'all');
  assert.equal(field(root,'السنة','select').props.value,'2026');
  applyButton(root).props.onClick();root=render();
  assert.deepEqual(lastQuery,{dateFrom:'2026-10-15',dateTo:'2026-11-03'});
  assert(summary(root).includes('أكتوبر'));
  assert(summary(root).includes('نوفمبر'));
});
check('Manually returning to one month selects that month and retains exact custom days',()=>{
  let root=render();
  change(root,'إلى تاريخ','input','2026-10-30');root=render();
  assert.equal(field(root,'الشهر','select').props.value,'10');
  assert.equal(field(root,'السنة','select').props.value,'2026');
  assert.equal(field(root,'من تاريخ','input').props.value,'2026-10-15');
  applyButton(root).props.onClick();root=render();
  assert.deepEqual(lastQuery,{dateFrom:'2026-10-15',dateTo:'2026-10-30'});
});
check('All-years selection resets the month and loads a server-valid continuous period',()=>{
  let root=render();
  change(root,'السنة','select','all');root=render();
  assert.equal(field(root,'الشهر','select').props.value,'all');
  assert.equal(field(root,'السنة','select').props.value,'all');
  const initialYear=Number(new Date().toLocaleDateString('en-CA',{year:'numeric',timeZone:'Asia/Riyadh'}));
  assert.equal(field(root,'من تاريخ','input').props.value,`${initialYear - 4}-01-01`);
  assert.equal(field(root,'إلى تاريخ','input').props.value,`${initialYear}-12-31`);
  assert.equal(applyButton(root).props.disabled,false);
  applyButton(root).props.onClick();root=render();
  assert(isValidRatingPeriod(lastQuery.dateFrom,lastQuery.dateTo));
});
check('Source preserves ranking and evaluation formulas and avoids redundant date filters',()=>{
  const source=fs.readFileSync('src/marketing/pages/MarketingRatingsPage.tsx','utf8');
  assert.match(source,/rankRatings\(rows\)/);
  assert.match(source,/workRatingLevel\(row.percentage\)/);
  assert.doesNotMatch(source,/monthlyRows/);
  assert.match(source,/dateFrom: applied.from, dateTo: applied.to/);
  assert.match(source,/onClick=\{applyPeriod\}/);
  const tsSource=ts.createSourceFile('ratings.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  assert.equal(tsSource.parseDiagnostics.length,0);
  const helperSource=ts.createSourceFile('filters.ts',fs.readFileSync('src/marketing/pages/ratingsDateFilters.ts','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert.equal(helperSource.parseDiagnostics.length,0);
});
global.Date = ActualDate;
console.log(`Marketing ratings date/month filter synchronization: ${passed}/${passed} passed`);
