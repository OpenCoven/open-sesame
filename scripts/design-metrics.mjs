// Static measurements of the authored cascade. Dependency-free; shared by the budget check and the token tools.
import fs from 'node:fs';
import path from 'node:path';

export const tokenSheet='design-tokens.css';
export const textFloor=11;

export function authoredSheets(dir='dist'){
  return fs.readdirSync(dir).filter(name=>name.endsWith('.css')).sort().map(name=>({name,css:fs.readFileSync(path.join(dir,name),'utf8')}));
}

export const stripComments=css=>css.replace(/\/\*[\s\S]*?\*\//g,'');

// Every declaration in innermost blocks as {property,value,start,end}; start/end index the value in the source.
// Comments, strings and url() contents never start a block or end a declaration.
export function scanDeclarations(css){
  const found=[],stack=[];let i=0,blockHasChild=false;
  const skipString=quote=>{i++;while(i<css.length&&css[i]!==quote){if(css[i]==='\\')i++;i++}};
  while(i<css.length){
    const c=css[i];
    if(c==='/'&&css[i+1]==='*'){const end=css.indexOf('*/',i+2);i=end<0?css.length:end+2;continue}
    if(c==='"'||c==="'"){skipString(c);i++;continue}
    if(c==='('){let depth=1;i++;while(i<css.length&&depth){if(css[i]==='"'||css[i]==="'")skipString(css[i]);else if(css[i]==='(')depth++;else if(css[i]===')')depth--;i++}continue}
    if(c==='{'){stack.push({open:i+1,child:false});if(stack.length>1)stack[stack.length-2].child=true;i++;continue}
    if(c==='}'){const block=stack.pop();if(block&&!block.child)collect(block.open,i);i++;continue}
    i++;
  }
  function collect(from,to){
    let at=from,depth=0,begin=from;
    const flush=end=>{
      const text=css.slice(begin,end),colon=topLevelColon(text);
      if(colon>0){const property=text.slice(0,colon).replace(/\/\*[\s\S]*?\*\//g,'').trim().toLowerCase();const raw=text.slice(colon+1),lead=raw.length-raw.trimStart().length;found.push({property,value:raw.trim(),start:begin+colon+1+lead,end:begin+colon+1+lead+raw.trim().length})}
      begin=end+1;
    };
    while(at<to){
      const c=css[at];
      if(c==='/'&&css[at+1]==='*'){const end=css.indexOf('*/',at+2);at=end<0?to:end+2;continue}
      if(c==='"'||c==="'"){at++;while(at<to&&css[at]!==c){if(css[at]==='\\')at++;at++}at++;continue}
      if(c==='(')depth++;else if(c===')')depth--;else if(c===';'&&depth<=0)flush(at);
      at++;
    }
    flush(to);
  }
  function topLevelColon(text){let depth=0;for(let k=0;k<text.length;k++){const c=text[k];if(c==='/'&&text[k+1]==='*'){const end=text.indexOf('*/',k+2);k=end<0?text.length:end+1;continue}if(c==='(')depth++;else if(c===')')depth--;else if(c===':'&&depth<=0)return k}return -1}
  return found;
}
export const declarations=scanDeclarations;

// The parts of a value where a literal may be replaced: outside strings and url().
export function plainSpans(value){
  const spans=[];let begin=0,i=0;
  while(i<value.length){
    const c=value[i];
    if(c==='"'||c==="'"){spans.push([begin,i]);i++;while(i<value.length&&value[i]!==c){if(value[i]==='\\')i++;i++}i++;begin=i;continue}
    if(value.startsWith('url(',i)){spans.push([begin,i]);let depth=0;do{if(value[i]==='(')depth++;else if(value[i]===')')depth--;i++}while(i<value.length&&depth);begin=i;continue}
    i++;
  }
  spans.push([begin,value.length]);return spans.filter(([a,b])=>b>a);
}
export const plainText=value=>plainSpans(value).map(([a,b])=>value.slice(a,b)).join(' ');

export const colorPattern=/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|\b(?:rgb|rgba|hsl|hsla)\([^()]*\)/g;
export function normalizeColor(text){
  let value=text.toLowerCase().replace(/\s+/g,'');
  if(/^#[0-9a-f]{3,4}$/.test(value))value='#'+[...value.slice(1)].map(c=>c+c).join('');
  if(/^#[0-9a-f]{8}$/.test(value)&&value.endsWith('ff'))value=value.slice(0,7);
  return value;
}
const pixels=value=>{const sizes=[];for(const [,number,unit] of value.matchAll(/(?<![\w.-])(\d*\.?\d+)(px|rem|em)\b/g))sizes.push({number:+number,unit});return sizes};

// The size a font shorthand sets is the first length before an optional /line-height.
export function fontSizeOf({property,value}){
  if(property==='font-size')return value.replace(/\s*!important$/,'');
  if(property!=='font')return null;
  const match=value.match(/(?:^|\s)(\d*\.?\d+(?:px|rem|em|%))(?=\s*\/|\s)/);return match?match[1]:null;
}

export function measure(dir='dist'){
  const sheets=authoredSheets(dir),html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const colors=new Map(),sizes=new Map(),radii=new Map(),durations=new Map();
  let important=0,colorLiterals=0,belowFloor=0,cssBytes=0,declarationCount=0;
  const bump=(map,key)=>map.set(key,(map.get(key)||0)+1);
  for(const {name,css} of sheets){
    cssBytes+=Buffer.byteLength(css);
    for(const declaration of declarations(css)){
      declarationCount++;
      if(/!important$/.test(declaration.value))important++;
      const definesToken=name===tokenSheet&&declaration.property.startsWith('--');
      if(!definesToken)for(const match of plainText(declaration.value).match(colorPattern)||[]){colorLiterals++;bump(colors,normalizeColor(match))}
      const size=fontSizeOf(declaration);
      if(size&&!definesToken&&!size.includes('var(')){bump(sizes,size);const [first]=pixels(size);if(first&&first.unit==='px'&&first.number<textFloor)belowFloor++}
      if(!definesToken&&/^border(-(top|bottom)-(left|right))?-radius$/.test(declaration.property)){const value=declaration.value.replace(/\s*!important$/,'');if(!/^var\([^()]*\)$/.test(value))bump(radii,value)}
      if(!definesToken&&/^(transition|animation)(-duration)?$/.test(declaration.property))for(const [,time] of declaration.value.matchAll(/(?<![\w.-])(\d*\.?\d+m?s)\b/g))bump(durations,time);
    }
  }
  // :has() anchored on the document or widget root makes WebKit restyle the whole widget on unrelated mutations.
  let hasSelectors=0,rootHasSelectors=0;
  for(const {css} of sheets)for(const [,selectors] of stripComments(css).matchAll(/(?:^|[{}])([^{}]*:has\([^{}]*)\{/g))for(const selector of selectors.split(/,(?![^()]*\))/)){
    if(!selector.includes(':has('))continue;hasSelectors++;
    if(/^\s*(?:\.[\w-]+(?::not\([^()]*\))*\s+)?(?:html|body|:root|#widget-anchor|#widget-panel)[^\s>+~]*:has\(/.test(selector)||/^\s*(?:html|body|:root|#widget-anchor|#widget-panel)(?:[.#:\[][^\s>+~]*)?:has\(/.test(selector))rootHasSelectors++;
  }
  const scripts=fs.readdirSync(dir).filter(name=>name.endsWith('.js'));
  return{
    totals:{
      stylesheetsLinked:(html.match(/<link[^>]+rel="stylesheet"/g)||[]).length,
      scriptsLinked:(html.match(/<script[^>]+src=/g)||[]).length,
      cssBytes,jsBytes:scripts.reduce((sum,name)=>sum+fs.statSync(path.join(dir,name)).size,0),htmlBytes:Buffer.byteLength(html),
      declarations:declarationCount,important,colorLiterals,distinctColors:colors.size,distinctFontSizes:sizes.size,fontSizesBelowFloor:belowFloor,distinctRadii:radii.size,distinctDurations:durations.size,hasSelectors,rootHasSelectors,
    },
    colors,sizes,radii,durations,
  };
}
