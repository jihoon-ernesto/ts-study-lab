const clone = value => JSON.parse(JSON.stringify(value));
export const emptyDoc = () => ({v:2,clock:0,fields:{},history:[]});
const compare = (a,b) => a[0]-b[0] || (a[1]<b[1]?-1:a[1]>b[1]?1:0);
const stampOK = stamp => Array.isArray(stamp) && stamp.length===2 && Number.isSafeInteger(stamp[0]) && stamp[0]>=0 && typeof stamp[1]==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(stamp[1]);
function validValue(key,value,ids) {
 if(key==='current') return Number.isInteger(value)&&value>=0&&value<ids.length;
 const [group,id]=key.split('.'); if(!ids.includes(id)) return false;
 return group==='done'?typeof value==='boolean':group==='notes'?typeof value==='string'&&value.length<=20000:group==='answers'?(value===null||Number.isInteger(value)&&value>=0&&value<=2):false;
}
export function validateDoc(value,ids) {
 if(!value || value.v!==2 || !Number.isSafeInteger(value.clock) || value.clock<0 || !value.fields || typeof value.fields!=='object') throw new Error('동기화 자료 형식이 올바르지 않습니다.');
 const doc=emptyDoc(); doc.clock=value.clock;
 for(const [key,entry] of Object.entries(value.fields)) {
  if(!entry || !validValue(key,entry.value,ids)||!stampOK(entry.stamp)) throw new Error('동기화 필드가 올바르지 않습니다.');
  doc.fields[key]=clone(entry);doc.clock=Math.max(doc.clock,entry.stamp[0]);
 }
 if(!Array.isArray(value.history)||value.history.length>ids.length*12) throw new Error('메모 보관함이 올바르지 않습니다.');
 for(const entry of value.history) {
  if(!entry||!ids.includes(entry.chapter)||typeof entry.value!=='string'||entry.value.length>20000||!stampOK(entry.stamp)) throw new Error('메모 기록이 올바르지 않습니다.');
  doc.history.push(clone(entry));
 }
 return doc;
}
function defaults(key) {return key==='current'?0:key.startsWith('done.')?false:key.startsWith('notes.')?'':null;}
export function project(doc,ids) {
 const state={current:doc.fields.current?.value??0,done:{},answers:{},notes:{}};
 for(const id of ids) {
  state.done[id]=doc.fields[`done.${id}`]?.value??false;
  state.notes[id]=doc.fields[`notes.${id}`]?.value??'';
  const answer=doc.fields[`answers.${id}`]?.value;
  if(answer!==null&&answer!==undefined)state.answers[id]=answer;
 }
 return state;
}
export function capture(doc,snapshot,device,ids) {
 const next=clone(doc),values={current:snapshot.current??0};
 for(const id of ids){values[`done.${id}`]=!!snapshot.done?.[id];values[`notes.${id}`]=(snapshot.notes?.[id]??'').slice(0,20000);values[`answers.${id}`]=snapshot.answers?.[id]??null;}
 const changed=Object.entries(values).filter(([key,value])=>(next.fields[key]?.value??defaults(key))!==value);
 if(!changed.length)return doc;
 next.clock++;for(const [key,value]of changed)next.fields[key]={value,stamp:[next.clock,device]};
 return next;
}
function boundedHistory(entries,ids) {
 const result=[];
 for(const id of ids){
  const unique=new Map();
  for(const entry of entries.filter(entry=>entry.chapter===id&&entry.value)) {
   const key=JSON.stringify([entry.chapter,entry.stamp]);const old=unique.get(key);
   if(!old||old.value<entry.value)unique.set(key,clone(entry));
  }
  // Keep at most eight distinct recent note versions per chapter.
  const values=new Set();
  for(const entry of [...unique.values()].sort((a,b)=>compare(b.stamp,a.stamp))) {
   if(values.has(entry.value))continue;values.add(entry.value);result.push(entry);if(values.size>=8)break;
  }
 }
 return result;
}
export function merge(left,right,ids) {
 const doc=emptyDoc();doc.clock=Math.max(left.clock,right.clock);
 const history=[...left.history,...right.history];
 for(const key of [...new Set([...Object.keys(left.fields),...Object.keys(right.fields)])].sort()) {
  const a=left.fields[key],b=right.fields[key];
  let winner=a??b;
  if(a&&b){const order=compare(a.stamp,b.stamp);winner=order>0?a:order<0?b:JSON.stringify(a.value)>=JSON.stringify(b.value)?a:b;
   if(key.startsWith('notes.')&&a.value!==b.value){for(const entry of [a,b])history.push({chapter:key.slice(6),...entry});}
  }
  doc.fields[key]=clone(winner);
 }
 doc.history=boundedHistory(history,ids);return doc;
}
export function signature(doc) {
 return JSON.stringify({v:doc.v,clock:doc.clock,fields:Object.fromEntries(Object.entries(doc.fields).sort(([a],[b])=>a<b?-1:1)),history:[...doc.history].sort((a,b)=>a.chapter.localeCompare(b.chapter)||compare(a.stamp,b.stamp))});
}
export class SyncSession {
 constructor({device,ids,doc=emptyDoc(),snapshot,transport,persist=()=>{},apply=()=>{},status=()=>{},readSnapshot=()=>null}) {
  this.device=device;this.ids=ids;this.doc=capture(validateDoc(doc,ids),snapshot,device,ids);this.transport=transport;this.persist=persist;this.apply=apply;this.status=status;this.running=null;this.closed=false;this.readSnapshot=readSnapshot;this.persist(this.doc);
 }
 capture(snapshot){if(this.closed)return;const next=capture(this.doc,snapshot,this.device,this.ids);if(next===this.doc)return;this.doc=next;this.persist(next);this.status('pending');}
 sync(){
  if(this.closed)return Promise.resolve(false);
  if(this.running)return this.running;
  this.running=this.run().catch(()=>{if(!this.closed)this.status('offline');return false;}).finally(()=>{this.running=null;});return this.running;
 }
 async run(){
  this.status('syncing');
  for(let attempt=0;attempt<7;attempt++) {
   const remote=await this.transport.read();if(this.closed)return false;
   const latest=this.readSnapshot();if(latest)this.capture(latest);
   const remoteDoc=remote.doc??emptyDoc();
   this.doc=merge(this.doc,remoteDoc,this.ids);this.persist(this.doc);this.apply(project(this.doc,this.ids),this.doc.history);
   if(signature(this.doc)===signature(remoteDoc)){this.status('synced');return true;}
   const sent=clone(this.doc);const result=await this.transport.write(remote.revision,sent);if(this.closed)return false;
   const latestAfterWrite=this.readSnapshot();if(latestAfterWrite)this.capture(latestAfterWrite);
   if(!result.accepted){this.doc=merge(this.doc,result.doc??emptyDoc(),this.ids);this.persist(this.doc);continue;}
   this.doc=merge(this.doc,sent,this.ids);this.persist(this.doc);this.apply(project(this.doc,this.ids),this.doc.history);
   if(signature(this.doc)===signature(sent)){this.status('synced');return true;}
  }
  this.status('pending');return false;
 }
 close(){this.closed=true;}
}
