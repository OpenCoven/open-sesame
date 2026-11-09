import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('dist/app.js','utf8');
function navigation(saved){
 const ctx={localStorage:{getItem:()=>JSON.stringify(saved)},OpenSesameFrameModel:{keys:['small','medium','large','max','full']},window:{dispatchEvent(){}},render(){},CustomEvent:Event};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('const defaults='),source.indexOf('let inspecting='))+';this.state=state;this.activityFor=activityFor;',ctx);
 vm.runInContext(source.slice(source.indexOf('function changeScenario('),source.indexOf('function fit(){')),ctx);return ctx;
}
let app=navigation({scenario:'focus',lockinView:'focus'});assert.equal(app.activityFor('focus'),'lockin');assert.equal(app.state.mediaView,'music');app.changeScenario('entertainment');assert.equal(app.state.scenario,'music');assert.equal(app.activityFor(app.state.scenario),'entertainment');app.changeScenario('youtube');app.changeScenario('lockin');assert.equal(app.state.scenario,'focus','Focus always opens the timer rather than the previous player');app.changeScenario('entertainment');assert.equal(app.state.scenario,'youtube','Media remembers its own tab');
app=navigation({scenario:'items',lockinView:'media'});app.changeScenario('entertainment');assert.equal(app.state.scenario,'media','Legacy playback choice migrates to Media');assert.equal('lockinView' in app.state,false);app=navigation(null);app.changeScenario('entertainment');assert.equal(app.state.scenario,'music','Null legacy settings must retain safe defaults');
app=navigation({mediaView:'not-valid',scenario:'items'});app.changeScenario('entertainment');assert.equal(app.state.scenario,'music');
const html=fs.readFileSync('dist/index.html','utf8'),mediaSection=html.slice(html.indexOf('<section id="lockin-workspace"'),html.indexOf('</section>',html.indexOf('<section id="lockin-workspace"')));assert.ok(!mediaSection.includes('id="pane-focus"'));assert.ok(!html.includes('id="lockin-focus"'));assert.match(html,/id="pane-focus"[^>]+aria-labelledby="tab-lockin"/);assert.match(mediaSection,/aria-labelledby="tab-entertainment"/);for(const tab of ['music','youtube','media'])assert.ok(mediaSection.includes('data-lockin="'+tab+'"'));
console.log('Dedicated Focus and Media navigation, independent remembered playback tab, legacy migration, safe defaults, accessible ownership and separation of timer/player panels passed.');
