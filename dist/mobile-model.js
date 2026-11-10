'use strict';
// Presentation-only projections. Items, archive semantics and timers retain their existing owners.
(()=>{
  function today({items,workflow,focus,reading}){
    const notes=items.filter(n=>n.kind==='note'&&!workflow.isArchived(n));
    const latest=notes.reduce((best,n)=>!best||Number(n.updatedAt||n.createdAt||0)>Number(best.updatedAt||best.createdAt||0)?n:best,null);
    const tasks=items.filter(n=>n.kind==='task'),done=tasks.filter(workflow.isArchived).length;
    return {latest,tasks:{open:tasks.length-done,done,entries:tasks.filter(n=>!workflow.isArchived(n)).slice(0,3)},focus,reading};
  }
  const destination=scenario=>({items:'projects',plugins:'widgets',focus:'focus',terminal:'console',familiars:'console',remote:'console','agent-monitor':'console','computer-agent':'console'})[scenario]||'today';
  function seal(familiar){
    const name=String(familiar?.displayName||familiar?.name||'').trim(),id=String(familiar?.id||'');
    const initial=name?(typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(name)][0].segment:Array.from(name)[0]).toLocaleUpperCase():'';
    let hash=0;for(const char of id)hash=(hash*31+char.codePointAt(0))>>>0;
    return {initial,shape:['shield','square','circle'][hash%3]};
  }
  window.OpenSesameMobileModel={today,destination,seal};
})();
