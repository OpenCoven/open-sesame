// Synthetic native-renderer host. Loaded only by the renderer harnesses, never by the app.
(() => {
  const settings={'shell.lastView':'today'}, states={};
  const calls=[];
  window.__shellFixture={calls,settings,states};
  window.__OPEN_SESAME_NATIVE__=true;
  window.__TAURI__={event:{listen:async()=>()=>{}},core:{Channel:class{},invoke:async(command,{message})=>{
    const {requestId,method,params}=message;calls.push({method});let result;
    if(method==='system.info')result={available:true,platform:'renderer-fixture',authenticated:false};
    else if(method==='settings.all')result={settings};
    else if(method==='widgets.list')result={widgets:states};
    else if(method==='settings.set'){settings[params.key]=params.value;result={saved:true};}
    else if(method==='widgets.set'){states[params.id]=params.state;result={saved:true};}
    else if(method==='terminal.open')result={id:params.id,pid:0,machine:'fixture'};
    else result=true;
    return {requestId,result};
  }}};
})();
