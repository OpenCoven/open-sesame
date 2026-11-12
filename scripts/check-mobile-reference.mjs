// Qualify the preserved v0.3 artifact without rewriting it or contacting any service.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const reference = fileURLToPath(new URL('../examples/mobile-reference/', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(reference, 'upstream-files.json'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(manifest.version, '0.3.0');
assert.equal(Object.keys(manifest.files).length, 18, 'All eighteen supplied source files remain pinned');
assert.equal(manifest.standaloneSha256, 'f9fbd88673b3cdfc754540ad864fd58c34b47498bbae95c8e5d0555fb7de281a', 'Approved standalone revision');
assert.equal(manifest.brandCommit, '798e2f5f2f1a69f5d156ccc0a9aafc4f7da55fc8', 'Approved canonical brand revision');
// The README alone carries one delimited repository note (issue #34 after the desktop restart).
// Removing exactly that block must leave the supplied bytes; every other file is compared as stored.
const noteStart = Buffer.from('<!-- open-sesame:repository-note:start -->\n');
const noteEnd = Buffer.from('<!-- open-sesame:repository-note:end -->\n\n');
assert.deepEqual(manifest.repositoryNotes, ['README.md'], 'Only the reference README carries a repository note');
function splitRepositoryNote(relative, bytes) {
  const start = bytes.indexOf(noteStart), end = bytes.indexOf(noteEnd);
  assert(start > 0 && end > start, `${relative}: one delimited repository note follows the original title`);
  assert(bytes.indexOf(noteStart, start + 1) === -1 && bytes.indexOf(noteEnd, end + 1) === -1, `${relative}: exactly one repository note`);
  return {
    note: bytes.subarray(start + noteStart.length, end).toString('utf8'),
    upstream: Buffer.concat([bytes.subarray(0, start), bytes.subarray(end + noteEnd.length)]),
  };
}
for (const [relative, entry] of Object.entries(manifest.files)) {
  assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'), 'Manifest paths remain inside the reference');
  let bytes = readFileSync(path.join(reference, relative));
  if (manifest.repositoryNotes.includes(relative)) {
    const { note, upstream } = splitRepositoryNote(relative, bytes);
    const issue = number => `https://github.com/OpenCoven/open-sesame/issues/${number})`;
    assert.match(note, /visual source of truth for the mobile app/, 'Note names the mobile visual source of truth');
    for (const number of [33, 34, 61, 76, 77]) assert(note.includes(issue(number)), `Note links issue #${number}`);
    assert.match(note, /candidate visual reference for the new desktop/, 'Note keeps the desktop use a candidate pending #61');
    assert.match(note, /demo storage and scripted familiars are not production contracts/, 'Note excludes demo storage and scripted familiars from production contracts');
    assert(!/[^\n]\n[^\n]/.test(note), 'Each note paragraph stays on one source line');
    bytes = upstream;
  }
  assert.equal(bytes.length, entry.bytes, `${relative}: preserved length`);
  assert.equal(digest(bytes), entry.sha256, `${relative}: preserved upstream bytes`);
}
const html = readFileSync(path.join(reference, 'dist/index.html'));
assert.equal(digest(html), manifest.standaloneSha256, 'Exact supplied standalone artifact');
assert.equal(digest(readFileSync(path.join(reference, 'design/brand/mark.svg'))), '3cc1d06c3f957221760984937715f6cde38ac9f69cfa1eb18041c4cbd935c078', 'Canonical mark source bytes');
const original = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: reference, encoding: 'utf8', timeout: 10000 });
assert.ifError(original.error);
assert.equal(original.status, 0, original.stdout + original.stderr);
assert.equal((original.stdout.match(/^PASS /gm) || []).length, 12, 'Execute all twelve original checks');
process.stdout.write(original.stdout);

const scratch = mkdtempSync(path.join(tmpdir(), 'sesame-mobile-reference-'));
try {
  cpSync(reference, scratch, { recursive: true });
  for (let pass = 0; pass < 2; pass++) {
    const result = spawnSync(process.execPath, ['scripts/apply-theme.mjs'], { cwd: scratch, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(readFileSync(path.join(scratch, 'dist/index.html')), html, `Theme rebuild ${pass + 1} preserves exact delivered bytes`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
assert.deepEqual(readFileSync(path.join(reference, 'dist/index.html')), html, 'Qualification never rewrites the preserved HTML');
console.log('Preserved source/font/license hashes, the delimited README repository note and two exact theme rebuilds pass. Browser and native acceptance remain separate.');
