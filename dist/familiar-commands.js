'use strict';
(()=>{
  const commands=[
    ['/help','Show chat commands','Chat'],['/find','Search this conversation','Chat'],['/copy','Copy this conversation as Markdown','Chat'],['/stop','Stop the current reply','Chat'],['/refresh','Reconnect and keep this persistent conversation','Chat'],
    ['/coven help','Show available Coven commands','Coven'],['/coven status','Show local Coven health and counts','Coven'],['/coven sessions','List this familiar’s workspace sessions','Coven'],['/coven familiars','Show your familiar roster','Coven'],['/coven skills','List installed Coven skills','Coven']
  ].map(([name,description,group])=>Object.freeze({name,description,group}));
  function parse(value){
    const text=value.trim();if(!text.startsWith('/')||text.startsWith('//'))return null;
    const match=commands.find(c=>text===c.name||c.name==='/find'&&text.startsWith('/find '));
    if(text==='/coven')return {name:'/coven help',args:''};
    return match?{name:match.name,args:text.slice(match.name.length).trim()}:{name:'unknown',args:text};
  }
  function suggest(value){const query=value.trimStart().toLowerCase();if(!query.startsWith('/')||query.startsWith('//')||query.includes('\n')||query.startsWith('/find '))return [];return commands.filter(c=>c.name.startsWith(query)||c.description.toLowerCase().includes(query.slice(1))).slice(0,10)}
  function markdown(result){
    if(!result||!Array.isArray(result.columns)||!Array.isArray(result.rows)||result.rows.length>50||result.columns.length>4||result.rows.some(row=>!Array.isArray(row)||row.length!==result.columns.length))throw Error('Coven returned an invalid command response.');
    const cell=value=>String(value).slice(0,160).replace(/([\\|`*_\[\]<>!])/g,'\\$1').replace(/[\r\n]+/g,' ');
    return result.rows.length?'| '+result.columns.map(cell).join(' | ')+' |\n| '+result.columns.map(()=>'---').join(' | ')+' |\n'+result.rows.map(row=>'| '+row.map(cell).join(' | ')+' |').join('\n')+(result.truncated?'\n\nShowing the first 50 results.':''):'No results for this familiar and workspace.';
  }
  window.OpenSesameFamiliarCommands=Object.freeze({commands:Object.freeze(commands),parse,suggest,markdown,help:group=>commands.filter(c=>!group||c.group===group).map(c=>'- **'+c.name+'** — '+c.description).join('\n')});
})();
