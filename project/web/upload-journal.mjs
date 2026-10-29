// No OAuth tokens, resumable URLs or file bytes are stored here.
// Browser file selection cannot survive a reload; matching files reuse the IDs.
export class UploadJournal{
  constructor(storage,key){this.storage=storage;this.key=key;}
  read(){try{const value=JSON.parse(this.storage?.getItem(this.key)||'null');return value?.version===1&&value.id&&value.slots?value:null;}catch{return null;}}
  write(value){try{if(!this.storage)throw Error('no storage');this.storage.setItem(this.key,JSON.stringify({...value,version:1}));}catch{throw Error('Не удалось сохранить номер загрузки в браузере. Разрешите хранилище сайта перед загрузкой.');}}
  clear(){try{this.storage?.removeItem(this.key);}catch{}}
}
export async function fileIdentity(file){
  const sample=new Uint8Array(await new Blob([file.slice(0,65536),file.slice(Math.max(65536,file.size-65536))]).arrayBuffer());
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sample)),x=>x.toString(16).padStart(2,'0')).join('');
  return JSON.stringify([file.name,file.size,file.type,file.lastModified,hash]);
}
