'use strict';
(()=>{
  const videoId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{11}$/.test(value);
  function parseSource(raw){
    try{
      const value=raw.trim(),url=new URL(/^[a-z][a-z0-9+.-]*:/i.test(value)?value:'https://'+value);
      if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
      const host=url.hostname.toLowerCase(),parts=url.pathname.split('/').filter(Boolean);
      const hosts=['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com','youtu.be'];
      if(!hosts.includes(host))return null;
      let id='',list=url.searchParams.get('list')||'';
      if(host==='youtu.be'&&parts.length===1)id=parts[0];
      else if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
      else if(['embed','shorts','live'].includes(parts[0])&&parts.length===2)id=parts[1];
      if(!videoId(id))id='';if(!/^[A-Za-z0-9_-]{10,150}$/.test(list))list='';if(!id&&!list)return null;
      const valueStart=url.searchParams.get('start')||url.searchParams.get('t')||'',match=valueStart.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      const start=/^\d+$/.test(valueStart)?Number(valueStart):match?Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0):0;
      return {id,list,start:Math.min(86400,Math.max(0,start)),url:id?'https://www.youtube.com/watch?v='+id+(list?'&list='+list:''):'https://www.youtube.com/playlist?list='+list};
    }catch{return null}
  }
  class Queue{
    constructor(ids,saved=[]){
      const occurrences=new Map();this.original=ids.filter(videoId).map(id=>{const n=occurrences.get(id)||0;occurrences.set(id,n+1);return {id,key:id+':'+n}});
      const available=new Map(this.original.map(item=>[item.key,item]));this.entries=[];
      for(const key of Array.isArray(saved)?saved:[]){if(available.has(key)){this.entries.push(available.get(key));available.delete(key)}}
      this.entries.push(...available.values());
    }
    get ids(){return this.entries.map(item=>item.id)}
    get order(){return this.entries.map(item=>item.key)}
    get changed(){return this.order.some((key,i)=>key!==this.original[i]?.key)}
    move(key,to){const from=this.entries.findIndex(item=>item.key===key);if(from<0||!Number.isInteger(to)||to<0||to>=this.entries.length||from===to)return false;const [item]=this.entries.splice(from,1);this.entries.splice(to,0,item);return true}
    reset(){this.entries=[...this.original]}
  }
  function publicationDate(raw){
    if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(raw))return '';
    const day=raw.slice(0,10),date=new Date(day+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day&&Number.isFinite(Date.parse(raw.length===10?raw+'T00:00:00Z':raw))?day:'';
  }
  function selectEntries(entries,metadata,query='',order='queue'){
    const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),rows=entries.filter(item=>{const m=metadata.get(item.id)||{},text=[m.title,m.author,item.id,m.publishedAt].join(' ').toLocaleLowerCase();return terms.every(term=>text.includes(term))});
    if(order==='newest'||order==='oldest')return rows.map((item,index)=>({item,index,date:publicationDate(metadata.get(item.id)?.publishedAt)})).sort((a,b)=>!a.date&&!b.date?a.index-b.index:!a.date?1:!b.date?-1:(order==='newest'?b.date.localeCompare(a.date):a.date.localeCompare(b.date))||a.index-b.index).map(n=>n.item);
    return rows;
  }
  function playerObject(html){
    const marker=html.indexOf('ytInitialPlayerResponse');if(marker<0)return null;const start=html.indexOf('{',marker);if(start<0)return null;let depth=0,string=false,escape=false;
    for(let i=start;i<html.length;i++){const c=html[i];if(string){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')string=false;continue}if(c==='"')string=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(start,i+1))}catch{return null}}}return null;
  }
  function parseVideoMetadata(html,id){
    const empty={title:'',author:'',publishedAt:''};if(!videoId(id)||typeof html!=='string'||html.length>2097152)return empty;
    const data=playerObject(html),playerMatches=data?.videoDetails?.videoId===id,details=playerMatches?data.videoDetails:null,micro=playerMatches?data.microformat?.playerMicroformatRenderer:null;
    let result={title:typeof details?.title==='string'?details.title.slice(0,300):'',author:typeof details?.author==='string'?details.author.slice(0,150):'',publishedAt:publicationDate(micro?.publishDate)||publicationDate(micro?.uploadDate)};
    if(typeof DOMParser==='undefined')return result;
    const doc=new DOMParser().parseFromString(html,'text/html'),meta=selector=>doc.querySelector(selector)?.getAttribute('content')||'',identity=doc.querySelector('link[rel="canonical"]')?.getAttribute('href')||meta('meta[property="og:url"]');
    const matches=value=>{try{const u=new URL(value);return ['www.youtube.com','youtube.com','m.youtube.com'].includes(u.hostname)&&u.searchParams.get('v')===id}catch{return false}};
    if(!playerMatches&&!matches(identity))return empty;
    let video=null;for(const script of doc.querySelectorAll('script[type="application/ld+json"]')){try{const raw=JSON.parse(script.textContent),records=(Array.isArray(raw)?raw:[raw]).flatMap(n=>n?.['@graph']||[n]);video=records.find(n=>[n?.['@type']].flat().includes('VideoObject')&&(!n.embedUrl||n.embedUrl.includes('/'+id)));if(video)break}catch{}}
    result.title=result.title||meta('meta[property="og:title"]').replace(/ - YouTube$/,'').slice(0,300);result.author=result.author||(typeof video?.author?.name==='string'?video.author.name.slice(0,150):'');result.publishedAt=result.publishedAt||publicationDate(meta('meta[itemprop="datePublished"]'))||publicationDate(video?.datePublished)||publicationDate(meta('meta[itemprop="uploadDate"]'))||publicationDate(video?.uploadDate);return result;
  }
  window.OpenSesamePlaylist={Queue,parseSource,videoId,publicationDate,selectEntries,parseVideoMetadata};
})();
