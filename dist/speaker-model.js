'use strict';
(()=>{
  function validWords(rows){return Array.isArray(rows)?rows.filter(w=>w&&typeof w.text==='string'&&w.text.length<=1000&&Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.start>=0&&w.end>=w.start&&w.end<=1805).slice(0,30000).map(w=>({text:w.text,start:w.start,end:w.end})):[]}
  function validSegments(rows){if(!Array.isArray(rows)||rows.length>20000)throw Error('Invalid speaker intervals');return rows.map(s=>{if(!s||!Number.isInteger(s.speaker)||s.speaker<0||s.speaker>3||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>1800.25)throw Error('Invalid speaker interval');return {start:s.start,end:s.end,speaker:s.speaker}})}
  function turns(words,segments,through=0,pendingLabels=true){
    const result=[],ordered=[...segments].sort((a,b)=>a.start-b.start);let cursor=0,active=[],previous=-1;
    for(const word of validWords(words)){
      if(word.start<previous){cursor=0;active=[]}previous=word.start;while(cursor<ordered.length&&ordered[cursor].start<word.end)active.push(ordered[cursor++]);active=active.filter(s=>s.end>word.start);
      const scores=new Map();for(const s of active){const overlap=Math.max(0,Math.min(word.end,s.end)-Math.max(word.start,s.start));if(overlap)scores.set(s.speaker,(scores.get(s.speaker)||0)+overlap)}
      const ranked=[...scores].sort((a,b)=>b[1]-a[1]),winner=ranked[0],overlap=winner&&ranked[1]&&ranked[1][1]>=winner[1]*.7;
      const speakers=winner?(overlap?ranked.filter(([,n])=>n>=winner[1]*.7).map(([id])=>id).sort():[winner[0]]):[];
      const pending=pendingLabels&&!winner&&word.end>through,key=speakers.join(',')+(pending?'pending':''),last=result.at(-1);
      if(last&&last.key===key&&word.start-last.end<2){last.text+=' '+word.text;last.end=word.end}else result.push({key,speakers,pending,text:word.text,start:word.start,end:word.end});
    }
    return result.map(t=>({...t,text:t.text.replace(/\s+([.,!?;:])/g,'$1')}));
  }
  window.OpenSesameSpeakerModel={validWords,validSegments,turns};
})();
