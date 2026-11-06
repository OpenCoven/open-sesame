// Optional local adapter for Photon Spectrum Stable. See controller-setup.md.
import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers';
const env=process.env,base='http://127.0.0.1:8766';
for(const key of ['PROJECT_ID','PROJECT_SECRET','OPEN_SESAME_CONTROLLER_TOKEN','OPEN_SESAME_ALLOWED_SENDER','OPEN_SESAME_ALLOWED_CHAT'])if(!env[key])throw Error('Missing '+key);
const app=await Spectrum({projectId:env.PROJECT_ID,projectSecret:env.PROJECT_SECRET,providers:[imessage.config()]});
const headers={'Authorization':'Bearer '+env.OPEN_SESAME_CONTROLLER_TOKEN,'Content-Type':'application/json'};
for await(const [space,message] of app.messages){
  if(message.direction!=='inbound'||message.platform!=='imessage'||message.content.type!=='text'||message.sender?.id!==env.OPEN_SESAME_ALLOWED_SENDER||space.id!==env.OPEN_SESAME_ALLOWED_CHAT)continue;
  try{
    const response=await fetch(base+'/command',{method:'POST',headers,body:JSON.stringify({id:message.id,sender:message.sender.id,chat:space.id,text:message.content.text}),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Open Sesame rejected the command');const job=await response.json();if(job.duplicate)continue;
    let result='Queued in Open Sesame. Keep the desktop widget open; check its controller for the result.';
    for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,2000));const r=await fetch(base+'/result?id='+encodeURIComponent(job.id),{headers,signal:AbortSignal.timeout(5000)});if(!r.ok)break;const status=await r.json();if(['done','interrupted'].includes(status.state)){result=status.result;break}}
    await message.reply(result);
  }catch{console.error('Controller delivery failed. Check the receiver and connection; no command was retried.');}
}
