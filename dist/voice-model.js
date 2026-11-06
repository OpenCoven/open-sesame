'use strict';
(()=>{
  function draft(value,{chat=false,search=false}={}){
    const text=String(value||'').trim().slice(0,20000),clean=text.replace(/[.!?]+$/,'');let m;
    if(search)return clean.replace(/^(?:search|find)(?: (?:this |the )?(?:chat|conversation))?(?: for)?\s+/i,'');
    if(/^(?:start |begin )?(?:recording|record|recorder)(?: audio| a voice memo)?$/i.test(clean))return '/record';
    if(/^(?:start |begin )?(?:transcribing|transcribe|transcription|transcriber)(?: now)?$/i.test(clean))return '/transcribe';
    if(m=clean.match(/^(?:search|find) (?:this |the )?(?:chat|conversation)(?: for)? (.+)$/i))return '/find '+m[1];
    if(chat&&(m=clean.match(/^find (.+)$/i)))return '/find '+m[1];
    if(m=clean.match(/^(?:open|show|go to) (live|focus|projects|library|console|reader|reading|items|agents|shells|desktops|lockin|music|youtube|media)$/i))return '/'+m[1].toLowerCase();
    if(window.OpenSesameComputer?.parse(clean))return '/computer '+clean;
    if(m=clean.match(/^(?:start )?focus(?: for)? (15|20|25|30|45|60|90)(?: minutes)?$/i))return '/focus '+m[1];
    if(m=text.match(/^(?:(?:add|save|create) (?:a )?|new )?(note|task|bookmark)\s*:?\s+([\s\S]+)$/i))return '/'+m[1].toLowerCase()+' '+m[2];
    if(m=text.match(/^(?:bash|run command)\s*:?\s+([\s\S]+)$/i))return '! '+m[1];
    if(m=text.match(/^computer\s*:?\s+([\s\S]+)$/i))return '/computer '+m[1];
    return text;
  }
  function insert(original,start,end,text,limit=20000){
    const before=original.slice(0,start),after=original.slice(end),prefix=before&&!/\s$/.test(before)&&text&&!/^\s/.test(text)?' ':'',suffix=after&&!/^\s/.test(after)&&text&&!/\s$/.test(text)?' ':'';
    const value=before+prefix+text+suffix+after;if(value.length>limit)throw Error('The voice draft is too long for this field.');return {value,cursor:before.length+prefix.length+text.length};
  }
  window.OpenSesameVoiceModel={draft,insert};
})();
