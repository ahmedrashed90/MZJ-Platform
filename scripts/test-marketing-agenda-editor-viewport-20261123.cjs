'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A bounded, scrollable CSS grid was squeezing all 36 closed <details>
// elements into 5-6 px tracks. Keep the closed disclosure rows at
// their natural height while the list itself scrolls.
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const css = read('src/marketing/workflow/strategyDrafts.css');
const source = read('src/marketing/workflow/AgendaIdeaDateEditor.tsx');
const rule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing style for ${selector}`);
  return match[1];
};
const list = rule('.mkw-agenda-idea-list');
assert.match(list, /display\s*:\s*flex\s*;/);
assert.match(list, /flex-direction\s*:\s*column\s*;/);
assert.match(list, /overflow-y\s*:\s*auto\s*;/);
assert.match(list, /max-height\s*:/);
const row = rule('.mkw-agenda-idea-row');
assert.match(row, /flex\s*:\s*0\s+0\s+auto\s*;/);
assert.match(row, /min-height\s*:/);
const summary = rule('.mkw-agenda-idea-row > summary');
assert.match(summary, /min-height\s*:/);
assert.match(source, /<details key=\{idea\.ideaCode\} className="mkw-agenda-idea-row">/);
assert.match(source, /currentDates:/);
assert.match(source, /reschedule_agenda_ideas/);
console.log('PASS: approved-agenda idea editor keeps every collapsed row readable inside its own scrolling list');
