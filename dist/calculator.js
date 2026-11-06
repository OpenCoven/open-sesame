'use strict';
(function(root){
  const units=new Map(),defaults={};
  function unit(group,label,factor,names,target){const value={group,label,factor};for(const name of names.split('|'))units.set(name.toLowerCase(),value);defaults[label]=target}
  unit('length','mm',.001,'mm|millimeter|millimeters|millimetre|millimetres','in');
  unit('length','cm',.01,'cm|centimeter|centimeters|centimetre|centimetres','in');
  unit('length','m',1,'m|meter|meters|metre|metres','ft');
  unit('length','km',1000,'km|kilometer|kilometers|kilometre|kilometres','mi');
  unit('length','in',.0254,'in|inch|inches|"','cm');
  unit('length','ft',.3048,"ft|foot|feet|'",'m');
  unit('length','yd',.9144,'yd|yard|yards','m');unit('length','mi',1609.344,'mi|mile|miles','km');
  unit('mass','g',1,'g|gram|grams','oz');unit('mass','kg',1000,'kg|kilogram|kilograms','lb');unit('mass','mg',.001,'mg|milligram|milligrams','g');
  unit('mass','lb',453.59237,'lb|lbs|pound|pounds','kg');unit('mass','oz',28.349523125,'oz|ounce|ounces','g');
  unit('volume','mL',.001,'ml|milliliter|milliliters','fl oz');unit('volume','L',1,'l|liter|liters|litre|litres','gal');
  unit('volume','US gal',3.785411784,'gal|gallon|gallons|us gal','L');unit('volume','US fl oz',.0295735295625,'fl oz|fluid ounce|fluid ounces|us fl oz','mL');unit('volume','US cup',.2365882365,'cup|cups|us cup','mL');
  unit('time','s',1,'s|sec|secs|second|seconds','min');unit('time','min',60,'min|mins|minute|minutes','h');unit('time','h',3600,'h|hr|hrs|hour|hours','min');unit('time','day',86400,'day|days','h');unit('time','week',604800,'week|weeks','day');
  unit('data','B',1,'b|byte|bytes','KB');unit('data','KB',1e3,'kb|kilobyte|kilobytes','MB');unit('data','MB',1e6,'mb|megabyte|megabytes','GB');unit('data','GB',1e9,'gb|gigabyte|gigabytes','MB');unit('data','TB',1e12,'tb|terabyte|terabytes','GB');
  unit('data','KiB',1024,'kib','KB');unit('data','MiB',1024**2,'mib','MB');unit('data','GiB',1024**3,'gib','GB');
  unit('temperature','°F',1,'f|°f|fahrenheit','C');unit('temperature','°C',1,'c|°c|celsius','F');unit('temperature','K',1,'k|kelvin','C');
  function format(number){if(Object.is(number,-0))number=0;return new Intl.NumberFormat('en-US',{maximumSignificantDigits:12}).format(number)}
  function conversion(raw){
    const match=raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-z°"'][a-z\s°"']*?)(?:\s+(?:to|in|into|as)\s*(.*))?$/i);
    if(!match)return null;const source=units.get(match[2].trim().toLowerCase());if(!source)return null;
    const targetText=(match[3]||'').replace(/(?:\.{2,}|…)$/,'').trim(),target=units.get((targetText||defaults[source.label]).toLowerCase());
    if(!target)return null;if(source.group!==target.group)return {error:'Choose another '+source.group+' unit.'};
    const value=Number(match[1]);let answer=value*source.factor/target.factor;
    if(source.group==='temperature'){
      const kelvin=source.label==='°F'?(value-32)*5/9+273.15:source.label==='°C'?value+273.15:value;
      if(kelvin<0)return {error:'Temperature is below absolute zero.'};
      answer=target.label==='°F'?(kelvin-273.15)*9/5+32:target.label==='°C'?kelvin-273.15:kelvin;
    }
    if(!Number.isFinite(answer))return {error:'This result is outside the supported range.'};
    const result=format(Math.abs(answer)<1e-12?0:answer)+' '+target.label;
    return {value:answer,result,expression:format(value)+' '+source.label+' → '+target.label,note:!targetText?'Suggested conversion':source.group==='data'?'KB / MB use 1,000; KiB / MiB use 1,024':source.group==='volume'&&/US/.test(source.label+target.label)?'US customary volume':''};
  }
  const functions={sqrt:Math.sqrt,abs:Math.abs,ln:Math.log,log:Math.log10,log10:Math.log10,log2:Math.log2,sin:Math.sin,cos:Math.cos,tan:Math.tan,round:Math.round,floor:Math.floor,ceil:Math.ceil};
  function math(raw){
    const source=raw.replace(/,/g,'').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/[−–]/g,'-').replace(/\*\*/g,'^').replace(/π/g,'pi').replace(/\bof\b/gi,'*').replace(/(?<![a-z])(log10|log2)\b(?!\s*\()/gi,(_,name)=>'log '+name.slice(3));
    if(!/[+*/^%()]|\d\s*-\s*\d|\b(?:sqrt|log|ln|sin|cos|tan|abs|pi)\b/i.test(source))return null;
    const tokens=source.toLowerCase().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+\d*|[+\-*/^%()]/g)||[];
    if(tokens.join('')!==source.toLowerCase().replace(/\s/g,'')||tokens.length>128)return null;
    let index=0,depth=0;const peek=()=>tokens[index],take=()=>tokens[index++];
    function atom(){if(++depth>24)throw Error('Expression is too deeply nested.');const token=take();let value;
      if(token==='('){value=add();if(take()!==')')throw Error('Close the parentheses to calculate.')}
      else if(token==='pi'||token==='e')value=token==='pi'?Math.PI:Math.E;
      else if(functions[token])value=functions[token](peek()==='('?atom():unary());
      else if(token!==undefined&&/^\d|^\.\d/.test(token))value=Number(token);
      else throw Error('Finish the expression to calculate.');depth--;return value;
    }
    function power(){let value=atom();while(peek()==='%'){take();value/=100}if(peek()==='^'){take();value=Math.pow(value,unary())}return value}
    function unary(){if(peek()==='+'){take();return unary()}if(peek()==='-'){take();return -unary()}return power()}
    function multiply(){let value=unary();while(index<tokens.length){const token=peek();if(token==='*'||token==='/'){take();const right=unary();if(token==='/'&&right===0)throw Error('Cannot divide by zero.');value=token==='*'?value*right:value/right}else if(token==='('||token==='pi'||token==='e'||functions[token])value*=unary();else break}return value}
    function add(){let value=multiply();while(peek()==='+'||peek()==='-'){const op=take(),right=multiply();value=op==='+'?value+right:value-right}return value}
    // Unknown words are ordinary captures, never executable expressions.
    if(tokens.some(t=>/^[a-z]/.test(t)&&!['pi','e'].includes(t)&&!functions[t]))return null;
    try{const value=add();if(index!==tokens.length)throw Error('Finish the expression to calculate.');if(!Number.isFinite(value))throw Error('No finite real result.');
      const display=[];tokens.forEach((token,i)=>{const previous=tokens[i-1];if(i&&(/\d$/.test(previous)||previous===')'||previous==='%'||['pi','e'].includes(previous))&&(token==='('||functions[token]||['pi','e'].includes(token)))display.push('×');display.push(token==='*'?'×':token==='/'?'÷':token==='log'?'log₁₀':token)});
      return {value,result:format(value),expression:display.join(' '),note:/\b(?:sin|cos|tan)\b/.test(source)?'Angles in radians':/log/.test(source)?'log = base 10; ln = natural log':''};
    }catch(error){return {error:error.message}}
  }
  function calculate(raw){const text=String(raw).trim().replace(/^=\s*/,'').replace(/\s*=\s*$/,'');if(!text||text.length>500||/\n/.test(text))return null;return conversion(text)||math(text)}
  root.OpenSesameCalculator={calculate,format};
})(typeof window==='undefined'?globalThis:window);
