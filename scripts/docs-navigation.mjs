import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// A dependency-free subset for repository Markdown navigation, not a Markdown renderer.
export function withoutFences(source) {
  let fence = null;
  return source.split('\n').map(line => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}
const withoutCode = line => line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, '');
export function links(source) {
  const found = [], definitions = new Map(), lines = withoutFences(source).split('\n');
  const normalize = label => label.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const line of lines) {
    const match = line.match(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/);
    if (match) definitions.set(normalize(match[1]), match[2] || match[3]);
  }
  lines.forEach((raw, index) => {
    const line = withoutCode(raw);
    for (const match of line.matchAll(/(?<!\\)!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) found.push({target: match[1] || match[2], line: index + 1});
    for (const match of line.matchAll(/(?<!\\)\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      const label = normalize(match[2] || match[1]);
      found.push({target: definitions.get(label), reference: label, line: index + 1});
    }
    for (const shortcut of line.matchAll(/(?<!\\)\[([^\]\n]+)\](?![:[(])/g)) {
      if (definitions.has(normalize(shortcut[1]))) found.push({target: definitions.get(normalize(shortcut[1])), line: index + 1});
    }
  });
  return found;
}
export function anchors(source) {
  const ids = new Set(), lines = withoutFences(source).split('\n');
  const add = title => {
    const base = title.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').trim().replace(/ /g, '-');
    let name = base, count = 0;
    while (ids.has(name)) name = base + '-' + (++count);
    ids.add(name);
  };
  lines.forEach((line, index) => {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) add(heading[1]);
    else if (index && /^ {0,3}(?:=+|-+)\s*$/.test(line) && lines[index - 1].trim()) add(lines[index - 1]);
    for (const match of line.matchAll(/<(?:a|h[1-6])\b[^>]*(?:id|name)=["']([^"']+)/gi)) ids.add(match[1]);
  });
  return ids;
}
export function checkTarget(root, file, link) {
  if (!link.target) return 'Undefined reference [' + link.reference + ']';
  if (/^file:/i.test(link.target)) return 'Machine-local URL is not portable navigation: ' + link.target;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(link.target)) return null;
  let relative, fragment;
  try {
    const [resource, hash = ''] = link.target.split('#', 2);
    relative = decodeURIComponent(resource.split('?', 1)[0]);
    fragment = decodeURIComponent(hash);
  } catch { return 'Invalid URL encoding: ' + link.target; }
  let target = relative ? path.resolve(relative.startsWith('/') ? root : path.dirname(file), relative.replace(/^\//, '')) : file;
  if (target !== root && !target.startsWith(root + path.sep)) return 'Target escapes repository: ' + link.target;
  if (!fs.existsSync(target)) return 'Missing target: ' + link.target;
  const canonicalRoot = fs.realpathSync(root), canonicalTarget = fs.realpathSync(target);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(canonicalRoot + path.sep)) return 'Target symlink escapes repository: ' + link.target;
  if (!fragment) return null;
  if (fs.statSync(target).isDirectory()) target = path.join(target, 'README.md');
  if (!fs.existsSync(target)) return 'No README for directory anchor: ' + link.target;
  const source = fs.readFileSync(target, 'utf8');
  if (/\.md$/i.test(target)) return anchors(source).has(fragment) ? null : 'Missing heading/anchor: ' + link.target;
  const line = fragment.match(/^L([1-9]\d*)(?:-L([1-9]\d*))?$/);
  if (line && +line[1] <= +(line[2] || line[1]) && +(line[2] || line[1]) <= source.split('\n').length) return null;
  return 'Unsupported or missing source anchor: ' + link.target;
}

// Source downloads have no Git metadata; keep navigation checks useful there too.
export function markdownFiles(root) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
    if (fs.realpathSync(top) === fs.realpathSync(root)) return [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'}).split('\0'))]
      .filter(file => /\.md$/i.test(file) && !file.startsWith('vendor-src/') && !file.startsWith('dist/vendor/')).sort();
  } catch { /* An extracted source package deliberately has no .git directory. */ }
  const files = [];
  const skip = new Set(['.git', '.openai', '.vercel', '__pycache__', 'node_modules', 'build', 'vendor-src', 'dist/vendor', 'dist/downloads', 'web/auth-entrypoint/dist']);
  function walk(relative) {
    if (skip.has(relative) || skip.has(path.basename(relative))) return;
    const absolute = path.join(root, relative), info = fs.lstatSync(absolute);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) for (const name of fs.readdirSync(absolute)) walk(path.posix.join(relative, name));
    else if (/\.md$/i.test(relative)) files.push(relative);
  }
  for (const name of fs.readdirSync(root)) if (/\.md$/i.test(name) || ['.github', '.githooks', 'desktop', 'dist', 'docs', 'examples', 'scripts', 'web'].includes(name)) walk(name);
  return files.sort();
}
