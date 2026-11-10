'use strict';
// Presentation-only projections. Items, archive semantics and timers retain their existing owners.
(()=>{
  function today({items,workflow,focus,reading}){
    const notes=items.filter(n=>n.kind==='note'&&!workflow.isArchived(n));
    const latest=notes.reduce((best,n)=>!best||Number(n.updatedAt||n.createdAt||0)>Number(best.updatedAt||best.createdAt||0)?n:best,null);
    const tasks=items.filter(n=>n.kind==='task'),done=tasks.filter(workflow.isArchived).length;
    return {latest,tasks:{open:tasks.length-done,done},focus,reading};
  }
  const destination=scenario=>({items:'projects',plugins:'widgets',focus:'focus',terminal:'console',familiars:'console',remote:'console','agent-monitor':'console','computer-agent':'console'})[scenario]||'today';
  window.OpenSesameMobileModel={today,destination};
})();
