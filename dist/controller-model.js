'use strict';
(()=>{
  function parse(raw){
    const text=String(raw||'').trim().replace(/^(?:open\s+sesame|perch)\b\s*:?\s*/i,'');if(!text||text.length>2000)throw Error('Send a command under 2,000 characters.');
    let m;if(/^(help|status|feeds)$/i.test(text))return {action:text.toLowerCase()};
    if(m=text.match(/^feed\s+(add|site|follow)\s+(\S+)$/i))return {action:'feed.add',site:m[1].toLowerCase()!=='follow',url:m[2]};
    if(m=text.match(/^feed\s+(pause|resume|refresh)\s+(.+)$/i))return {action:'feed.'+m[1].toLowerCase(),name:m[2].trim()};
    if(m=text.match(/^open\s+(focus|library|console|reader|live|lockin|items|agents|reading)$/i))return {action:'open',tab:({focus:'focus',library:'items',console:'agents',reader:'reading',live:'audio'})[m[1].toLowerCase()]||m[1].toLowerCase()};
    if(m=text.match(/^size\s+(small|medium|large|max|full)$/i))return {action:'size',size:m[1].toLowerCase()};
    if(m=text.match(/^focus\s+(15|20|25|30|45|60|90|pause)$/i))return {action:'focus',value:m[1].toLowerCase()};
    if(m=text.match(/^(note|task|bookmark)\s+([\s\S]+)$/i))return {action:'capture',kind:m[1].toLowerCase(),text:m[2]};
    throw Error('Try: feed add example.com/blog · feeds · feed pause <name> · note <text> · focus 25 · open reading · size large');
  }
  window.OpenSesameControllerModel={parse};
})();
