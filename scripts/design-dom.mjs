// Static facts about dist/index.html: for each element id, the ids of its ancestors and its tag name. Dependency-free.
import fs from 'node:fs';
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function scan(file){
  const html=fs.readFileSync(file,'utf8'),stack=[],ancestry=new Map(),tags=new Map(),duplicates=new Set();let i=0;
  while(i<html.length){
    const open=html.indexOf('<',i);if(open<0)break;
    if(html.startsWith('<!--',open)){const end=html.indexOf('-->',open+4);i=end<0?html.length:end+3;continue}
    if(html[open+1]==='!'||html[open+1]==='?'){i=html.indexOf('>',open)+1||html.length;continue}
    const closing=html[open+1]==='/',nameMatch=/^[a-zA-Z][\w:-]*/.exec(html.slice(open+(closing?2:1),open+60));if(!nameMatch){i=open+1;continue}
    const name=nameMatch[0].toLowerCase();let at=open+(closing?2:1)+name.length,quote='';
    // Scan to the end of the tag, respecting quoted attribute values.
    while(at<html.length){const c=html[at];if(quote){if(c===quote)quote=''}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;at++}
    const attributes=html.slice(open+(closing?2:1)+name.length,at),selfClosed=/\/\s*$/.test(attributes);i=at+1;
    if(closing){for(let k=stack.length-1;k>=0;k--)if(stack[k].name===name){stack.length=k;break}continue}
    const id=/(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/.exec(attributes);const value=id&&(id[1]??id[2]??id[3]);
    if(value){if(ancestry.has(value))duplicates.add(value);ancestry.set(value,stack.filter(entry=>entry.id).map(entry=>entry.id));tags.set(value,name)}
    if(name==='script'||name==='style'){const end=html.toLowerCase().indexOf('</'+name,i);i=end<0?html.length:html.indexOf('>',end)+1;continue}
    if(!voids.has(name)&&!selfClosed)stack.push({name,id:value||''});
  }
  for(const id of duplicates){ancestry.delete(id);tags.delete(id)}
  return{ancestry,tags};
}
export const idAncestry=(file='dist/index.html')=>scan(file).ancestry;
export const idTags=(file='dist/index.html')=>scan(file).tags;


