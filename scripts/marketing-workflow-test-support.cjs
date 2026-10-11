// Test-only TypeScript loader. External services are explicitly stubbed; no
// test in this suite opens a production database or contacts a social API.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function createLoader(root, stubs = {}, extraExports = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const input = fs.readFileSync(file, 'utf8') + (extraExports[path.relative(root, file)] || '');
    const js = ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const localRequire = (name) => {
      if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
      if (!name.startsWith('.')) return require(name);
      let resolved = path.resolve(path.dirname(file), name);
      if (resolved.endsWith('.js')) resolved = resolved.slice(0, -3);
      const p = [resolved, resolved + '.ts', resolved + '.tsx'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!p) throw new Error('Test import not found: ' + name);
      if (Object.prototype.hasOwnProperty.call(stubs, path.relative(root, p))) return stubs[path.relative(root, p)];
      return load(p);
    };
    new Function('require', 'module', 'exports', js)(localRequire, module, module.exports);
    return module.exports;
  }
  return load;
}
function scriptedSql(steps) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim(); calls.push({ query, values });
    const step = steps.shift();
    if (!step || !(typeof step.match === 'string' ? query.includes(step.match) : step.match.test(query))) throw new Error('Unexpected SQL: ' + query + '\nExpected: ' + step?.match);
    if (step.check) step.check(values, query);
    if (step.error) throw step.error;
    return typeof step.rows === 'function' ? step.rows(values, query) : step.rows || [];
  };
  sql.begin = async fn => fn(sql); sql.json = value => value;
  sql.assertDone = () => { if (steps.length) throw new Error('Unconsumed SQL expectations: ' + steps.map(s => s.match).join(', ')); };
  sql.calls = calls;
  return sql;
}
module.exports = { createLoader, scriptedSql };
