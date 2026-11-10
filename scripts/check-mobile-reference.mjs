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
for (const [relative, entry] of Object.entries(manifest.files)) {
  assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'), 'Manifest paths remain inside the reference');
  const bytes = readFileSync(path.join(reference, relative));
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
console.log('Preserved source/font/license hashes and two exact theme rebuilds pass. Browser and native acceptance remain separate.');
