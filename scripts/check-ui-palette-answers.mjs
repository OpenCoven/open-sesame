// Palette answers (issue #77). ui/palette-answers.js is an ES-module port of the prototype's
// calculator and world clock. This pins it to dist/calculator.js and dist/world-clock.js, loaded
// in node:vm as the prototype checks do, over a fixed table and a seeded generated table, and
// checks that the port is pure: no globals, storage, network or evaluated text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(path.join(root, file), 'utf8');
const port = await import(pathToFileURL(path.join(root, 'ui/palette-answers.js')));
const { calculate, format, timeQuery, answer, places } = port;

const window = {};
const context = vm.createContext({ window });
vm.runInContext(read('dist/calculator.js'), context);
vm.runInContext(read('dist/world-clock.js'), context);
const prototype = { calculate: window.OpenSesameCalculator.calculate, format: window.OpenSesameCalculator.format, query: window.OpenSesameWorldClock.query };
// Objects made in the vm have another realm's prototype; compare plain copies.
const plain = value => value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));

// 1. The calculator matches the prototype over a fixed table.
const sums = ['2+2', '2-2', '2/0', '0/5', '-0', '1/3', '0.1+0.2', '.5+.5', '1e3+1', '1e308*10', '2^10', '2**3', '2^-1', '-2^2', '50% of 200', '10%', '3(4)', '2pi', 'pi*2', 'π/2', 'e', 'sin(pi/2)', 'cos 0', 'tan(0)', 'log 100', 'log10 1000', 'log2 8', 'ln(e)', 'sqrt(16)', 'sqrt 2', 'sqrt(-1)', 'abs -3', 'round(2.5)', 'floor(2.7)', 'ceil 2.1', '1,000 * 3', '12 ÷ 4', '3 × 3', '5 − 2', '4 – 1', '2·3', '= 3*4 =', '=7', '(1+2', '1+2)', '((((((((((((((((((((((((((1))))))))))))))))))))))))))', '(((((((((((((((((((((((1)))))))))))))))))))))))', '1+', '*2', '2 2', '10 km to mi', '10 km in miles', '5 ft', '5 feet into m', '6\'', '12"', '100 f to c', '100 °F to °C', '-500 c to f', '-459.67 f to k', '0 k', '10 kg to m', '1 gib to mb', '1 gb', '1 kib', '1 gal to l', '1 cup', '2 fl oz', '3 us cup to ml', '90 min', '2 days to h', '1 week', '5 mm', '1 mi to', '1 mi to...', '1 mi to…', '3 lbs to kg', '1 oz', '250 mg', 'hello', 'An ordinary thought', 'x', 'meeting at 2-3', 'call 555-1212', 'buy 2 apples', '1 - 1', '3 -2', '7-', '', '   ', 'a'.repeat(501), '1+1'.padEnd(500, ' '), '2\n2', 'sin', 'pi', '1e', '1e5', '1.', '.', '+', '-', '%', '()', '(2)(3)', '2(3)(4)', 'abs(-2)abs(-3)', 'log', 'ln 0', 'log(0)', '10/3*3', '1e-13', '-1e-13+0', '123456789012345678', '0.000001234'];
// The parser's two limits, on each side: nesting depth 24 and 128 tokens.
for (let depth = 20; depth <= 28; depth++) sums.push('('.repeat(depth) + '1' + ')'.repeat(depth), 'sqrt'.repeat(depth) + ' 4');
for (let count = 125; count <= 131; count++) sums.push((count % 2 ? '' : '-') + '1+'.repeat(Math.floor((count - 1) / 2)) + '1');
for (const text of sums) assert.deepEqual(plain(calculate(text)), plain(prototype.calculate(text)), `calculate(${JSON.stringify(text)})`);
for (const value of [0, -0, 1 / 3, 1e21, -12345.6789, 2 ** 53, Number.MIN_VALUE]) assert.equal(format(value), prototype.format(value), `format(${value})`);

// 2. And over a generated table from a seeded generator, so a missed branch shows up.
let seed = 77;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pieces = ['1', '2', '0', '7', '.5', '3.25', '1e3', '+', '-', '*', '/', '^', '%', '(', ')', ' ', 'pi', 'e', 'sqrt', 'log', 'ln', 'sin', 'abs', '×', '÷', '−', ',', 'of', 'km', 'mi', ' to ', 'c', 'f', 'kg', 'gb', 'x', 'π', '**'];
for (let i = 0; i < 4000; i++) {
  const length = 1 + Math.floor(random() * 9);
  let text = '';
  for (let j = 0; j < length; j++) text += pieces[Math.floor(random() * pieces.length)];
  assert.deepEqual(plain(calculate(text)), plain(prototype.calculate(text)), `generated calculate(${JSON.stringify(text)})`);
}

