// Remove declarations that can never apply: an identical selector, later in load order and in the same or no
// conditional context, sets the same property with at least the same importance. Same selector means same
// specificity and same elements, so the later declaration always wins. Nothing else is inferred.
// Usage: node scripts/design-cascade.mjs [--apply] [--verbose] [--identical-only]
import fs from 'node:fs';
import path from 'node:path';
import {stripComments} from './design-metrics.mjs';
import {idAncestry,idTags} from './design-dom.mjs';
import {specificity,compare,expandIs,coveredBy} from './design-selectors.mjs';

const args=process.argv.slice(2),apply=args.includes('--apply'),verbose=args.includes('--verbose'),dir='dist';
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
// Load order is the order of local stylesheet links; later wins.
const order=[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"?]+\.css)(?:\?[^"]*)?"/g)].map(match=>match[1]).filter(name=>!name.includes('/')&&fs.existsSync(path.join(dir,name)));
// Sheets whose values belong to another owner are neither edited nor used as evidence against other sheets' rules.
const held=new Set(['mobile-shell.css']);
// Other pages link subsets of these sheets (sign-in, the Reader review fixtures). A later declaration only proves an
// earlier one dead if every page that links the earlier sheet also links the later sheet after it.
const pages=[...fs.readdirSync(dir).filter(name=>name.endsWith('.html')).map(name=>path.join(dir,name)),...fs.readdirSync('scripts/fixtures').filter(name=>name.endsWith('.html')).map(name=>path.join('scripts/fixtures',name))]
  .map(file=>[...fs.readFileSync(file,'utf8').matchAll(/<link[^>]+href="([^"?]+\.css)/g)].map(match=>match[1])).map(list=>list.filter(href=>!href.includes('vendor/')).map(href=>path.basename(href)));
const provesDead=(earlier,later)=>earlier===later||pages.every(list=>{const a=list.indexOf(earlier);return a<0||list.indexOf(later)>a});
// A leading `#ancestor ` adds specificity without changing what a selector matches when the next compound names an element
// that index.html always nests inside that ancestor. Such selectors are one equivalence class; within it the member with
// more stripped prefixes is more specific and wins regardless of order. This holds only in index.html's document, so it is
// used only for stylesheets no other page links, and the pairs relied on are written to scripts/design-ancestry.json for
// the rendered baseline to verify on every surface and state.
const ancestry=idAncestry(path.join(dir,'index.html')),tags=idTags(path.join(dir,'index.html')),usedPairs=new Set(),usedTags=new Set();
const indexOnly=file=>pages.filter(list=>list.includes(file)).length===1;
function topLevelSpace(text){let depth=0;for(let k=0;k<text.length;k++){const c=text[k];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(c===' '&&depth===0)return k}return -1}
function firstCompoundId(text){let depth=0,end=text.length;for(let k=0;k<text.length;k++){const c=text[k];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(depth===0&&(c===' '||c==='>'||c==='+'||c==='~')){end=k;break}}
  const compound=text.slice(0,end).replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g,'').replace(/\[[^\]]*\]/g,''),id=/#([\w-]+)/.exec(compound);
  return id?{ancestors:ancestry.get(id[1]),label:id[1]}:null}
