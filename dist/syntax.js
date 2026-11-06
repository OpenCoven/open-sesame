'use strict';
(function(root){
  function tokens(text,{code=false}={}){
    const pattern=/(^\s*(?:\/[\w-]+|!))|(```[^\n]*\n[\s\S]*?(?:```|$)|`[^`\n]*`)|(https?:\/\/[^\s<>]+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|((?:^|\n)\s*#{1,6}[^\n]*)|(\/\/[^\n]*|#[^\n]*)|(\$\{?\w+\}?)|(--?[A-Za-z][\w-]*)|\b(const|let|var|function|return|if|else|for|while|import|from|export|async|await|def|class|print|echo|cd|git|npm|pnpm|python|sudo|true|false|null|SELECT|FROM|WHERE)\b|\b(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gm;
    const result=[];let position=0;const shell=code||/^\s*!/.test(text);
    for(const match of text.matchAll(pattern)){
      if(match.index>position)result.push({text:text.slice(position,match.index),type:''});
      const value=match[0];let type=match[1]?'command':match[2]?'code':match[3]?'link':match[4]?'string':match[5]?(shell?'comment':'heading'):match[6]?(shell?'comment':''):match[7]?'variable':match[8]?'flag':match[9]?(shell?'keyword':''):match[10]?'number':'';
      if(match[2]?.startsWith('```')){
        const start=value.indexOf('\n')+1,end=value.endsWith('```')?value.length-3:value.length;
        result.push({text:value.slice(0,start),type:'comment'},...tokens(value.slice(start,end),{code:true}),{text:value.slice(end),type:'comment'});
      }else result.push({text:value,type});position=match.index+value.length;
    }
    if(position<text.length)result.push({text:text.slice(position),type:''});return result;
  }
  root.OpenSesameSyntax={tokens};
})(typeof window==='undefined'?globalThis:window);
