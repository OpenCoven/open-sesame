'use strict';
(()=>{
  const day=value=>{const d=new Date(value);d.setHours(0,0,0,0);return d};
  const add=(value,n)=>{const d=day(value);d.setDate(d.getDate()+n);return d};
  const key=value=>{const d=new Date(value);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  function dates(mode,value){const d=day(value);if(mode==='day')return[d];if(mode==='month')d.setDate(1);d.setDate(d.getDate()-(d.getDay()+6)%7);return Array.from({length:mode==='month'?42:7},(_,i)=>add(d,i))}
  function shift(mode,value,amount){const d=day(value);if(mode==='month'){d.setDate(1);d.setMonth(d.getMonth()+amount)}else d.setDate(d.getDate()+amount*(mode==='week'?7:1));return d}
  function onDay(events,value){const start=day(value).getTime(),end=add(value,1).getTime();return events.filter(e=>e.start<end&&e.start+e.minutes*60000>start).sort((a,b)=>a.start-b.start)}
  const validDuration=minutes=>Number.isInteger(minutes)&&minutes>=15&&minutes<=1440;
  function validate(event){return event&&typeof event.id==='string'&&typeof event.title==='string'&&Number.isFinite(event.start)&&Number.isFinite(new Date(event.start).getTime())&&validDuration(event.minutes)&&Array.isArray(event.topics)&&event.topics.length>0&&event.topics.length<=(event.minutes<=25?5:event.minutes<=60?10:Infinity)&&event.topics.every(t=>typeof t.name==='string'&&Number.isFinite(t.minutes)&&t.minutes>0)}
  window.OpenSesameFocusCalendarModel={day,add,key,dates,shift,onDay,validate,validDuration};
})();
