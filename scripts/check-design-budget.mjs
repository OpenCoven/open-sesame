// A ratchet on the authored cascade: every measure may fall, none may rise without an explicit, reviewed ceiling change.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {measure} from './design-metrics.mjs';

const budget=JSON.parse(fs.readFileSync('scripts/design-budget.json','utf8')),{totals}=measure();
if(process.argv.includes('--print')){console.log(JSON.stringify(totals,null,2));process.exit(0)}
// A page that links a tokenized stylesheet without the token sheet would resolve those tokens to nothing.
// Only names the token sheet alone defines are checked; older semantic names are also defined by the theme sheet and may be
// referenced by rules that cannot match on a given page.
const definedIn=file=>new Set([...fs.readFileSync(file,'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match=>match[1]));
const elsewhere=new Set(fs.readdirSync('dist').filter(name=>name.endsWith('.css')&&name!=='design-tokens.css').flatMap(name=>[...definedIn('dist/'+name)]));
const tokenNames=new Set([...definedIn('dist/design-tokens.css')].filter(name=>!elsewhere.has(name)));
for(const page of [...fs.readdirSync('dist').filter(name=>name.endsWith('.html')).map(name=>'dist/'+name),...fs.readdirSync('scripts/fixtures').filter(name=>name.endsWith('.html')).map(name=>'scripts/fixtures/'+name)]){
  const sheets=[...fs.readFileSync(page,'utf8').matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"?]+\.css)/g)].map(match=>'dist/'+match[1].replace(/^(\.\.\/)*(dist\/)?/,'')).filter(file=>fs.existsSync(file));
  const text=sheets.map(file=>fs.readFileSync(file,'utf8')).join('\n'),defined=new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match=>match[1]));
  const missing=[...new Set([...text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map(match=>match[1]))].filter(name=>tokenNames.has(name)&&!defined.has(name));
  assert.deepEqual(missing,[],`${page} uses design tokens that none of its stylesheets define; link design-tokens.css first`);
}
const over=[],slack=[];
for(const [name,ceiling] of Object.entries(budget.ceilings)){
  assert.ok(name in totals,'Unknown budget measure: '+name);
  if(totals[name]>ceiling)over.push(`${name} ${totals[name]} exceeds ${ceiling}`);
  else if(totals[name]<ceiling)slack.push(`${name} ${totals[name]} (ceiling ${ceiling})`);
}
for(const name of Object.keys(totals))assert.ok(name in budget.ceilings,'Measure has no ceiling: '+name);
assert.deepEqual(over,[],'The cascade grew past its budget. Use an existing token or primitive, or change scripts/design-budget.json in the same reviewed change with the reason.\n'+over.join('\n'));
console.log(`Cascade budget holds for ${Object.keys(totals).length} measures.`+(slack.length?' Lower these ceilings to keep the gain: '+slack.join('; ')+'.':' Every ceiling is tight.'));
