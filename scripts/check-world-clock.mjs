import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window={},context=vm.createContext({window});
vm.runInContext(fs.readFileSync('dist/world-clock.js','utf8'),context);
const query=window.OpenSesameWorldClock.query,winter='2026-01-15T12:00:00Z',summer='2026-07-15T12:00:00Z';
assert.match(query('time in germany',winter).result,/1:00:00 PM/);
assert.match(query('time in Germany?',summer).result,/2:00:00 PM/);
for(const text of ['What time is it in Berlin?','What’s the time in Berlin?','What is the time in Berlin?','What’s the time in Berlin?'.replace('’',"'"),'current time in DE','local time at Deutschland','time in Europe/Berlin'])assert.equal(query(text,winter).timeZone,'Europe/Berlin',text);
assert.match(query('time in Tokyo',winter).result,/9:00:00 PM/);
assert.match(query('time in Kolkata',winter).result,/5:30:00 PM/);
assert.match(query('time in Kathmandu',winter).result,/5:45:00 PM/);
assert.match(query('time in New York',winter).result,/7:00:00 AM/);
assert.match(query('time in Tokyo','2026-01-15T23:30:00Z').expression,/Jan 16/,'Date follows destination across midnight');
assert.match(query('time in USA',winter).error,/Choose a city/);
assert.match(query('time in Australia',winter).error,/Choose a city/);
assert.match(query('time in Atlantis',winter).error,/Place not found/);
assert.match(query('time in',winter).error,/Enter a city/);
assert.ok(query('time now',winter).timeZone);assert.ok(query('what is the time here?',winter).timeZone);
for(const text of ['schedule time in Germany tomorrow','time in Germany tomorrow','/note time in germany','! time in germany','2 + 2','time','meeting in Berlin']){
 const result=query(text,winter);assert.ok(result===null||result.error,`Never invent a time for ${text}`);
}
const capture=fs.readFileSync('dist/capture.js','utf8');vm.runInContext(capture.slice(capture.indexOf('  const views='),capture.indexOf('  const el=id=>'))+';this.interpret=interpret;',context);
assert.equal(context.interpret('time in Germany').kind,'time');assert.equal(context.interpret('time in USA').incomplete,true);
assert.equal(context.interpret('time in Germany','note').kind,'item');
window.OpenSesameShellInput={interpret:()=>({kind:'shell'})};assert.equal(context.interpret('time in Germany').kind,'shell','Selected shell retains literal command ownership');
console.log('Offline clock queries: country/city/IANA matching, winter/summer offsets, fractional offsets, destination dates, ambiguity, unknown places and literal shell/capture ownership passed.');
