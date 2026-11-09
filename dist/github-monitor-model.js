'use strict';
(()=>{
  const safeLink=url=>typeof url==='string'&&/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/(?:pull|issues|actions\/runs)\/[0-9]+$/.test(url);
  const timestamp=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:0};
  const attention=new Set(['failure','timed_out','action_required','startup_failure']);
  function entries(data,{query='',filter='all',sort='updated'}={}){
    const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const rows=(data?.entries||[]).filter(e=>safeLink(e.url)&&words.every(word=>[e.title,e.subtitle,e.state,e.id,e.workflow,e.event].join(' ').toLocaleLowerCase().includes(word))&&(filter==='all'||filter==='attention'&&attention.has(e.state)||filter==='active'&&['in_progress','queued','pending','waiting','requested'].includes(e.state)||filter==='draft'&&e.state==='draft'));
    return rows.map((e,i)=>({e,i})).sort((a,b)=>{
      const x=a.e,y=b.e;
      const order=sort==='title'?String(x.title||'').localeCompare(String(y.title||'')):sort==='state'?String(x.state||'').localeCompare(String(y.state||'')):timestamp(sort==='created'?y.createdAt:y.updatedAt)-timestamp(sort==='created'?x.createdAt:x.updatedAt);
      return order||a.i-b.i;
    }).map(x=>x.e);
  }
  function relative(value,now=Date.now()){
    const time=timestamp(value);if(!time)return '';
    const minutes=Math.max(0,Math.floor((now-time)/60000));return minutes<1?'just now':minutes<60?minutes+'m ago':minutes<1440?Math.floor(minutes/60)+'h ago':Math.floor(minutes/1440)+'d ago';
  }
  window.OpenSesameGitHubMonitorModel={safeLink,entries,relative,attention};
})();
