'use strict';
(()=>{
  function advance(level,direction,step){let next=level+direction*step;while(next>1||next<0){if(next>1){next=2-next;direction=-1}if(next<0){next=-next;direction=1}}return {level:next,direction}}
  const material=level=>({opacity:.98-.30*level,blur:44-14*level});
  window.OpenSesameGlassModel={advance,material};
})();
