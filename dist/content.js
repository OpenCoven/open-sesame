'use strict';
(()=>{
  const MAX=2097152;
  async function fetchText(url){
    const target=pageUrl(url);if(!target)throw new Error('Use an HTTP or HTTPS address.');await openSesameBridge.ready;if(openSesameBridge.available)return openSesameBridge.request('reading.fetch',{url:target});
    try{const response=await fetch(target,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('Source returned HTTP '+response.status+'.');if(Number(response.headers.get('content-length'))>MAX)throw new Error('This source exceeds 2 MB.');const reader=response.body.getReader(),chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();throw new Error('This source exceeds 2 MB.')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return {text:new TextDecoder().decode(bytes),url:response.url,type:response.headers.get('content-type')||''}}catch(error){if(error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name))throw new Error('This website does not allow loading here. Open the original, or use the desktop companion.');throw error}
  }
  function clean(html,base,github=false){
    const doc=new DOMParser().parseFromString(String(html||''),'text/html');doc.querySelectorAll('script,style,iframe,object,embed,svg,math,form,button,select,textarea,nav,header,footer,aside').forEach(n=>n.remove());
    for(const input of doc.querySelectorAll('input')){if(!github||input.type!=='checkbox'){input.remove();continue}input.setAttribute('disabled','');input.setAttribute('type','checkbox')}
    for(const image of doc.querySelectorAll('img')){const raw=image.getAttribute('data-src')||image.getAttribute('data-original')||image.getAttribute('src')||'';try{const src=pageUrl(new URL(raw,base).href);if(!raw||!src){image.remove();continue}image.setAttribute('src',src);image.setAttribute('loading','lazy');image.setAttribute('referrerpolicy','no-referrer');image.setAttribute('alt',image.getAttribute('alt')||'Article image');}catch{image.remove()}image.removeAttribute('srcset');image.removeAttribute('style')}
    for(const a of doc.querySelectorAll('a')){if(github&&(a.getAttribute('href')||'').startsWith('#')){a.removeAttribute('target');continue}try{const href=pageUrl(new URL(a.getAttribute('href')||'',base).href);if(href){a.setAttribute('href',href);a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer')}else a.removeAttribute('href')}catch{a.removeAttribute('href')}}
    return DOMPurify.sanitize(doc.body.innerHTML,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:['p','br','strong','b','em','i','del','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','hr','img','figure','figcaption','table','thead','tbody','tr','td','th','sup','sub','div','span',...(github?['input','details','summary']:[])],ALLOWED_ATTR:['href','target','rel','src','alt','title','loading','referrerpolicy','colspan','rowspan',...(github?['align','width','height','type','checked','disabled','open']:[])],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
  }
  function markdown(text,base){return clean(OpenSesameMarkdown.blocksToHTML(OpenSesameMarkdown.parse(text)),base)}
  function article(html,base){const doc=new DOMParser().parseFromString(html,'text/html');const candidates=[...doc.querySelectorAll('article,main,[role="main"],.prose,.article-content,.post-content,.entry-content')].filter(n=>n.textContent.trim().length>160);const body=candidates.sort((a,b)=>b.textContent.length-a.textContent.length)[0];if(!body)throw new Error('A readable article was not found. Open the original to continue.');const fragment=clean(body.innerHTML,base);if(fragment.textContent.trim().length<160)throw new Error('This page does not expose readable article text.');return {fragment,title:doc.querySelector('meta[property="og:title"]')?.content||doc.title,author:doc.querySelector('meta[name="author"]')?.content||''}}
  function githubAsset(raw,repo,branch,path='README.md'){
    try{
      const root='https://raw.githubusercontent.com/'+repo+'/'+encodeURIComponent(branch||'HEAD')+'/';
      const folder=path.split('/').slice(0,-1).map(encodeURIComponent).join('/');
      const target=raw.startsWith('/')&&!raw.startsWith('//')?root+raw.slice(1):new URL(raw,root+(folder?folder+'/':'')).href;
      const url=new URL(target);
      if(!/^https?:$/.test(url.protocol)||url.username||url.password)return '';
      if(url.hostname==='github.com'&&/^\/[^/]+\/[^/]+\/(blob|raw)\//.test(url.pathname)){
        url.hostname='raw.githubusercontent.com';url.pathname=url.pathname.replace(/\/(blob|raw)\//,'/');url.search='';
      }
      if(/^#gh-(?:light|dark)-mode-only$/.test(url.hash))url.hash='';
      return url.href;
    }catch{return ''}
  }
  function githubMarkdown(text,repo,branch,path='README.md'){
    const folder=path.split('/').slice(0,-1).map(encodeURIComponent).join('/'),suffix=folder?folder+'/':'',rawBase='https://raw.githubusercontent.com/'+repo+'/'+encodeURIComponent(branch)+'/'+suffix,linkBase='https://github.com/'+repo+'/blob/'+encodeURIComponent(branch)+'/'+suffix;
    const doc=new DOMParser().parseFromString(OpenSesameGFM.parse(text),'text/html');
    for(const picture of doc.querySelectorAll('picture')){
      const image=picture.querySelector('img');
      const sources=[...picture.querySelectorAll('source')];
      const dark=sources.find(n=>(n.getAttribute('media')||'').includes('dark'))||sources.find(n=>!n.hasAttribute('media'));
      if(image&&dark){const src=(dark.getAttribute('srcset')||'').split(',')[0].trim().split(/\s+/)[0];if(src)image.src=src}
    }
    for(const image of doc.querySelectorAll('img')){
      const raw=image.getAttribute('src')||image.getAttribute('data-src')||'';
      if(raw.endsWith('#gh-light-mode-only')){image.remove();continue}
      const src=githubAsset(raw,repo,branch,path);if(src)image.setAttribute('src',src);else image.remove();
    }
    for(const a of doc.querySelectorAll('a[href]')){
      const href=a.getAttribute('href');if(href.startsWith('#'))continue;
      try{a.setAttribute('href',new URL(href,href.startsWith('/')?'https://github.com':linkBase).href)}catch{a.removeAttribute('href')}
    }
    const fragment=clean(doc.body.innerHTML,rawBase,true),slugs=new Map();
    for(const h of fragment.querySelectorAll('h1,h2,h3,h4,h5,h6')){const slug=h.textContent.toLowerCase().trim().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/\s/g,'-'),n=slugs.get(slug)||0;slugs.set(slug,n+1);h.id='github-heading-'+slug+(n?'-'+n:'')}
    for(const a of fragment.querySelectorAll('a[href^="#"]')){a.addEventListener('click',event=>{event.preventDefault();let slug;try{slug=decodeURIComponent(a.getAttribute('href').slice(1))}catch{return}const container=a.closest('article'),target=container&&[...container.querySelectorAll('[id]')].find(n=>n.id==='github-heading-'+slug);if(target)container.scrollTo({top:container.scrollTop+target.getBoundingClientRect().top-container.getBoundingClientRect().top,behavior:'smooth'})})}
    return fragment;
  }
  window.OpenSesameContent={fetchText,clean,markdown,githubMarkdown,githubAsset,article};
})();
