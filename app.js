import { SyncSession, emptyDoc, validateDoc } from './sync-core.mjs';
import { createTransport } from './sync-transport.mjs';
'use strict';
const $ = selector => document.querySelector(selector);
let activeKey = null;
let activeManifest = null;
let busy = false;
let syncConfig = null;
let syncSession = null;
let syncTimer = null;
let pollTimer = null;
let stopSync = false;
let localSaveOK = true;
const setSyncStatus = kind => {
 const node=$('#sync-status');node.dataset.state=kind;
 $('#book').contentWindow.TSLabStudy?.setCloudStatus?.(kind);
 if(!localSaveOK && (kind==='pending'||kind==='offline')) {node.textContent='기기 저장 실패 · 메모를 내보내세요';return;}
 node.textContent=({pending:'기기에 저장됨 · 동기화 대기',syncing:'동기화 중…',synced:'모든 변경사항 동기화됨',offline:'기기에 보관 중 · 연결되면 재시도',setup:'이 기기에 저장됨'})[kind] || kind;
};

const decode = text => Uint8Array.from(atob(text), character => character.charCodeAt(0));
async function getManifest() {
 const response = await fetch('vault.json', {cache:'no-store', credentials:'omit'});
 if (!response.ok) throw new Error('자료 정보를 가져오지 못했습니다. 잠시 뒤 다시 시도하세요.');
 const manifest = await response.json();
 if (manifest.version !== 1 || manifest.kdf.name !== 'PBKDF2' || manifest.cipher !== 'AES-GCM') throw new Error('지원하지 않는 자료 형식입니다.');
 return manifest;
}
async function derive(passcode, manifest) {
 const source = await crypto.subtle.importKey('raw',new TextEncoder().encode(passcode),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:decode(manifest.kdf.salt),iterations:manifest.kdf.iterations,hash:'SHA-256'},source,{name:'AES-GCM',length:256},false,['decrypt']);
}
async function decryptAsset(id, manifest, key) {
 const asset = manifest.assets[id];
 const response = await fetch(asset.file,{cache:'no-store',credentials:'omit'});
 if (!response.ok) throw new Error('암호화된 자료를 가져오지 못했습니다.');
 const bytes = await response.arrayBuffer();
 return crypto.subtle.decrypt({name:'AES-GCM',iv:decode(asset.iv),additionalData:new TextEncoder().encode(asset.aad),tagLength:128},key,bytes);
}
$('#unlock-form').addEventListener('submit',async event => {
 event.preventDefault(); if (busy) return;
 if (!crypto.subtle) { $('#status').textContent='HTTPS 주소로 접속하고 최신 브라우저를 사용해 주세요.';return; }
 busy=true; $('#unlock').disabled=true; $('#passcode').disabled=true; $('#status').textContent='자료를 여는 중…';
 try {
  const manifest = await getManifest();
  const key = await derive($('#passcode').value.trim(),manifest);
  const [plaintext, encryptedConfig] = await Promise.all([
   decryptAsset('book',manifest,key), manifest.assets.sync ? decryptAsset('sync',manifest,key) : Promise.resolve(null)
  ]);
  syncConfig=encryptedConfig?JSON.parse(new TextDecoder().decode(encryptedConfig)):null;
  activeKey=key;activeManifest=manifest;
  $('#passcode').value='';
  $('#book').srcdoc=new TextDecoder('utf-8',{fatal:true}).decode(plaintext);
  $('#gate').hidden=true; $('#room').hidden=false; $('#status').textContent='';
  document.title='TS/LAB · TypeScript 학습실';
 } catch(error) {
  $('#status').textContent=error?.name === 'OperationError' ? 'passcode가 맞지 않거나 자료가 손상되었습니다. 다시 확인해 주세요.' : (error instanceof Error ? error.message : '자료를 열지 못했습니다.');
  $('#passcode').disabled=false;$('#passcode').focus();$('#passcode').select();
 } finally {busy=false;$('#unlock').disabled=false;$('#passcode').disabled=false;}
});
$('#download').addEventListener('click',async () => {
 if (!activeKey || !activeManifest) return;
 const button=$('#download');button.disabled=true;$('#download-status').textContent='ZIP 잠금을 해제하는 중…';
 try {
  const bytes=await decryptAsset('zip',activeManifest,activeKey);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
  const link=document.createElement('a');link.href=url;link.download='TypeScript-실습자료-전체.zip';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('#download-status').textContent='ZIP 다운로드를 시작했습니다.';
 } catch(error) {$('#download-status').textContent=error instanceof Error ? error.message : '다운로드 실패';}
 finally {button.disabled=false;}
});
$('#lock').addEventListener('click',async()=>{
 $('#lock').disabled=true;
 if(syncSession) await Promise.race([syncSession.sync(),new Promise(resolve=>setTimeout(resolve,4000))]);
 stopSync=true;syncSession?.close();clearTimeout(syncTimer);clearInterval(pollTimer);
 activeKey=null;activeManifest=null;syncConfig=null;$('#book').removeAttribute('srcdoc');location.reload();
});
// Back-forward cache must not restore an unlocked document from memory.
window.addEventListener('pageshow',event=>{if(event.persisted) location.reload();});

function readLocal(key,fallback) {try {const value=localStorage.getItem(key);return value===null?fallback:JSON.parse(value);}catch{return fallback;}}
function writeLocal(key,value) {try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
async function beginSync(){
 if(!syncConfig){setSyncStatus('setup');return;}
 const api=$('#book').contentWindow.TSLabStudy;
 if(!api)return;
 const ids=api.ids;
 const storeKey=`ts-lab-sync-v2:${syncConfig.projectId}`;
 let device=readLocal('ts-lab-sync-device',null);
 if(typeof device!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(device)){device=crypto.randomUUID();writeLocal('ts-lab-sync-device',device);}
 let doc=emptyDoc();try{doc=validateDoc(readLocal(storeKey,emptyDoc()),ids);}catch{}
 try{
  const transport=await createTransport(syncConfig,ids);
  syncSession=new SyncSession({device,ids,doc,snapshot:api.getState(),transport,
   persist:doc=>{localSaveOK=writeLocal(storeKey,doc);},readSnapshot:()=>api.getState(),
   apply:(state,history)=>{if(stopSync)return;api.applyRemote(state,history);},status:setSyncStatus});
  $('#sync-now').disabled=false;
  await syncSession.sync();
  pollTimer=setInterval(()=>{if(document.visibilityState==='visible'&&!stopSync)syncSession.sync();},15000);
 }catch{setSyncStatus('offline');}
}
$('#book').addEventListener('load',()=>{if(activeKey&&!stopSync)beginSync();});
window.addEventListener('message',event=>{
 if(event.source!==$('#book').contentWindow||event.origin!==location.origin||event.data?.type!=='tslab:changed'||!syncSession||stopSync)return;
 const api=$('#book').contentWindow.TSLabStudy;
 syncSession.capture(api.getState());clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncSession.sync(),1000);
});
$('#sync-now').addEventListener('click',()=>{clearTimeout(syncTimer);syncSession?.sync();});
window.addEventListener('online',()=>syncSession?.sync());
document.addEventListener('visibilitychange',()=>{if(syncSession&&!stopSync)syncSession.sync();});
window.addEventListener('focus',()=>{if(syncSession&&!stopSync)syncSession.sync();});
