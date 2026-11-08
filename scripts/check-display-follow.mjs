import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('dist/app.js','utf8');
const frameScreen=source.slice(source.indexOf('function frameScreen()'),source.indexOf('\n',source.indexOf('function frameScreen()')));
const listeners=new Map();let renders=0;
const context={window:{__OPEN_SESAME_NATIVE__:true,__OPEN_SESAME_SCREEN__:{width:1920,height:1080},screen:{width:1512,height:982},addEventListener:(event,fn)=>listeners.set(event,fn)},state:{resolution:'1280,800'},render(){renders++}};
vm.createContext(context);vm.runInContext(frameScreen,context);
const size=()=>Array.from(context.frameScreen());
assert.deepEqual(size(),[1920,1080],'The native target display overrides stale WKWebView screen dimensions');
context.window.__OPEN_SESAME_SCREEN__={width:800,height:600};assert.deepEqual(size(),[800,600]);
for(const screen of [undefined,{width:NaN,height:1080},{width:0,height:1080},{width:1920,height:Infinity}]){context.window.__OPEN_SESAME_SCREEN__=screen;assert.deepEqual(size(),[1512,982])}
context.window.screen={};assert.deepEqual(size(),[1512,982]);
context.window.__OPEN_SESAME_NATIVE__=false;assert.deepEqual(size(),[1280,800],'Browser simulation keeps its configured resolution');
const listener=source.split('\n').find(line=>line.startsWith("window.addEventListener('open-sesame-display-changed'"));
assert.ok(listener);vm.runInContext(listener,context);listeners.get('open-sesame-display-changed')();assert.equal(renders,0);
context.window.__OPEN_SESAME_NATIVE__=true;listeners.get('open-sesame-display-changed')();assert.equal(renders,1,'Crossing native displays recomputes the actual widget presets');
console.log('Native display dimensions, stale-screen fallback, browser simulation and display-change rendering passed.');
