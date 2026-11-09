import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {withoutFences, links, anchors, checkTarget, markdownFiles} from './docs-navigation.mjs';

// Guard meaningful parser boundaries: literal examples are not real navigation.
assert.equal(links('```md\n[example](missing.md)\n```\n[real](README.md)').length, 1);
assert.equal(links('`[literal](missing.md)`').length, 0);
assert.deepEqual(links('[guide][map]\n\n[map]: <docs/repository-map.md>')[0], {target: 'docs/repository-map.md', reference: 'map', line: 1});
assert.deepEqual([...anchors('# A `code` heading\n## Repeat\n## Repeat\n## Inspect → claim → plan')], ['a-code-heading', 'repeat', 'repeat-1', 'inspect--claim--plan']);
assert.deepEqual([...anchors('# <em>Visible</em> heading\n## <script')], ['visible-heading', 'script'], 'HTML-like headings are identifiers only, including incomplete markup');
assert.equal(withoutFences('~~~js\n# fake\n~~~\n# real').includes('fake'), false);

const temporary = fs.mkdtempSync(path.join(tmpdir(), 'sesame-doc-navigation-'));
try {
  fs.writeFileSync(path.join(temporary, 'README.md'), '# Extracted source\n');
  fs.mkdirSync(path.join(temporary, 'build'));
  fs.writeFileSync(path.join(temporary, 'build', 'ignored.md'), '[not-source](missing.md)');
  assert.deepEqual(markdownFiles(temporary), ['README.md'], 'Source packages work without Git and omit generated output');
} finally { fs.rmSync(temporary, {recursive: true}); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = markdownFiles(root);
let count = 0;
const failures = [];
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue; // A staged removal has no navigable content.
  if (fs.lstatSync(file).isSymbolicLink()) { failures.push(relative + ': Markdown source is a symlink; preserve and inspect its owner before reading.'); continue; }
  for (const link of links(fs.readFileSync(file, 'utf8'))) {
    ++count;
    const error = checkTarget(root, file, link);
    if (error) failures.push(`${relative}:${link.line}: ${error}`);
  }
}
assert.match(checkTarget(root, path.join(root, 'README.md'), {target: 'missing-document-for-check.md'}), /Missing target/);
assert.match(checkTarget(root, path.join(root, 'README.md'), {target: '#missing-heading-for-check'}), /Missing heading/);
assert.match(checkTarget(root, path.join(root, 'README.md'), {target: '../outside-this-repository.md'}), /escapes repository/);
if (failures.length) {
  process.stderr.write(failures.join('\n') + '\n');
  process.exitCode = 1;
} else console.log(`Validated ${count} Markdown links across ${files.length} first-party documents (local targets/anchors only; external services not contacted).`);
