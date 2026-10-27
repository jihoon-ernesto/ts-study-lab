'use strict';
const $ = selector => document.querySelector(selector);
let activeKey = null;
let activeManifest = null;
let busy = false;
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
  const plaintext = await decryptAsset('book',manifest,key);
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
$('#lock').addEventListener('click',()=>{
 activeKey=null;activeManifest=null;$('#book').removeAttribute('srcdoc');location.reload();
});
// Back-forward cache must not restore an unlocked document from memory.
window.addEventListener('pageshow',event=>{if(event.persisted) location.reload();});
