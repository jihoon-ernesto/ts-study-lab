import { validateDoc } from './sync-core.mjs';
const encoder=new TextEncoder();
export const b64=bytes=>{let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);};
export const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const decodeKey=text=>unb64(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));
export async function createTransport(config,ids,fetcher=fetch) {
 if(!/^https:\/\/[a-z]+\.supabase\.co$/.test(config.url)||!/^sb_publishable_/.test(config.publishableKey)||!/^[-_a-zA-Z0-9]{43}$/.test(config.token))throw new Error('동기화 설정이 올바르지 않습니다.');
 const key=await crypto.subtle.importKey('raw',decodeKey(config.dataKey),{name:'AES-GCM'},false,['encrypt','decrypt']);
 async function rpc(name,body){
  const response=await fetcher(`${config.url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({p_token:config.token,...body}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`동기화 연결 오류 (${response.status})`);
  return response.json();
 }
 async function decrypt(payload){
  if(payload===null)return null;
  if(payload?.v!==1||typeof payload.iv!=='string'||typeof payload.ciphertext!=='string')throw new Error('동기화 데이터가 올바르지 않습니다.');
  const text=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv),additionalData:encoder.encode('ts-study-sync-v2')},key,unb64(payload.ciphertext));
  return validateDoc(JSON.parse(new TextDecoder().decode(text)),ids);
 }
 return {
  async read(){const value=await rpc('read_study_state',{});return{revision:value.revision,doc:await decrypt(value.payload)};},
  async write(revision,doc){
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('ts-study-sync-v2')},key,encoder.encode(JSON.stringify(doc)));
   const payload={v:1,iv:b64(iv),ciphertext:b64(new Uint8Array(ciphertext))};
   const value=await rpc('write_study_state',{p_revision:revision,p_payload:payload});
   return{accepted:value.accepted,revision:value.revision,...(!value.accepted?{doc:await decrypt(value.payload)}:{})};
  }
 };
}