// 3. The world clock matches the prototype: its place index exactly, and its answers at fixed
// instants for every listed place, country and alias.
const listed = JSON.parse(read('dist/world-clock.js').match(/const places=(\[\[.*?\]\]);/)[1]);
assert.deepEqual(places.map(entry => [...entry]), listed, 'The place index is the prototype index');
const instants = ['2026-01-15T12:00:00Z', '2026-07-15T12:00:00Z', '2026-01-15T23:30:00Z', '2026-03-29T00:59:59Z'];
const clockQueries = ['time in germany', 'time in Germany?', 'What time is it in Berlin?', 'What’s the time in Berlin?', "What's the time in Berlin?", 'What is the time in Berlin?', 'current time in DE', 'local time at Deutschland', 'time in Europe/Berlin', 'time in Tokyo', 'time in Kolkata', 'time in Kathmandu', 'time in New York', 'time in nyc', 'time in LA', 'time in USA', 'time in Australia', 'time in Atlantis', 'time in', 'time now', 'what is the time here?', 'time here', 'time in UTC', 'time in gmt', 'time in São Paulo', 'time in sao_paulo', 'time in Port-au-Prince', 'time in Asia/Kathmandu', 'time in Not/AZone', 'time in america/new_york', 'time in Chatham', 'time in Lord Howe', 'TIME IN PARIS!!', 'time at   london.', 'time in united kingdom', 'time in south korea', 'time in mumbai', 'schedule time in Germany tomorrow', 'time in Germany tomorrow', '/note time in germany', '! time in germany', '2 + 2', 'time', 'meeting in Berlin', 'time in ' + 'x'.repeat(300), 42];
for (const at of instants) {
  for (const text of clockQueries) assert.deepEqual(plain(timeQuery(text, at)), plain(prototype.query(text, at)), `timeQuery(${JSON.stringify(text)}, ${at})`);
  for (const [country, zone] of listed) {
    for (const text of [`time in ${zone}`, `time in ${zone.split('/').at(-1).replace(/_/g, ' ')}`, `time in ${country}`]) assert.deepEqual(plain(timeQuery(text, at)), plain(prototype.query(text, at)), `timeQuery(${JSON.stringify(text)}, ${at})`);
  }
}
// The local zone for "here" and "now" is injected, so the palette is deterministic in tests.
assert.equal(timeQuery('time here', '2026-01-15T12:00:00Z', 'Asia/Tokyo').timeZone, 'Asia/Tokyo');
assert.match(timeQuery('time now', '2026-01-15T12:00:00Z', 'Asia/Tokyo').result, /9:00:00 PM/);

// 4. answer() follows the prototype's order: nothing for / and ! input, then the clock, then the
// calculator; anything else is an ordinary query and gets no answer.
assert.equal(answer('/2+2'), null);
assert.equal(answer('! 2+2'), null);
assert.equal(answer('capture note'), null);
assert.equal(answer('open today'), null);
assert.equal(answer(''), null);
assert.deepEqual(answer('2+2'), { kind: 'calculation', ...calculate('2+2') });
assert.equal(answer('2+2').result, '4');
assert.equal(answer('2/0').error, 'Cannot divide by zero.');
const berlin = answer('time in Germany', { now: '2026-01-15T12:00:00Z' });
assert.equal(berlin.kind, 'time');
assert.match(berlin.result, /1:00:00 PM/);
assert.equal(berlin.timeZone, 'Europe/Berlin');
assert.equal(answer('time in USA', { now: '2026-01-15T12:00:00Z' }).kind, 'time');
assert.match(answer('time in USA', { now: '2026-01-15T12:00:00Z' }).error, /Choose a city/);
assert.equal(answer('time here', { now: '2026-01-15T12:00:00Z', localZone: 'UTC' }).timeZone, 'UTC');

// 5. The port is pure. It imports nothing, reaches no global, storage or network, and never
// evaluates text: the calculator is a parser. Comments are not stripped first.
const source = read('ui/palette-answers.js');
assert(!/\bimport\b/.test(source), 'The port imports nothing');
assert(!/\b(?:window|globalThis|self|document|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|navigator)\b/.test(source), 'The port reaches no global, storage or network');
assert(!/\beval\b|\bFunction\b|setTimeout|setInterval/.test(source), 'The port evaluates no text and schedules nothing');
assert(Object.isFrozen(port.places) && port.places.every(Object.isFrozen), 'The place index cannot be changed by a caller');

console.log(`Palette answers match the prototype calculator (${sums.length} fixed, 4000 generated) and world clock (${listed.length} places at ${instants.length} instants), follow its answer order, inject the local zone and stay pure.`);
