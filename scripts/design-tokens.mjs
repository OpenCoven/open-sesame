// Snap literal colors, radii and durations in authored stylesheets onto dist/design-tokens.css.
// Deterministic and repeatable: after integrating other work, run it again rather than hand-merging values.
// Usage: node scripts/design-tokens.mjs [--apply] [--colors] [--radii] [--motion] [--type] [--verbose] [file.css ...]
// Without --apply it only reports. Without a kind it handles colors, radii and motion; --type is always explicit.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {authoredSheets,scanDeclarations,plainSpans,colorPattern,normalizeColor,tokenSheet,textFloor} from './design-metrics.mjs';
import {parseHex,oklab,distance,chroma,hue,over} from './design-color.mjs';

const args=process.argv.slice(2),flag=name=>args.includes('--'+name),apply=flag('apply'),verbose=flag('verbose');
const files=args.filter(arg=>arg.endsWith('.css')).map(arg=>path.basename(arg));
const explicit=['colors','radii','motion','type'].filter(flag),kinds=new Set(explicit.length?explicit:['colors','radii','motion']);
// Stylesheets whose exact values are specified elsewhere and owned by another task; they migrate with their owner.
const held=new Map([['mobile-shell.css','reference-derived mobile presentation, checked value-for-value by scripts/fixtures/mobile-visual.mjs'],['sign-in.css','the sign-in page migrates under its own review']]);
// A page that links a stylesheet without the token sheet would resolve every token to nothing, so such sheets are held
// until that page links the tokens too.
for(const file of [...fs.readdirSync('dist').filter(name=>name.endsWith('.html')).map(name=>path.join('dist',name)),...fs.readdirSync('scripts/fixtures').filter(name=>name.endsWith('.html')).map(name=>path.join('scripts/fixtures',name))]){
  const linked=[...fs.readFileSync(file,'utf8').matchAll(/<link[^>]+href="([^"?]+\.css)/g)].map(match=>path.basename(match[1]));
  if(!linked.includes(tokenSheet))for(const name of linked)if(!held.has(name))held.set(name,`linked by ${file} without ${tokenSheet}`);
}
const dir='dist',tokenCss=fs.readFileSync(path.join(dir,tokenSheet),'utf8');

