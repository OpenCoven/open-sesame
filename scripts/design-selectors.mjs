// Selector helpers for the cascade tools. Dependency-free.
export function splitTop(text,separators){
  const parts=[];let depth=0,start=0;
  for(let k=0;k<text.length;k++){const c=text[k];if(c==='('||c==='[')depth++;else if(c===')'||c===']')depth--;else if(depth===0&&separators.includes(c)){parts.push(text.slice(start,k));start=k+1}}
  parts.push(text.slice(start));return parts;
}
// Specificity as [ids, classes, types]. :is(), :not() and :has() count their most specific argument; :where() counts nothing.
export function specificity(text){
  const total=[0,0,0];let k=0;
  while(k<text.length){
    const c=text[k];
    if(c==='#'){total[0]++;k++;while(k<text.length&&/[\w-]/.test(text[k]))k++;continue}
    if(c==='.'){total[1]++;k++;while(k<text.length&&/[\w-]/.test(text[k]))k++;continue}
    if(c==='['){total[1]++;let depth=1;k++;while(k<text.length&&depth){if(text[k]==='[')depth++;else if(text[k]===']')depth--;k++}continue}
    if(c===':'){
      const element=text[k+1]===':';k+=element?2:1;const begin=k;while(k<text.length&&/[\w-]/.test(text[k]))k++;const name=text.slice(begin,k);let inner=null;
      if(text[k]==='('){let depth=1;const open=++k;while(k<text.length&&depth){if(text[k]==='(')depth++;else if(text[k]===')')depth--;k++}inner=text.slice(open,k-1)}
      if(element||['before','after','first-line','first-letter'].includes(name))total[2]++;
      else if(name==='where'){}
      else if(['is','not','has'].includes(name)&&inner!==null){const best=splitTop(inner,[',']).map(part=>specificity(part.trim())).sort(compare).pop()||[0,0,0];for(let n=0;n<3;n++)total[n]+=best[n]}
      else total[1]++;
      continue;
    }
    if(/[a-zA-Z]/.test(c)){total[2]++;while(k<text.length&&/[\w-]/.test(text[k]))k++;continue}
    k++;
  }
  return total;
}
export const compare=(x,y)=>x[0]-y[0]||x[1]-y[1]||x[2]-y[2];
// `:is(.a,.b) x` matches exactly what `.a x` and `.b x` match together, when every argument is a single compound.
// Returns the alternatives, or the selector unchanged when an argument has a combinator or there would be too many.
export function expandIs(selector,limit=48){
  let results=[selector];
  for(let guard=0;guard<6;guard++){
    const next=[];let changed=false;
    for(const text of results){
      const at=findIs(text);if(!at){next.push(text);continue}
      const args=splitTop(at.inner,[',']).map(part=>part.trim());
      if(args.some(arg=>!arg||/[\s>+~]/.test(arg.replace(/\([^()]*(\([^()]*\)[^()]*)*\)/g,'').replace(/\[[^\]]*\]/g,''))||/::/.test(arg))){next.push(text.slice(0,at.start)+'\u0001is('+at.inner+')'+text.slice(at.end));continue}
      // A type selector must lead its compound, so an argument that is one cannot be spliced in after other parts.
      const before=text.slice(0,at.start),leads=before===''||/[\s>+~]$/.test(before);
      if(args.some(arg=>/^[a-zA-Z*]/.test(arg))&&!leads){next.push(before+'\u0001is('+at.inner+')'+text.slice(at.end));continue}
      for(const arg of args)next.push(before+arg+text.slice(at.end));changed=true;
    }
    results=next;if(!changed||results.length>limit)break;
  }
  if(results.length>limit)return[selector];
  return results.map(text=>text.replace(/\u0001is\(/g,':is('));
}
function findIs(text){
  let depth=0;
  for(let k=0;k<text.length;k++){
    const c=text[k];
    if(c==='['){depth++;continue}if(c===']'){depth--;continue}
    if(depth===0&&text.startsWith(':is(',k)){let level=1,j=k+4;while(j<text.length&&level){if(text[j]==='(')level++;else if(text[j]===')')level--;j++}return{start:k,end:j,inner:text.slice(k+4,j-1)}}
    if(c==='('){let level=1;k++;while(k<text.length&&level){if(text[k]==='(')level++;else if(text[k]===')')level--;k++}k--}
  }
  return null;
}

// Shorthands and the longhands each resets. A longhand is overridden by a winning declaration of any shorthand covering it.
const sides=['top','right','bottom','left'],shorthand={
  padding:sides.map(side=>'padding-'+side),margin:sides.map(side=>'margin-'+side),inset:sides,
  border:[...sides.map(side=>'border-'+side),...sides.flatMap(side=>['width','style','color'].map(part=>`border-${side}-${part}`)),'border-width','border-style','border-color'],
  'border-width':sides.map(side=>`border-${side}-width`),'border-style':sides.map(side=>`border-${side}-style`),'border-color':sides.map(side=>`border-${side}-color`),
  'border-radius':['border-top-left-radius','border-top-right-radius','border-bottom-right-radius','border-bottom-left-radius'],
  background:['color','image','position','size','repeat','origin','clip','attachment'].map(part=>'background-'+part),
  font:['font-size','font-weight','font-family','font-style','font-variant','font-stretch','line-height'],
  gap:['row-gap','column-gap'],overflow:['overflow-x','overflow-y'],flex:['flex-grow','flex-shrink','flex-basis'],'flex-flow':['flex-direction','flex-wrap'],
  outline:['outline-width','outline-style','outline-color'],transition:['property','duration','timing-function','delay'].map(part=>'transition-'+part),
  animation:['name','duration','timing-function','delay','iteration-count','direction','fill-mode','play-state'].map(part=>'animation-'+part),
  'place-items':['align-items','justify-items'],'place-content':['align-content','justify-content'],'place-self':['align-self','justify-self'],
  'text-decoration':['line','color','style','thickness'].map(part=>'text-decoration-'+part),'list-style':['type','position','image'].map(part=>'list-style-'+part),
  'grid-template':['grid-template-rows','grid-template-columns','grid-template-areas'],'grid-row':['grid-row-start','grid-row-end'],'grid-column':['grid-column-start','grid-column-end'],
  'padding-inline':['padding-inline-start','padding-inline-end'],'padding-block':['padding-block-start','padding-block-end'],'margin-inline':['margin-inline-start','margin-inline-end'],'margin-block':['margin-block-start','margin-block-end'],
};
for(const side of sides)shorthand['border-'+side]=['width','style','color'].map(part=>`border-${side}-${part}`);
const covering=new Map();for(const [name,longhands] of Object.entries(shorthand))for(const longhand of longhands)covering.set(longhand,[...(covering.get(longhand)||[]),name]);
export const coveredBy=property=>covering.get(property)||[];