function canonical(selector){
  let rest=selector,stripped=0;const pairs=[];
  for(;;){
    const space=topLevelSpace(rest);if(space<0)break;
    const prefix=/^#([\w-]+)$/.exec(rest.slice(0,space));if(!prefix)break;
    const inner=firstCompoundId(rest.slice(space+1));if(!inner||!inner.ancestors?.includes(prefix[1]))break;
    pairs.push(prefix[1]+' '+inner.label);rest=rest.slice(space+1);stripped++;
  }
  // `button#save` matches what `#save` matches when index.html makes that id a button, so the type is dropped too.
  const facts=[];
  rest=rest.replace(/(^|[\s>+~])([a-z][\w-]*)#([\w-]+)/g,(match,lead,type,id)=>{if(tags.get(id)!==type)return match;facts.push(type+' '+id);stripped++;return lead+'#'+id});
  return{key:rest,stripped,pairs,facts};
}

// Walk a stylesheet into style rules with their at-rule context and the source span of each declaration.
function parse(css,file){
  const rules=[];let i=0;const context=[];
  const skipString=quote=>{i++;while(i<css.length&&css[i]!==quote){if(css[i]==='\\')i++;i++}i++};
  const readPrelude=()=>{const start=i;let depth=0;while(i<css.length){const c=css[i];if(c==='/'&&css[i+1]==='*'){i=css.indexOf('*/',i+2)+2;if(i<2)i=css.length;continue}if(c==='"'||c==="'"){skipString(c);continue}if(c==='(')depth++;else if(c===')')depth--;else if(depth<=0&&(c==='{'||c==='}'||c===';'))break;i++}return css.slice(start,i)};
  const walk=()=>{
    while(i<css.length){
      const ruleStart=i,prelude=readPrelude(),stop=css[i];
      if(stop===undefined)return;
      if(stop==='}'){i++;return}
      if(stop===';'){i++;continue}
      i++;const head=stripComments(prelude).trim();
      if(head.startsWith('@')){
        // Conditional group rules nest style rules; other at-rules (keyframes, font-face, property) are skipped whole.
        if(/^@(media|supports|container|layer)\b/.test(head)){context.push(head.replace(/\s+/g,' '));walk();context.pop()}
        else{let depth=1;while(i<css.length&&depth){const c=css[i];if(c==='"'||c==="'"){skipString(c);continue}if(c==='{')depth++;else if(c==='}')depth--;i++}}
        continue;
      }
      const bodyStart=i;let depth=0,nested=false;
      while(i<css.length){const c=css[i];if(c==='/'&&css[i+1]==='*'){i=css.indexOf('*/',i+2)+2;if(i<2)i=css.length;continue}if(c==='"'||c==="'"){skipString(c);continue}if(c==='(')depth++;else if(c===')')depth--;else if(c==='{'){nested=true}else if(c==='}'&&depth<=0)break;i++}
      const bodyEnd=i;i++;
      if(nested)continue;
      const selectors=head.split(/,(?![^()\[\]]*[)\]])/).map(text=>text.trim().replace(/\s+/g,' ').replace(/\s*([>+~])\s*/g,'$1')).filter(Boolean);
      rules.push({file,context:context.join(' && '),selectors,start:ruleStart,end:i,empty:!css.slice(bodyStart,bodyEnd).replace(/[\s;]/g,''),declarations:declarations(css,bodyStart,bodyEnd)});
    }
  };
  walk();return rules;
}
function declarations(css,from,to){
  const found=[];let at=from,depth=0,begin=from;
  const flush=end=>{
    const text=css.slice(begin,end),clean=stripComments(text);let colon=-1,level=0;
    for(let k=0;k<clean.length;k++){const c=clean[k];if(c==='(')level++;else if(c===')')level--;else if(c===':'&&level<=0){colon=k;break}}
    if(colon>0&&clean===text){const property=text.slice(0,colon).trim().toLowerCase(),value=text.slice(colon+1).trim();if(property)found.push({property,value,important:/!important$/.test(value),start:begin,end:css[end]===';'?end+1:end})}
    begin=end+1;
  };
  while(at<to){const c=css[at];if(c==='/'&&css[at+1]==='*'){at=css.indexOf('*/',at+2)+2;continue}if(c==='"'||c==="'"){at++;while(at<to&&css[at]!==c){if(css[at]==='\\')at++;at++}at++;continue}if(c==='(')depth++;else if(c===')')depth--;else if(c===';'&&depth<=0)flush(at);at++}
  flush(to);return found;
}

