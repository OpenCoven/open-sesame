'use strict';
(()=>{
  function normalize(value){
    let text=String(value||'').trim().replace(/^[<"'([{]+/,'').replace(/[>"',;.!\]}]+$/,'');
    while(text.endsWith(')')&&(text.match(/\)/g)||[]).length>(text.match(/\(/g)||[]).length)text=text.slice(0,-1);
    return canonical(text);
  }
  function canonical(value){
    const text=String(value||'').trim();if(!text||/[\s<>"'\\]/.test(text))return '';
    const explicit=/^https?:\/\//i.test(text),port=/^(?:localhost|[\w-]+(?:\.[\w-]+)+):\d+(?:[/?#]|$)/i.test(text);
    if(!explicit&&!port&&/^[a-z][\w+.-]*:/i.test(text))return '';
    try{const u=new URL(explicit?text:text.startsWith('//')?'https:'+text:'https://'+text),host=u.hostname;
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';
      if(host!=='localhost'&&!host.startsWith('[')&&(!host.includes('.')||host.split('.').some(s=>!s||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(s))))return '';
      return u.href;
    }catch{return ''}
  }
  function identity(value){
    const normalized=canonical(value);if(!normalized)return '';
    const url=new URL(normalized);
    for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||/^(fbclid|gclid|dclid|msclkid)$/i.test(key))url.searchParams.delete(key);
    return url.href;
  }
  function duplicate(items,url,projectId='',excludeId=''){
    const key=identity(url);return key?items.find(n=>n.id!==excludeId&&(n.kind==='bookmark'||!n.kind&&n.url)&&(n.projectId||'')===(projectId||'')&&identity(n.url)===key):undefined;
  }
  function parse(raw){
    if(String(raw).length>20000)return {urls:[],found:0,duplicates:0,skipped:0,attempts:0,error:'Paste up to 20,000 characters at a time.'};
    const text=String(raw).replace(/\[[^\]\n]*\]\((https?:\/\/[^\s]+)\)/gi,' $1 ');
    // A comma inside a path/query is preserved unless it introduces another address.
    const tokens=text.split(/[\s\u200b-\u200d\ufeff|]+|[,;](?=(?:https?:\/\/|\/\/|localhost(?::\d+)?(?:[/?#]|$)|(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?(?:[/?#]|[,;\s]|$)))/i).filter(Boolean);
    const urls=[],seen=new Set();let found=0,skipped=0,attempts=0;
    for(const token of tokens){if(/^[-*•–—]+$|^\d+[.)]$/.test(token))continue;const url=normalize(token);if(url){attempts++;found++;const key=identity(url);if(!seen.has(key)){urls.push(url);seen.add(key)}}else{skipped++;if(/^(?:[<("']*)(?:[a-z][\w+.-]*:\/\/|www\.|[\w-]+\.[\w-]+)/i.test(token))attempts++}}
    return {urls,found,duplicates:found-urls.length,skipped,attempts,error:''};
  }
  function exportUrls(items,scope='all'){
    const seen=new Set(),urls=[];
    for(const item of items){if(item.kind!=='bookmark'||!(scope==='all'||(scope==='inbox'?!item.projectId:item.projectId===scope)))continue;const url=canonical(item.url),key=identity(url);if(key&&!seen.has(key)){seen.add(key);urls.push(url)}}return urls;
  }
  function plan(urls,items,projectId=''){
    const saved=new Set(exportUrls(items,projectId||'inbox').map(identity)),fresh=[];
    for(const value of urls){const url=canonical(value),key=identity(url);if(key&&!saved.has(key)){fresh.push(url);saved.add(key)}}
    return {fresh,existing:urls.length-fresh.length};
  }
  window.OpenSesameBookmarkModel={normalize,canonical,identity,duplicate,parse,exportUrls,plan};
})();
