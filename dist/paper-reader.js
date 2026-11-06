'use strict';
(() => {
  const packages=['base','ams','amscd','bbox','boldsymbol','braket','bussproofs','cancel','cases','centernot','color','colortbl','configmacros','empheq','enclose','extpfeil','gensymb','mathtools','mhchem','newcommand','noerrors','noundefined','physics','upgreek','unicode','verb'];
  let engine;
  function mathEngine(){
    if(!engine)engine=new Promise((resolve,reject)=>{
      window.MathJax={startup:{typeset:false},tex:{packages,maxBuffer:16000,maxMacros:1000},svg:{fontCache:'none'},options:{enableMenu:false}};
      const tag=document.createElement('script');
      tag.src='vendor/mathjax/tex-svg-full.js';
      tag.onload=()=>window.MathJax.startup.promise.then(()=>resolve(window.MathJax),reject);
      tag.onerror=()=>reject(Error('Math renderer unavailable.'));
      document.head.append(tag);
    }).catch(error=>{engine=null;throw error});
    return engine;
  }
  function safeUrl(raw,base){
    try{const u=new URL(raw,base);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}
  }
  function latexNodes(root){
    // MathML already contains structured math. TeX is used only when that is absent.
    for(const script of root.querySelectorAll('script[type^="math/tex"]')){
      const span=document.createElement('span');span.className='paper-tex';
      span.dataset.tex=script.textContent;span.dataset.display=String(script.type.includes('mode=display'));
      script.replaceWith(span);
    }
    for(const math of root.querySelectorAll('math')){
      const source=math.getAttribute('alttext')||math.querySelector('annotation[encoding="application/x-tex"]')?.textContent||'';
      math.setAttribute('aria-label',source || math.textContent);
      math.title=source;
    }
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const texts=[];
    while(walker.nextNode()){
      const node=walker.currentNode;
      if(!node.parentElement?.closest('math,svg,pre,code,script,style,.paper-tex,.paper-code'))texts.push(node);
    }
    const re=/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$|(\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|alignat\*?)\}[\s\S]*?\\end\{\6\})/g;
    for(const node of texts){
      const value=node.textContent;let offset=0,match,fragment=null;
      re.lastIndex=0;
      while((match=re.exec(value))){
        fragment??=document.createDocumentFragment();
        fragment.append(document.createTextNode(value.slice(offset,match.index)));
        const span=document.createElement('span');span.className='paper-tex';
        span.dataset.tex=match[1]??match[2]??match[3]??match[4]??match[5];
        span.dataset.display=String(!!(match[1]||match[2]||match[5]));
        span.textContent=span.dataset.tex;fragment.append(span);offset=re.lastIndex;
      }
      if(fragment){fragment.append(document.createTextNode(value.slice(offset)));node.replaceWith(fragment)}
    }
  }

  const svgNS='http://www.w3.org/2000/svg';
  // Keep the source's scientific structure, without importing its page CSS.
  function structure(root){
    const mappings=[['ltx_th','th'],['ltx_td','td'],['ltx_tr','tr'],['ltx_thead','thead'],['ltx_tbody','tbody'],['ltx_tfoot','tfoot'],['ltx_tabular','table']];
    for(const [cls,tag] of mappings)for(const old of [...root.querySelectorAll('.'+cls)].reverse()){
      if(old.localName===tag||old.closest('svg,math'))continue;
      const node=document.createElement(tag);
      for(const attr of ['id','class','colspan','rowspan','align','scope'])if(old.hasAttribute(attr))node.setAttribute(attr,old.getAttribute(attr));
      node.append(...old.childNodes);old.replaceWith(node);
    }
    for(const li of root.querySelectorAll('li')){
      const marker=li.querySelector(':scope > .ltx_tag');
      if(marker){li.classList.add('paper-labeled-item');marker.classList.add('paper-list-marker')}
    }
    // Listings use div/span lines rather than pre/code. Keep their whitespace.
    for(const listing of root.querySelectorAll('.ltx_listing')){
      listing.classList.add('paper-code');listing.setAttribute('aria-label','Code listing');
      listing.querySelectorAll('.ltx_listing_data').forEach(n=>n.remove());
      for(const line of listing.querySelectorAll('.ltx_listingline')){
        const number=line.querySelector(':scope > .ltx_tag');
        if(number){number.classList.add('paper-line-number');number.setAttribute('aria-hidden','true')}
      }
    }
  }
  function presentation(root){
    const lengths=/^-?(?:\d*\.)?\d+(?:px|pt|em|ex|%)?$/i;
    const paint=/^(?:none|currentColor|transparent|[a-z]{1,24}|#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]+\)|url\(["']?#[\w:.-]+["']?\))$/i;
    const allowed={fill:paint,stroke:paint,color:paint,'stop-color':paint,
      'stroke-width':lengths,'font-size':lengths,'stroke-dashoffset':lengths,
      opacity:/^(?:0?(?:\.\d+)?|1(?:\.0+)?)$/,'fill-opacity':/^[\d.]+$/,'stroke-opacity':/^[\d.]+$/,
      'stroke-dasharray':/^(?:none|[\d.,\s-]+)$/,'stroke-linecap':/^(butt|round|square)$/,'stroke-linejoin':/^(miter|round|bevel)$/,
      'text-anchor':/^(start|middle|end)$/,'font-weight':/^(normal|bold|[1-9]00)$/,'font-style':/^(normal|italic|oblique)$/,
      'font-family':/^[\w\s,'"-]{1,160}$/,'fill-rule':/^(nonzero|evenodd)$/,'clip-rule':/^(nonzero|evenodd)$/,
      'dominant-baseline':/^[a-z-]{1,30}$/,'marker-end':paint,'marker-start':paint,'marker-mid':paint};
    const apply=(node,style)=>{
      for(const [name,pattern] of Object.entries(allowed)){
        const variable={fill:'--ltx-fill-color',stroke:'--ltx-stroke-color',color:'--ltx-fg-color'}[name];
        const value=(variable&&style.getPropertyValue(variable)||style.getPropertyValue(name)).trim();
        if(value&&pattern.test(value))node.setAttribute(name,value);
      }
    };
    for(const svg of root.querySelectorAll('svg')){
      if(svg.closest('math,.paper-tex'))continue;
      // Simple SVG class rules often carry every chart color and line style.
      for(const sheet of svg.querySelectorAll('style')){
        for(const match of sheet.textContent.slice(0,100000).matchAll(/([^{}]+)\{([^{}]*)\}/g)){
          const probe=document.createElement('span');probe.setAttribute('style',match[2]);
          for(const selector of match[1].split(',').slice(0,30)){
            if(!/^[\w\s.#>+~:-]+$/.test(selector.trim()))continue;
            try{for(const node of svg.querySelectorAll(selector.trim()))apply(node,probe.style)}catch{}
          }
        }
      }
      for(const node of [svg,...svg.querySelectorAll('[style]')])apply(node,node.style);
      if(!svg.hasAttribute('viewBox')){
        const w=parseFloat(svg.getAttribute('width')),h=parseFloat(svg.getAttribute('height'));
        if(w>0&&h>0)svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
      }
    }
  }
  function preserveLabels(root){
    const labels=[];
    for(const node of root.querySelectorAll('foreignObject')){
      // Rebuild label contents from a small inert vocabulary. This keeps TikZ's
      // labels in their original coordinates, including native MathML.
      const fragment=DOMPurify.sanitize(node.innerHTML,{RETURN_DOM_FRAGMENT:true,
        ALLOWED_TAGS:['div','span','p','br','strong','b','em','i','sub','sup','math','mrow','mi','mn','mo','mtext','mfrac','msqrt','mroot','msub','msup','msubsup','munder','mover','munderover','mtable','mtr','mtd','mspace','mfenced','semantics','annotation'],
        ALLOWED_ATTR:['class','display','mathvariant','stretchy','fence','separator','encoding','columnalign','rowalign','rowspacing','columnspacing'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
      const replacement=document.createElementNS(svgNS,'foreignObject');
      for(const attr of ['x','y','width','height']){
        const value=node.getAttribute(attr)||'0';
        if(/^-?(?:\d*\.)?\d+(?:px|pt|em|ex|%)?$/.test(value))replacement.setAttribute(attr,value);
      }
      const transform=node.getAttribute('transform')||'';
      if(/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([\d.,eE+\s-]+\)\s*)+$/.test(transform))replacement.setAttribute('transform',transform);
      replacement.setAttribute('class','paper-svg-label');
      const body=document.createElement('div');body.setAttribute('xmlns','http://www.w3.org/1999/xhtml');body.className='paper-svg-label-body';body.append(fragment);replacement.append(body);
      const token=document.createElementNS(svgNS,'g');token.setAttribute('data-paper-label',String(labels.length));node.replaceWith(token);labels.push(replacement);
    }
    return labels;
  }

  let prefix=0;
  function clean(html,base){
    const source=new DOMParser().parseFromString(html,'text/html');
    source.querySelectorAll('[data-paper-label]').forEach(n=>n.removeAttribute('data-paper-label'));
    structure(source.body);presentation(source.body);
    const labels=preserveLabels(source.body);
    latexNodes(source.body);
    source.querySelectorAll('script,style,iframe,object,embed,form,button,input,textarea,select,nav,header,footer,aside,link,meta,foreignObject,animate,animateTransform,set').forEach(n=>n.remove());
    for(const node of source.querySelectorAll('[style]'))node.removeAttribute('style');
    for(const node of source.querySelectorAll('img')){
      const url=safeUrl(node.getAttribute('src')||node.getAttribute('data-src'),base);
      if(!url){node.remove();continue}
      node.src=url;node.loading='lazy';node.referrerPolicy='no-referrer';node.removeAttribute('srcset');
    }
    for(const node of source.querySelectorAll('svg image,svg use')){
      const href=node.getAttribute('href')||node.getAttribute('xlink:href')||'';
      if(href.startsWith('#'))continue;
      const url=node.localName==='image'?safeUrl(href,base):'';
      if(url){node.setAttribute('href',url);node.removeAttribute('xlink:href')}else node.remove();
    }
    for(const node of source.querySelectorAll('a')){
      const href=node.getAttribute('href')||'';
      if(href.startsWith('#'))continue;
      const url=safeUrl(href,base);
      if(url){node.href=url;node.target='_blank';node.rel='noopener noreferrer'}else node.removeAttribute('href');
    }
    // Scope source IDs, including SVG definitions and equation references, to this paper.
    const tag='paper-'+(++prefix)+'-';
    for(const node of source.querySelectorAll('[id]'))node.id=tag+node.id;
    for(const node of source.querySelectorAll('*')){
      for(const attr of ['href','xlink:href','fill','stroke','clip-path','mask','filter','marker-start','marker-mid','marker-end']){
        const value=node.getAttribute(attr);if(!value)continue;
        if(['href','xlink:href'].includes(attr)&&value.startsWith('#'))node.setAttribute(attr,'#'+tag+value.slice(1));
        else if(value.includes('url('))node.setAttribute(attr,value.replace(/url\(["']?#([^)"']+)["']?\)/g,(_,id)=>'url(#'+tag+id+')'));
      }
    }
    const fragment=DOMPurify.sanitize(source.body.innerHTML,{
      RETURN_DOM_FRAGMENT:true,USE_PROFILES:{html:true,svg:true,mathMl:true},
      FORBID_TAGS:['style','script','iframe','object','embed','form','button','input','textarea','select','link','meta','foreignObject','animate','animateTransform','set'],
      FORBID_ATTR:['style','srcset'],ADD_ATTR:['data-tex','data-display','data-paper-label'],ALLOW_DATA_ATTR:false
    });
    for(const token of fragment.querySelectorAll('[data-paper-label]')){
      const label=labels[Number(token.getAttribute('data-paper-label'))];
      if(label)token.replaceWith(label);else token.remove();
    }
    return fragment;
  }
  function article(html,base){
    const source=new DOMParser().parseFromString(html,'text/html');
    const root=source.querySelector('article.ltx_document,article,main,[role="main"]');
    if(!root || root.textContent.trim().length<400)throw Error('Structured paper text is unavailable.');
    return {fragment:clean(root.innerHTML,base),title:source.querySelector('h1')?.textContent.trim()||source.title};
  }
  function markdown(text,base){
    // Preserve delimiters before the Markdown parser can treat math underscores as emphasis.
    const fragments=[];
    const protectedText=text.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]+?\$/g,value=>{
      const token='OPEN_SESAMEMATHBLOCK'+fragments.length+'END';fragments.push(value);return token;
    });
    const html=OpenSesameGFM.parse(protectedText).replace(/OPEN_SESAMEMATHBLOCK(\d+)END/g,(_,id)=>{
      const node=document.createElement('span');node.textContent=fragments[Number(id)]||'';return node.outerHTML;
    });
    return clean(html,base);
  }
  function sections(fragment){
    const parts=[],root=document.createElement('article');root.append(fragment);
    let current=document.createElement('section'),length=0;
    function append(node){
      if(length>12000){parts.push(current.innerHTML);current=document.createElement('section');length=0}
      length+=node.textContent.length;current.append(node);
    }
    for(const child of [...root.childNodes]){
      if(child.nodeType===1 && child.matches('section,.ltx_section,.ltx_document') && child.textContent.length>16000){
        for(const sub of [...child.childNodes])append(sub);
      }else append(child);
    }
    if(current.childNodes.length)parts.push(current.innerHTML);
    return parts;
  }
  async function load(entry){
    const normalized=window.OpenSesameDocuments?.normalize(entry.pdfUrl||entry.url||'');
    if(normalized?.format!=='paper')return null;
    const id=normalized.pdfUrl.split('/pdf/')[1];
    try{
      const result=await OpenSesameContent.fetchText('https://arxiv.org/html/'+id);
      const parsed=article(result.text,result.url);
      return {sections:sections(parsed.fragment),title:parsed.title};
    }catch{
      // Existing article text can be a publisher's summary, so require a full-paper body.
      if(entry.full && entry.body?.length>3000)return {sections:sections(clean(entry.body,entry.url)),title:entry.title};
      return null;
    }
  }
  async function typeset(host){
    const nodes=[...host.querySelectorAll('.paper-tex[data-tex]')];
    if(!nodes.length)return;
    let api;try{api=await mathEngine()}catch{
      for(const n of nodes){n.classList.add('paper-math-source');n.title='Math renderer unavailable. Original notation is preserved.'}
      return;
    }
    for(const node of nodes.slice(300)){node.classList.add('paper-math-source');node.title='Original notation · view Page for the typeset formula'}
    for(const node of nodes.slice(0,300)){
      const tex=node.dataset.tex;
      if(!tex || tex.length>12000){node.title='Long expression. View the original PDF for this equation.';continue}
      try{
        const result=await api.tex2svgPromise(tex,{display:node.dataset.display==='true'});
        const safe=DOMPurify.sanitize(result.outerHTML,{RETURN_DOM_FRAGMENT:true,USE_PROFILES:{html:true,svg:true,mathMl:true},FORBID_TAGS:['style','script','foreignObject','image'],FORBID_ATTR:['style'],ADD_TAGS:['mjx-container']});
        node.replaceChildren(safe);node.setAttribute('aria-label',tex);node.title=tex;
      }catch{node.textContent=tex;node.classList.add('paper-math-source');node.title='Original notation · use Page for the source layout'}
    }
  }
  function wireFigures(host){
    host.classList.add('paper-content');
    for(const svg of host.querySelectorAll('svg'))if(!svg.parentElement?.closest('svg,math,.paper-tex'))svg.classList.add('paper-diagram');
    for(const block of host.querySelectorAll('pre,.paper-code')){
      block.tabIndex=0;block.setAttribute('role','region');block.setAttribute('aria-label','Code listing, scroll horizontally for long lines');
    }
    for(const image of host.querySelectorAll('img,svg,canvas')){
      if(image.parentElement?.closest('figure,table,.paper-figure,math,.paper-tex,svg'))continue;
      const figure=document.createElement('figure');image.before(figure);figure.append(image);
    }
    for(const figure of host.querySelectorAll('figure,table')){
      if(figure.parentElement?.closest('figure,table,.paper-figure')||figure.matches('.ltx_equation,.ltx_equationgroup,.ltx_eqn_table'))continue;
      const table=figure.matches('table')?figure:figure.querySelector('table');
      const hasGraphic=!!figure.querySelector('img,svg:not(math svg),canvas');
      if(!table&&!hasGraphic)continue;
      const wrap=document.createElement('div'),scroll=document.createElement('div'),body=document.createElement('div');
      wrap.className='paper-figure'+(table?' paper-table':'');scroll.className='paper-figure-scroll';body.className='paper-visual';
      const caption=figure.querySelector('figcaption,caption');
      const description=caption?.textContent.trim().slice(0,160)||figure.querySelector('img')?.alt||(table?'Table':'Figure');
      figure.before(wrap);body.append(figure);scroll.append(body);wrap.append(scroll);
      scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',description+' · scroll to pan');
      const toggle=document.createElement('button');toggle.type='button';toggle.className='paper-figure-toggle';toggle.setAttribute('aria-expanded','false');
      toggle.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
      function expand(value){
        wrap.classList.toggle('enlarged',value);toggle.setAttribute('aria-expanded',String(value));
        toggle.title=toggle.ariaLabel=value?'Fit '+(table?'table':'figure'):'Enlarge '+(table?'table':'figure');
        if(!value){scroll.scrollLeft=0;scroll.scrollTop=0}
      }
      expand(false);wrap.append(toggle);toggle.addEventListener('click',()=>expand(!wrap.classList.contains('enlarged')));
      scroll.addEventListener('click',event=>{
        if(event.target.closest('a,button,math,.paper-tex')||window.getSelection()?.toString())return;
        if(event.target.closest('img,canvas,svg'))expand(!wrap.classList.contains('enlarged'));
      });
      scroll.addEventListener('keydown',event=>{
        if(['ArrowLeft','ArrowRight'].includes(event.key))event.stopPropagation();
        if(event.key==='Escape'&&wrap.classList.contains('enlarged')){event.preventDefault();event.stopPropagation();expand(false);toggle.focus({preventScroll:true})}
      });
    }
    for(const cell of host.querySelectorAll('.paper-table td,.paper-table th')){
      if(!cell.hasAttribute('scope')&&cell.tagName==='TH')cell.scope=cell.closest('thead')?'col':cell.parentElement?.firstElementChild===cell?'row':'col';
      if(/^[+−–-]?[\d,.]+(?:\s*[±%×]\s*[\d,.]*)?$/.test(cell.textContent.trim()))cell.classList.add('paper-numeric');
    }
    host.onclick=event=>{
      const link=event.target.closest('a[href^="#paper-"]');
      if(!link)return;
      const id=link.getAttribute('href').slice(1),target=[...host.querySelectorAll('[id]')].find(n=>n.id===id);
      if(target){event.preventDefault();target.scrollIntoView({block:'center',behavior:'smooth'})}
    };
  }
  async function render(html,host){
    host.innerHTML=html;wireFigures(host);await typeset(host);
  }
  window.OpenSesamePaper={clean,article,markdown,load,render,typeset,wireFigures};
})();
