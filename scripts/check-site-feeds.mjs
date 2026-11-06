import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const link=(href,text,{nav=false,header=false,article=false,date='',summary=''}={})=>({textContent:text,type:'',getAttribute:k=>k==='href'?href:null,matches:()=>true,closest:selector=>selector==='article'?(article?{querySelector:s=>s==='p'?{textContent:summary}:date?{getAttribute:()=>date}:null}:null):selector==='header'?header:nav,querySelector:()=>null});
let nodes=[],alternates=[],failure=false;
const doc={title:'Example & Ideas',querySelectorAll:selector=>{if(selector.startsWith('link['))return alternates;if(selector==='broken[')throw Error('Invalid selector');return nodes}};
const content=new Map([['https://example.com/blog',{text:'HTML',url:'https://example.com/blog'}]]);
const ctx={window:{},URL,Date,pageUrl:value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}},DOMParser:class{parseFromString(text,type){if(type==='text/html')return doc;return {documentElement:{localName:text==='RSS'?'rss':'html'},getElementsByTagName:()=>[]}}},OpenSesameContent:{async fetchText(url){if(failure||!content.has(url))throw Error('Cannot load source');return content.get(url)}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/site-feeds.js','utf8'),ctx);const feeds=ctx.window.OpenSesameSiteFeeds;
nodes=[link('/one#read','First article',{header:true,article:true,date:'2026-01-02',summary:'Text & detail'}),link('/one#duplicate','First repeated'),link('/two','Second article'),link('/nav','Menu item',{nav:true}),link('https://other.example/other','Other origin'),link('/picture.png','An image'),link('javascript:alert(1)','Unsafe URL'),link('/tiny','Hi')];
const extracted=feeds.extract('HTML','https://example.com/blog');assert.equal(extracted.entries.length,2);assert.equal(extracted.entries[0].url,'https://example.com/one');assert.ok(extracted.entries[0].date);assert.equal(extracted.entries[1].date,0);
assert.throws(()=>feeds.extract('HTML','https://example.com/blog','broken['),/valid CSS/);
const generated=await feeds.generate('https://example.com/blog');assert.equal(generated.generated,true);assert.match(generated.text,/Example &amp; Ideas/);
alternates=[{type:'application/rss+xml',getAttribute:()=>'/rss'}];content.set('https://example.com/rss',{text:'RSS',url:'https://example.com/rss'});
assert.equal((await feeds.generate('https://example.com/blog')).discovered,true);assert.equal((await feeds.generate('https://example.com/rss')).discovered,true);
assert.equal((await feeds.generate('https://example.com/blog','article a')).generated,true,'Explicit selector overrides discovered feed');
content.set('https://example.com/rss',{text:'HTML',url:'https://example.com/rss'});assert.equal((await feeds.generate('https://example.com/blog')).generated,true,'Invalid advertised feed falls back to page links');
nodes=[];await assert.rejects(()=>feeds.generate('https://example.com/blog'),/No article links/);
failure=true;await assert.rejects(()=>feeds.generate('https://example.com/blog'),/Cannot load/);
const xml=feeds.xml('A & <B>\u0001','https://example.com/?a=1&b=2',[{title:'"Quoted" <title>',url:'https://example.com/a?x=1&y=2',description:'<script>Literal text</script>',date:Date.UTC(2026,0,2)},{id:'sample',title:'No link',date:'invalid'}]);
const parsed=JSON.parse(execFileSync('python3',['-c',`import sys,json,xml.etree.ElementTree as E
root=E.fromstring(sys.stdin.read());items=root.findall('./channel/item')
print(json.dumps({'title':root.findtext('./channel/title'),'count':len(items),'description':items[0].findtext('description'),'dates':len(root.findall('./channel/item/pubDate')),'guid':items[1].find('guid').attrib}))`],{input:xml,encoding:'utf8'}));
assert.deepEqual(parsed,{title:'A & <B>',count:2,description:'<script>Literal text</script>',dates:1,guid:{isPermaLink:'false'}});
console.log('Site-feed extraction with DOM fixtures, same-origin/unsafe link filtering, deduplication, discovery/fallback, selector override, empty/error states, and independent XML parsing passed. Browser DOM/rendering remains separate.');