const sources=new Map(order.map(name=>[name,fs.readFileSync(path.join(dir,name),'utf8')]));
const rules=order.flatMap(name=>parse(sources.get(name),name));
rules.forEach((rule,index)=>{rule.index=index;
  // A property declared twice in one rule is a deliberate fallback pair; leave such rules' copies of it alone.
  const seen=new Map();for(const declaration of rule.declarations)seen.set(declaration.property,(seen.get(declaration.property)||0)+1);
  rule.repeated=new Set([...seen].filter(([,count])=>count>1).map(([property])=>property));
});
// A later value an engine might reject would leave the earlier declaration as the live fallback, so it proves nothing.
const uncertain=/color-mix\(|light-dark\(|\b\d*\.?\d+(?:dvh|svh|lvh|dvw|svw|lvw)\b|-webkit-|-moz-|env\(|anchor\(|round\(|image-set\(/;
// For each selector, context and property: every rule that declares it, in order.
const winners=new Map();
// Each selector is expanded into the alternatives its :is() lists stand for, then reduced to canonical text. Selectors
// with the same canonical text match the same elements, so the cascade between them is decided by importance, then the
// specificity of the selector as written, then order.
const forms=selector=>expandIs(selector).map(branch=>canonical(branch));
// The id named by a selector's last compound, when that compound selects the element itself. Such a selector matches at
// most that one element, so a rule for the bare id that outranks it decides the property wherever it would apply.
function subjectId(key){
  let depth=0,start=0;for(let k=0;k<key.length;k++){const c=key[k];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(depth===0&&(c===' '||c==='>'||c==='+'||c==='~'))start=k+1}
  const compound=key.slice(start);if(/::|:(before|after|first-line|first-letter|placeholder|selection|marker)\b/.test(compound))return null;
  const id=/#([\w-]+)/.exec(compound.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g,'').replace(/\[[^\]]*\]/g,''));return id?id[1]:null;
}
for(const rule of rules){
  if(held.has(rule.file))continue;
  for(const selector of rule.selectors){
    const weight=specificity(selector);
    for(const form of forms(selector))for(const declaration of rule.declarations){
      const key=form.key+'\u0000'+declaration.property;if(!winners.has(key))winners.set(key,[]);
      winners.get(key).push({index:rule.index,file:rule.file,selector,weight,stripped:form.stripped,pairs:form.pairs,facts:form.facts,context:rule.context,important:declaration.important,repeated:rule.repeated.has(declaration.property),uncertain:uncertain.test(declaration.value)});
    }
  }
}
const edits=new Map(),prefixProofs=!args.includes('--identical-only'),expansionProofs=!args.includes('--identical-only');let dead=0,bytes=0,removedRules=0,byPrefix=0,byExpansion=0;const perFile=new Map();
for(const rule of rules){
  if(held.has(rule.file))continue;
  for(const declaration of rule.declarations){
    if(declaration.property.startsWith('--')||rule.repeated.has(declaration.property))continue;
    // Dead only if every selector of this rule is overridden later, unconditionally or in this same context.
    const linkedWith=(file,other)=>file===other||pages.every(list=>!list.includes(file)||list.includes(other));
    let viaNesting=false,viaExpansion=false,viaSubject=false,proven=true;const pairs=[],facts=[];
    for(const selector of rule.selectors){
      const weight=specificity(selector);
      for(const form of forms(selector)){
        // The same property, or any shorthand that resets it.
        const properties=[declaration.property,...coveredBy(declaration.property)],rivals=properties.flatMap(property=>winners.get(form.key+'\u0000'+property)||[]);
        const subject=subjectId(form.key),narrower=subject&&form.key!=='#'+subject;
        let proof=rivals.find(other=>{
          if(other.index===rule.index||other.repeated||other.uncertain||!(other.context===rule.context||other.context===''))return false;
          if(declaration.important&&!other.important)return false;
          const outranks=other.important&&!declaration.important,order=compare(other.weight,weight),wins=outranks||order>0||(order===0&&other.index>rule.index);
          if(!wins)return false;
          // Stripped prefixes make the equivalence a fact about index.html; without them it is plain CSS and holds anywhere.
          if(other.stripped||form.stripped)return prefixProofs&&indexOnly(rule.file);
          if(other.selector!==selector&&!expansionProofs)return false;
          return outranks||order>0?linkedWith(rule.file,other.file):provesDead(rule.file,other.file);
        });
        if(!proof&&narrower&&prefixProofs&&indexOnly(rule.file)){
          proof=properties.flatMap(property=>winners.get('#'+subject+'\u0000'+property)||[]).find(other=>{
            if(other.index===rule.index||other.repeated||other.uncertain||!(other.context===rule.context||other.context===''))return false;
            if(declaration.important&&!other.important)return false;
            const order=compare(other.weight,weight);return(other.important&&!declaration.important)||order>0||(order===0&&other.index>rule.index);
          });
          if(proof){viaSubject=true;viaNesting=true;pairs.push(...proof.pairs);facts.push(...proof.facts,'* '+subject);continue}
        }
        if(!proof){proven=false;break}
        if(proof.stripped||form.stripped){viaNesting=true;pairs.push(...form.pairs,...proof.pairs);facts.push(...form.facts,...proof.facts)}else if(proof.selector!==selector)viaExpansion=true;
      }
      if(!proven)break;
    }
    if(!proven)continue;
    if(viaNesting){byPrefix++;for(const pair of pairs)usedPairs.add(pair);for(const fact of facts)usedTags.add(fact)}else if(viaExpansion)byExpansion++;
    if(args.includes('--explain'))console.log(`${rule.file}  ${rule.selectors.join(', ').slice(0,110)}  {${declaration.property}}  ${viaSubject?'subject':viaNesting?'nesting':viaExpansion?'expansion':'identical'}`);
    dead++;bytes+=declaration.end-declaration.start;perFile.set(rule.file,(perFile.get(rule.file)||0)+1);
    if(!edits.has(rule.file))edits.set(rule.file,[]);edits.get(rule.file).push(declaration);
  }
}
const total=rules.reduce((sum,rule)=>sum+rule.declarations.length,0);
console.log(`${rules.length} style rules, ${total} declarations in ${order.length} linked stylesheets. ${dead} declarations (${(100*dead/total).toFixed(1)}%, ${bytes} bytes) can never apply${apply?' and were removed':''}: ${dead-byPrefix-byExpansion} are overridden by an identical selector, ${byExpansion} by a selector whose :is() list includes it, ${byPrefix} by the same selector under an ancestor it always has.`);
if(verbose)console.log([...perFile].sort((a,b)=>b[1]-a[1]).map(([file,count])=>`${file} ${count}`).join(', '));
if(apply){
  // The nesting facts every removal so far has relied on; the rendered baseline verifies them on every surface and state.
  const ancestryFile='scripts/design-ancestry.json',recorded=fs.existsSync(ancestryFile)?JSON.parse(fs.readFileSync(ancestryFile,'utf8')):{},known=recorded.pairs||[],knownTags=recorded.tags||[];
  fs.writeFileSync(ancestryFile,JSON.stringify({note:'Each entry is "ancestor descendant": element ids that index.html nests, relied on by scripts/design-cascade.mjs to remove declarations. Each tag entry is "tag id": the element type index.html gives that id. scripts/review-design-baseline.mjs fails if a descendant is ever rendered outside its ancestor or an id is rendered on another element type.',pairs:[...new Set([...known,...usedPairs])].sort(),tags:[...new Set([...knownTags,...usedTags])].sort()},null,2)+'\n');
  for(const [file,list] of edits){
    let css=sources.get(file);for(const declaration of list.sort((a,b)=>b.start-a.start))css=css.slice(0,declaration.start)+css.slice(declaration.end);
    // A rule left with no declarations is removed too; its leading whitespace stays so neighbouring rules keep their lines.
    let emptied=0;for(const rule of parse(css,file).filter(rule=>rule.empty).sort((a,b)=>b.start-a.start)){const lead=css.slice(rule.start,rule.end).match(/^\s*/)[0].length;css=css.slice(0,rule.start+lead)+css.slice(rule.end);emptied++}
    removedRules+=emptied;fs.writeFileSync(path.join(dir,file),css);
  }
  console.log(`${removedRules} rules left empty were removed.`);
  console.log('Run scripts/refresh-asset-cache.mjs, npm run check and the rendered baseline with --strict before keeping this.');
}
