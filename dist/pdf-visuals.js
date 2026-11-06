'use strict';
(() => {
  const overlap=(a,b,gap=6)=>a[0]<=b[2]+gap&&a[2]+gap>=b[0]&&a[1]<=b[3]+gap&&a[3]+gap>=b[1];
  const union=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])];
  function transformBox(box,matrix){
    const points=[[box[0],box[1]],[box[2],box[1]],[box[0],box[3]],[box[2],box[3]]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);
    return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  }
  function regions(page,content,ops){
    const {OPS,Util}=pdfjsLib, bounds=page.view, width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
    const fullPage=()=>[{box:bounds.slice(),kind:'source'}];
    if(content.items.length>6000||ops.fnArray.length>15000)return fullPage();
    let transform=[1,0,0,1,0,0];const stack=[],boxes=[];
    function add(box,kind){
      if(!box||box.length<4||!box.every(Number.isFinite))return;
      box=[Math.max(bounds[0],box[0]),Math.max(bounds[1],box[1]),Math.min(bounds[2],box[2]),Math.min(bounds[3],box[3])];
      const w=box[2]-box[0],h=box[3]-box[1];
      if(w<0||h<0||(!w&&!h)||w*h>width*height*.8)return;
      if(kind==='graphic' && w>width*.85&&h<3&&(box[1]<bounds[1]+height*.08||box[1]>bounds[3]-height*.08))return;
      if(w<1){box[0]-=.5;box[2]+=.5}if(h<1){box[1]-=.5;box[3]+=.5}
      boxes.push({box,kind});
    }
    for(let i=0;i<ops.fnArray.length;i++){
      const fn=ops.fnArray[i],args=ops.argsArray[i];
      if(fn===OPS.save)stack.push(transform.slice());
      else if(fn===OPS.restore)transform=stack.pop()||[1,0,0,1,0,0];
      else if(fn===OPS.transform)transform=Util.transform(transform,args);
      else if(fn===OPS.constructPath && args[2]){
        const [x1,y1,x2,y2]=args[2];
        add(transformBox([x1,y1,x2,y2],transform),'graphic');
      }else if([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject].includes(fn)){
        add(transformBox([0,0,1,1],transform),'graphic');
      }
    }
    const text=content.items.filter(item=>item.str?.trim()&&item.transform);
    const mono=[];
    for(const item of text){
      let font='';try{font=page.commonObjs.get(item.fontName)?.name||''}catch{}
      if(/Courier|Mono|CMTT|LMTypewriter/i.test(font))mono.push(item);
      const math=/[∫∑∏√∞≤≥≠∂∇∈∀∃⇒↦⊗]/.test(item.str)||/CM(?:MI|SY|EX)|Math|Symbol|MSAM|MSBM/i.test(font);
      if(!math)continue;
      const y=item.transform[5],x=item.transform[4],size=Math.max(1,item.height);
      // Preserve the whole local line, including subscripts and superscripts.
      const column=x<width/2?0:width/2;
      const nearby=text.filter(t=>Math.abs(t.transform[5]-y)<size*1.1 && t.transform[4]>=column-5 && t.transform[4]<column+width/2);
      if(!nearby.length)continue;
      add([Math.min(...nearby.map(t=>t.transform[4]))-4,Math.min(...nearby.map(t=>t.transform[5]-t.height*.4))-4,
        Math.max(...nearby.map(t=>t.transform[4]+t.width))+4,Math.max(...nearby.map(t=>t.transform[5]+t.height))+4],'equation');
    }
    // A code block's whitespace is meaningful. Preserve its source layout.
    const runs=[];
    for(const item of mono){
      const x=item.transform[4],y=item.transform[5],size=Math.max(1,item.height);
      const box=[x-3,y-size*.3-3,x+item.width+3,y+size+3];
      const run=runs.find(r=>overlap(r.box,box,size*1.3));
      if(run){run.box=union(run.box,box);run.lines.add(Math.round(y/3))}else runs.push({box,lines:new Set([Math.round(y/3)])});
    }
    for(const run of runs)if(run.lines.size>=3)add(run.box,'code');
    // Join table rules with the cell rows between them. Thin lines must not vanish.
    const rules=boxes.filter(r=>r.kind==='graphic'&&r.box[2]-r.box[0]>60&&r.box[3]-r.box[1]<3);
    for(const top of rules){
      const group=rules.filter(r=>Math.abs(r.box[0]-top.box[0])<8&&Math.abs(r.box[2]-top.box[2])<8&&Math.abs(r.box[1]-top.box[1])<height*.45);
      if(group.length>=3){const box=group.reduce((b,r)=>union(b,r.box),top.box);add(box,'graphic')}
    }
    // Merge connected paths before extending their bounds to nearby chart labels.

    const merged=[];
    for(const region of boxes){
      let current=region;
      for(let i=0;i<merged.length;){
        if(overlap(current.box,merged[i].box)){
          const other=merged[i],graphic=current.kind==='graphic'?current:other;
          const mathRule=(current.kind==='equation'||other.kind==='equation')&&graphic.kind==='graphic'&&graphic.box[2]-graphic.box[0]<width*.35&&graphic.box[3]-graphic.box[1]<height*.15;
          current={box:union(current.box,other.box),kind:current.kind===other.kind?current.kind:mathRule?'equation':'graphic'};
          merged.splice(i,1);i=0;
        }else i++;
      }
      merged.push(current);
    }
    for(const region of merged){
      if(region.kind==='equation'){
        const b=region.box,center=(b[1]+b[3])/2;
        // TeX's tall glyph metrics can overlap the next paragraph even when
        // the painted equation does not. Keep that prose outside the crop.
        for(const item of text){
          const x=item.transform[4],y=item.transform[5],h=Math.max(1,item.height);
          if(item.str.length<25||x>=b[0]-8||x+item.width<=b[0])continue;
          if(y>center&&y<b[3]+h)b[3]=Math.min(b[3],y-h*.35-2);
          else if(y<center&&y>b[1]-h)b[1]=Math.max(b[1],y+h+2);
        }
        continue;
      }
      const box=region.box.slice();
      for(const item of text){
        const x=item.transform[4],y=item.transform[5],h=Math.max(1,item.height),b=[x,y-h*.25,x+item.width,y+h];
        if(!overlap(box,b,Math.min(18,h*1.4)))continue;
        // Keep adjacent prose and multi-line captions as reflowable text. Only
        // extend a chart to short labels outside its original vertical bounds.
        if(y<box[1]||y>box[3]){
          const line=text.filter(t=>Math.abs(t.transform[5]-y)<h*.35);
          const lineWidth=Math.max(...line.map(t=>t.transform[4]+t.width))-Math.min(...line.map(t=>t.transform[4]));
          if(lineWidth>(box[2]-box[0])*.9)continue;
        }
        if(b[2]-b[0]<width*.7)region.box=union(region.box,b);
      }
      region.box=[Math.max(bounds[0],region.box[0]-3),Math.max(bounds[1],region.box[1]-3),Math.min(bounds[2],region.box[2]+3),Math.min(bounds[3],region.box[3]+3)];
    }
    const selected=merged.filter(({box:b})=>(b[2]-b[0])>=28&&(b[3]-b[1])>=10).sort((a,b)=>b.box[3]-a.box[3]);
    return selected.length>24?fullPage():selected;
  }
  function crop(region,pageView,source,pageNumber){
    const rect=pageView.convertToViewportRectangle(region.box),x=Math.max(0,Math.floor(Math.min(rect[0],rect[2])-5)),y=Math.max(0,Math.floor(Math.min(rect[1],rect[3])-5));
    const width=Math.min(source.width-x,Math.ceil(Math.abs(rect[2]-rect[0])+10)),height=Math.min(source.height-y,Math.ceil(Math.abs(rect[3]-rect[1])+10));
    const label=region.kind==='source'?'Original page detail':region.kind==='equation'?'Equation':region.kind==='code'?'Code listing':'Figure / table';
    const figure=document.createElement('figure'),image=document.createElement('canvas'),caption=document.createElement('figcaption');
    image.width=Math.max(1,width);image.height=Math.max(1,height);
    image.getContext('2d').drawImage(source,x,y,width,height,0,0,width,height);
    image.setAttribute('role','img');image.setAttribute('aria-label',label+' from PDF page '+pageNumber);
    caption.textContent=label+' · source page '+pageNumber;
    figure.className='pdf-source-figure';figure.append(image,caption);return figure;
  }
  window.OpenSesamePDFVisuals={regions,crop};
})();
