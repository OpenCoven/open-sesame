'use strict';
/* Expanded geometry has one owner. Content and compact-notch geometry are independent. */
(()=>{
  const ratio=16/9,ratioLabel='16:9',keys=['small','medium','large','max','full'],names=['Small','Medium','Large','Max','Full'];
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function presets(screenWidth,screenHeight){
    const w=Math.max(320,Number(screenWidth)||1512),h=Math.max(320,Number(screenHeight)||982);
    const max=Math.min(Math.sqrt(w*h*.45*ratio),w-40,(h-72)*ratio);
    // Keep a useful 450px height on laptop screens, with room for distinct snap sizes.
    const min=Math.min(800,max*.9);
    const sizes=keys.slice(0,4).map((key,index)=>{const width=Math.round(min+(max-min)*index/3);return {key,name:names[index],width,height:Math.round(width/ratio)}});
    sizes.push({key:'full',name:'Full',width:Math.round(w),height:Math.round(h)});
    return sizes;
  }
  function nearest(width,sizes){return sizes.reduce((best,size)=>Math.abs(size.width-width)<Math.abs(best.width-width)?size:best,sizes[0])}
  function floating(width,availableWidth,availableHeight){
    const positive=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
    const fitted=Math.max(1,Math.floor(Math.min(Math.max(800,positive(width,800)),positive(availableWidth,1200),positive(availableHeight,800)*ratio)));
    return {width:fitted,height:Math.round(fitted/ratio)};
  }
  function resize(start,edge,dx,dy,{centered=true,min=0,max=Infinity}={}){
    const x=edge.includes('left')?-dx:edge.includes('right')?dx:0;
    const horizontal=x*(centered?2:1),vertical=edge.includes('bottom')?dy*ratio:0;
    // For corners, project onto the aspect-ratio line instead of counting a diagonal twice.
    const delta=edge.includes('bottom')&&(edge.includes('left')||edge.includes('right'))?(horizontal+vertical)/2:horizontal||vertical;
    const width=clamp(start.width+delta,min,max);
    return {width:Math.round(width),height:Math.round(width/ratio)};
  }
  const capacity=(height,reserved,row=26)=>clamp(Math.floor((height-reserved)/row),1,5);
  window.OpenSesameFrameModel={ratio,ratioLabel,keys,presets,nearest,floating,resize,capacity};
})();