// Tokens are read from the stylesheet, so it stays the only place a value is written.
const primitives=[...tokenCss.matchAll(/--([a-z]+(?:-[a-z]+)?-\d+):(#[0-9a-f]{6,8})(?=[;}])/g)].map(([,name,hex])=>{const color=parseHex(hex);return{name,hex,color,lab:oklab(color)}});
const opaque=primitives.filter(token=>token.color.a===1),veils=primitives.filter(token=>token.color.a<1);
const backdrops=['ash-2','ash-7'].map(name=>opaque.find(token=>token.name===name).color);
const lengths=prefix=>[...tokenCss.matchAll(new RegExp(`--(${prefix}-[a-z0-9]+):(\\d*\\.?\\d+)(px|s)(?=[;}])`,'g'))].map(([,name,number])=>({name,value:+number}));
const radii=lengths('radius').filter(token=>token.name!=='radius-full').sort((a,b)=>a.value-b.value),motion=lengths('motion').sort((a,b)=>a.value-b.value),text=lengths('text').sort((a,b)=>a.value-b.value);
const sameFamily=(x,y)=>chroma(x)>.03&&chroma(y)>.03&&Math.min(Math.abs(hue(x)-hue(y)),360-Math.abs(hue(x)-hue(y)))<25;

const colorCache=new Map();
function snapColor(literal){
  const key=normalizeColor(literal);if(colorCache.has(key))return colorCache.get(key);
  if(!key.startsWith('#')){colorCache.set(key,null);return null}
  const color=parseHex(key);let result=null;
  if(color.a>=.9){
    const lab=oklab(color);let best=null;
    for(const token of opaque){const d=distance(lab,token.lab);if(!best||d<best.d)best={d,token}}
    if(best.d<=.035||(best.d<=.06&&sameFamily(lab,best.token.lab)))result={name:best.token.name,shift:best.d};
  }else{
    const lab=oklab(color),hued=chroma(lab)>.03;
    const pick=allowed=>{
      let best=null;
      for(const token of veils){
        if(!allowed(token))continue;
        const d=Math.max(...backdrops.map(base=>distance(oklab(over(color,base)),oklab(over(token.color,base))))),gap=Math.abs(color.a-token.color.a),score=d+.15*gap;
        if(!best||score<best.score)best={score,d,gap,token};
      }
      return best&&best.d<=.04&&best.gap<=.12?best:null;
    };
    // A hued overlay keeps its hue when a veil of that hue fits; otherwise it may become a neutral tint or shade, never another hue.
    const best=(hued&&pick(token=>sameFamily(lab,token.lab)))||pick(token=>chroma(token.lab)<=.03);
    if(best)result={name:best.token.name,shift:best.d};
  }
  colorCache.set(key,result);return result;
}
const nearest=(list,value)=>list.reduce((best,token)=>Math.abs(token.value-value)<Math.abs(best.value-value)-1e-9?token:best);
function snapRadius(px){
  if(px===0)return null;if(px>=99)return'radius-full';
  // Ties resolve toward the smaller radius: crisper corners, and concentric shapes stay nested.
  const token=nearest(radii,px);return Math.abs(token.value-px)<=Math.max(2,px*.15)?token.name:null;
}
function snapDuration(seconds){if(seconds<=0||seconds>.36)return null;return nearest(motion,seconds).name}
function snapText(px){
  if(px<=0)return null;if(px<textFloor)return text[0].name;if(px>text.at(-1).value*1.15)return null;
  const token=nearest(text,px);return Math.abs(token.value-px)<=2?token.name:null;
}

const report={files:0,changed:0,colors:0,radii:0,motion:0,type:0,kept:new Map(),shifts:[]};
function rewrite(declaration){
  let {property,value}=declaration;const original=value;
  const important=/\s*!important$/.exec(value)?.[0]||'';if(important)value=value.slice(0,-important.length);
  const eachPlain=(source,replacer)=>{let out='',last=0;for(const [a,b] of plainSpans(source)){out+=source.slice(last,a)+replacer(source.slice(a,b));last=b}return out+source.slice(last)};
  if(kinds.has('colors'))value=eachPlain(value,part=>part.replace(colorPattern,match=>{
    const snapped=snapColor(match);
    if(!snapped){const key=normalizeColor(match);report.kept.set(key,(report.kept.get(key)||0)+1);return match}
    report.colors++;report.shifts.push(snapped.shift);return`var(--${snapped.name})`;
  }));
  if(kinds.has('radii')&&/^border(-(top|bottom)-(left|right))?-radius$/.test(property)&&!/calc\(|clamp\(|min\(|max\(/.test(value))
    value=value.replace(/(?<![\w.(-])(\d*\.?\d+)px\b/g,(match,number)=>{const name=snapRadius(+number);if(!name)return match;report.radii++;return`var(--${name})`});
  if(kinds.has('motion')&&/^(transition|animation)(-duration)?$/.test(property))
    value=value.split(',').map(part=>{let first=true;return part.replace(/(?<![\w.(-])(\d*\.?\d+)(ms|s)\b/g,(match,number,unit)=>{if(!first)return match;first=false;const name=snapDuration(unit==='ms'?number/1000:+number);if(!name)return match;report.motion++;return`var(--${name})`})}).join(',');
  if(kinds.has('type')&&property==='font-size')
    value=value.replace(/^(\d*\.?\d+)px$/,(match,number)=>{const name=snapText(+number);if(!name)return match;report.type++;return`var(--${name})`});
  if(kinds.has('type')&&property==='font')
    value=value.replace(/(^|\s)(\d*\.?\d+)px(?=\s*\/|\s)/,(match,lead,number)=>{const name=snapText(+number);if(!name)return match;report.type++;return`${lead}var(--${name})`});
  value+=important;return value===original?null:value;
}

const changedFiles=[];
for(const {name,css} of authoredSheets(dir)){
  if(name===tokenSheet||held.has(name)||(files.length&&!files.includes(name)))continue;
  report.files++;let out=css,edits=0;
  for(const declaration of scanDeclarations(css).reverse()){
    const value=rewrite(declaration);if(value===null)continue;
    out=out.slice(0,declaration.start)+value+out.slice(declaration.end);edits++;
  }
  if(!edits)continue;
  report.changed++;changedFiles.push(name);if(verbose)console.log(`${name}: ${edits} declarations`);
  if(apply)fs.writeFileSync(path.join(dir,name),out);
}
if(apply){
  // Keep the loader's content hashes exact for every stylesheet this run rewrote.
  let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  for(const name of [...changedFiles,tokenSheet]){
    const hash=createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex').slice(0,12);
    html=html.replace(new RegExp(`(href="${name.replace(/[.]/g,'\\.')}\\?v=)[0-9a-f]{8,64}"`,'g'),`$1${hash}"`);
  }
  fs.writeFileSync(path.join(dir,'index.html'),html);
}
const shifts=report.shifts.sort((a,b)=>a-b),at=q=>shifts.length?shifts[Math.min(shifts.length-1,Math.floor(shifts.length*q))].toFixed(3):'n/a';
if(verbose)for(const [name,reason] of held)console.log(`held ${name}: ${reason}`);
console.log(`${apply?'Applied':'Would apply'}: ${report.colors} colors, ${report.radii} radii, ${report.motion} durations, ${report.type} text sizes across ${report.changed} of ${report.files} stylesheets.`);
if(kinds.has('colors'))console.log(`Color shift (OKLab distance) median ${at(.5)}, 95th percentile ${at(.95)}, largest ${at(1)}. ${report.kept.size} distinct literals kept (${[...report.kept.values()].reduce((sum,n)=>sum+n,0)} uses) because no token is close enough.`);
if(verbose&&report.kept.size)console.log([...report.kept].sort((a,b)=>b[1]-a[1]).map(([key,count])=>`${key}×${count}`).join(' '));
