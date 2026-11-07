'use strict';
(()=>{
  const action=(id,value,label,description,icon,group,extra={})=>({id,value,label,description,icon,group,...extra});
  const outline=action('outline','/outline ','Outline','Organize a topic into subtopics','items','write',{children:[
    action('outline-blank','/outline ','Custom outline','Topic > Subtopic > Subtopic','items','write'),
    action('outline-topics','/outline ','Topic & subtopics','Start with a simple, editable structure','items','write',{template:'/outline Topic\nSubtopic 1\nSubtopic 2',selection:'Topic'}),
    action('outline-research','/outline ','Research outline','Question, evidence, findings, next steps','search','write',{template:'/outline Research topic\nKey question\nEvidence\nFindings\nNext steps',selection:'Research topic'})
  ]});
  const roots=[
    action('notes','/note ','Notes','Quick thoughts, meeting notes, and checklists','capture','write',{children:[
      action('note','/note ','Quick note','Save a thought to this project','capture','write'),outline,
      action('meeting','/note ','Meeting notes','Decisions, discussion, and action items','mic','write',{template:'/note Meeting notes\n\n## Discussion\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] ',selection:'Meeting notes'}),
      action('checklist','/note ','Checklist','A simple Markdown checklist','task','write',{template:'/note Checklist\n\n- [ ] First step\n- [ ] Next step',selection:'Checklist'})
    ]}),
    action('task','/task ','Task','Capture a to-do without losing your place','task','write'),
    action('bookmark','/bookmark ','Bookmarks','Save one link or paste several','bookmark','write'),
    action('focus','/focus','Focus','Choose a session length','focus','focus',{children:[15,25,45,60].map(n=>action('focus-'+n,'/focus '+n,n+' minutes',n<=25?'A short, focused session':'Room for deeper work','focus','focus')).concat(action('focus-open','/focus','Open timer','Edit topics or use the calendar','focus','focus'))}),
    action('media','/media','Media','Music, YouTube, and local files','music','media',{children:[action('music','/music','Music','Spotify, Apple Music, and YouTube Music','music','media'),action('youtube','/youtube ','YouTube','Paste a video or playlist link','play','media'),action('local-media','/media ','Local media','Open the player or paste a media link','monitor','media')]}),
    action('agents','/agent ','Agents','Conversations, commands, and computer use','terminal','agents',{children:[action('familiars','/familiars','Coven Familiars','Connect, choose a familiar, and chat','chat','agents'),action('agent','/agent ','Ask Coven','Review an agent request','terminal','agents'),action('computer','/computer ','Computer use','Review a computer task','monitor','agents'),action('bash','!','Bash command','Review before running in a shell','terminal','agents'),action('find','/find ','Search conversation','Find a message in the current chat','search','agents')]}),
    action('record','/record','Recorder','Record microphone audio to a file','mic','write'),
    action('transcribe','/transcribe','Transcriber','Start a live transcript and questions','capture','write'),
    action('screenshot','/screenshot ','Screen notes','Review a demo screen and placeholder notes','monitor','write'),
    action('open','/projects','Go to','Jump to another part of Open Sesame','arrow-up-right','open',{children:[action('projects','/projects','Projects','Notes, bookmarks, and tasks','items','open'),action('reader','/reader','Reader','Articles, papers, and feeds','rss','open'),action('console','/console','Console','Familiars, processes, shells, and desktops','terminal','open'),action('live','/live','Live','Transcribe and ask about a conversation','mic','open'),action('plugins','/plugins','Plugins','Apps, accounts, and local connections','plugins','open')]})
  ];
  const groups=[['all','All'],['write','Capture'],['focus','Focus'],['media','Media'],['agents','Agents'],['open','Go to']];
  const flat=entries=>entries.flatMap(row=>row.children?flat(row.children):[row]);
  function search(query,entries=roots){const term=query.trim().replace(/^\//,'').toLowerCase();if(!term)return entries;const words=term.split(/\s+/);return flat(entries).filter(row=>words.every(word=>[row.value.replace(/^\//,''),row.label,row.description,row.group].join(' ').toLowerCase().includes(word)))}
  function outlineText(body){const topics=body.split(/\r?\n|\s*>\s*/).map(s=>s.trim().replace(/^#+\s*/, '')).filter(Boolean);if(!topics.length)return '';return topics[0]+(topics.length>1?'\n\n'+topics.slice(1).map(s=>'## '+s+'\n\n- ').join('\n\n'):'\n\n## Notes\n\n- ')}
  window.OpenSesameCaptureCatalog={roots,groups,search,outlineText};
})();
