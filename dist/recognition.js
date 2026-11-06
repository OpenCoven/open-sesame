'use strict';
// One session owns its results and timers. No recording or transcript leaves this layer.
(function(root){
  function create({Engine,lang='en-US',track=null,continuous=true,onText=()=>{},onStatus=()=>{},onError=()=>{},onEnd=()=>{},timers=globalThis}){
    let current=null,finished=false,stopping=false,retries=0,restart=null,deadline=null,segments=[];
    const join=values=>values.filter(Boolean).join('\n');
    function snapshot(){const rows=current?.rows||[];return {final:join([...segments,...rows.filter(r=>r.final).map(r=>r.text)]),interim:rows.filter(r=>!r.final).map(r=>r.text).join(' ')}}
    function publish(){onText(snapshot())}
    function retain(){if(!current)return;const text=current.rows.map(r=>r.text).filter(Boolean).join(' ');if(text)segments.push(text);current=null}
    function finish(error=''){if(finished)return;finished=true;timers.clearTimeout(restart);timers.clearTimeout(deadline);const old=current;retain();if(old)try{old.engine.abort()}catch{}publish();onStatus(error?'error':'ready');onEnd(error)}
    function fail(error){onError(error);finish(error)}
    function launch(){
      if(finished||stopping)return;
      let engine;try{engine=new Engine()}catch{fail('unavailable');return}
      const part={engine,rows:[],error:''};current=part;
      engine.lang=lang;engine.continuous=continuous;engine.interimResults=true;engine.maxAlternatives=1;
      engine.onstart=()=>{if(current===part&&!finished&&!stopping)onStatus('listening')};
      engine.onresult=event=>{if(current!==part||finished)return;part.rows=Array.from(event.results,result=>({text:String(result[0]?.transcript||'').trim(),final:!!result.isFinal}));publish()};
      const end=()=>{
        if(current!==part||finished)return;timers.clearTimeout(deadline);retain();publish();
        if(stopping){finish();return}
        if(part.error==='network'&&retries<2){retries++;onStatus('reconnecting');restart=timers.setTimeout(launch,600*2**(retries-1));return}
        if(part.error&&part.error!=='no-speech'){fail(part.error);return}
        if(continuous){restart=timers.setTimeout(launch,350)}else finish();
      };
      engine.onend=end;
      engine.onerror=event=>{if(current!==part||finished)return;if(stopping&&event.error==='aborted'){end();return}part.error=event.error;timers.clearTimeout(deadline);deadline=timers.setTimeout(()=>{if(current===part){try{engine.abort()}catch{}end()}},500)};
      try{track?engine.start(track):engine.start()}catch(error){part.error=error.name==='NotAllowedError'?'not-allowed':error.name==='InvalidStateError'?'audio-capture':'unavailable';end()}
    }
    return {start:launch,stop(){if(finished||stopping)return;stopping=true;timers.clearTimeout(restart);onStatus('finishing');if(!current){finish();return}timers.clearTimeout(deadline);deadline=timers.setTimeout(()=>finish(),1800);try{current.engine.stop()}catch{finish()}},abort(){if(finished)return;finished=true;timers.clearTimeout(restart);timers.clearTimeout(deadline);const old=current;current=null;if(old)try{old.engine.abort()}catch{}},get text(){return snapshot()}};
  }
  const messages={'not-allowed':'Microphone or speech permission was declined.','service-not-allowed':'Speech recognition is disabled in this browser.','audio-capture':'The speech service could not read this audio source.','network':'The speech service could not connect after two retries.','language-not-supported':'Speech recognition does not support this language.','unavailable':'Speech recognition could not start in this browser.','no-speech':'No speech detected. Try again.'};
  root.OpenSesameRecognition={create,message:error=>messages[error]||'Speech recognition stopped. Try again.'};
})(typeof window==='undefined'?globalThis:window);
