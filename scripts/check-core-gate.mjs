// Every bridge method the authored UI names must be classified by the Rust request gate:
// either ported, or refused with the fixed not-ported message. Nothing may fall through to the
// unknown-method reply. This reads source only; it runs no Rust and contacts nothing.
//
// The search, recorded for issue #67:
//   1. Files: every .js, .mjs and .html under dist/, except dist/vendor/ and dist/downloads/.
//   2. Direct calls: a quoted method literal as the first argument of request(...), which covers
//      request('x.y') and openSesameBridge.request('x.y'). Their first segments are the bridge
//      namespaces, together with the first segments of the gate's own lists.
//   3. Every other quoted literal shaped like a.b, a.b.c or a prefix a.b. whose first segment is a
//      bridge namespace. This finds methods passed through wrappers (bridge('vnc.open')), chosen by
//      a conditional (x ? 'webview.dock' : 'webview.popout'), listed in tables (the timeout list in
//      bridge.js) and built by concatenation ('screen.notes.' + kind).
// Step 3 also finds names that are not bridge methods. Those are listed below with the reason, so
// a new unclassified name fails this check until someone decides what it is.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const gateSource = readFileSync(path.join(root, 'crates/core/src/gate.rs'), 'utf8');

// Rust lists are read as text: `pub const NAME: &[&str] = &[ "a", "b" ];` with optional comments.
function rustList(name) {
  const match = gateSource.match(new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`));
  assert(match, `crates/core/src/gate.rs declares ${name} as a list of string literals`);
  const body = match[1].replace(/\/\/[^\n]*/g, '');
  const entries = [...body.matchAll(/"([^"\\]*)"/g)].map(entry => entry[1]);
  assert.equal(body.replace(/"[^"\\]*"/g, '').replace(/[\s,]/g, ''), '', `${name} holds only string literals`);
  return entries;
}
const ported = rustList('PORTED');
const notPorted = rustList('NOT_PORTED_PREFIXES');
assert(ported.length > 0 && notPorted.length > 0, 'The gate lists are not empty');

// Same rule as gate.rs: an entry ending in "." is a namespace, any other entry is one method.
const refusedBy = name => notPorted.find(entry => (entry.endsWith('.') ? name.startsWith(entry) : name === entry));

// Method-shaped names in dist/ that are not bridge methods. Keep the reason with each group.
const notBridgeMethods = new Map([
  // Events the host emits for ported terminals; the UI compares message.event with them.
  ['terminal.data', 'host event'],
  ['terminal.error', 'host event'],
  ['terminal.exit', 'host event'],
]);

const files = [];
(function walk(directory) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (relative !== 'dist/vendor' && relative !== 'dist/downloads') walk(relative);
    } else if (/\.(?:js|mjs|html)$/.test(entry.name)) files.push(relative);
  }
})('dist');
assert(files.length > 50, 'The authored UI was found');

const direct = new Map(), named = new Map();
const note = (map, name, file) => { if (!map.has(name)) map.set(name, file); };
const sources = files.map(file => [file, readFileSync(path.join(root, file), 'utf8')]);
for (const [file, text] of sources) {
  for (const match of text.matchAll(/(?:\.|\b)request\(\s*(['"`])([a-z][A-Za-z]*(?:\.[A-Za-z]+)+)\1/g)) note(direct, match[2], file);
}
assert(direct.has('system.info') && direct.has('auth.signIn'), 'Direct request() calls were found');
const namespaces = new Set([...direct.keys(), ...ported, ...notPorted].map(name => name.split('.')[0]));
for (const [file, text] of sources) {
  for (const match of text.matchAll(/(['"`])([a-z][A-Za-z]*(?:\.[A-Za-z]+)*\.?)\1/g)) {
    const name = match[2];
    if (name.includes('.') && namespaces.has(name.split('.')[0]) && !direct.has(name)) note(named, name, file);
  }
}

const unclassified = [], counts = { ported: 0, refused: 0, notMethods: 0 };
for (const [name, file] of [...direct, ...named]) {
  if (name.endsWith('.')) {
    // A prefix that the UI completes at run time: every completion must be refused by one entry.
    const entry = notPorted.find(candidate => candidate.endsWith('.') && name.startsWith(candidate));
    if (entry) counts.refused++;
    else unclassified.push(`${name}* (built at run time in ${file})`);
  } else if (refusedBy(name)) counts.refused++;
  else if (ported.includes(name)) counts.ported++;
  else if (notBridgeMethods.has(name) && !direct.has(name)) counts.notMethods++;
  else unclassified.push(`${name} (${file})`);
}
assert.deepEqual(unclassified, [], 'Every bridge method the UI names is ported or refused as not ported by crates/core/src/gate.rs');
for (const name of notBridgeMethods.keys()) assert(named.has(name), `${name} is still named in dist/; remove it from notBridgeMethods otherwise`);
for (const name of ported) assert(!refusedBy(name), `${name} is both ported and not ported`);

console.log(`Gate classifies ${direct.size} direct request() methods and ${named.size} other method-shaped names in ${files.length} authored files: ${counts.ported} ported, ${counts.refused} refused as not ported, ${counts.notMethods} known host events. Static source search only; no Rust was run.`);
