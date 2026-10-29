export function localDate(date=new Date()){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
export function titleFromFile(name){return String(name).replace(/\.[^.]+$/,'').replace(/_+/g,' ').replace(/\s+/g,' ').trim().slice(0,300);}
export function formatSize(size){if(!Number.isFinite(size)||size<0)return '';return size>=1024*1024?(size/1024/1024).toFixed(1)+' МБ':Math.max(1,Math.round(size/1024))+' КБ';}
export function mediaURL(value,workerOrigin,siteOrigin){
  if(!value)return '';
  try{
    const base=new URL(workerOrigin),url=new URL(value,siteOrigin);
    if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)return '';
    if(url.username||url.password||![siteOrigin,base.origin].includes(url.origin)||!/^\/media\/[A-Za-z0-9_-]{10,160}(?:\/[^/]+)?$/.test(url.pathname))return '';
    return base.origin+url.pathname+url.search;
  }catch{return '';}
}
export class DriveSession{
  constructor({storage=null,key='edStudioDrive',now=()=>Date.now()}={}){this.storage=storage;this.key=key;this.now=now;this.owner='';this.accessToken='';this.ready=false;this.generation=0;this.expiresAt=0;}
  setOwner(uid){if(this.owner!==uid){const previous=this.owner;this.owner=uid;this.clear(!!previous||!uid);}}
  clear(removeSaved=true){this.accessToken='';this.ready=false;this.expiresAt=0;this.generation++;if(removeSaved)try{this.storage?.removeItem(this.key);}catch{}}
  saved(uid){try{const value=JSON.parse(this.storage?.getItem(this.key)||'null');if(value?.uid===uid&&typeof value.accessToken==='string'&&value.accessToken.length<12000&&value.expiresAt>this.now()+60000)return value;this.storage?.removeItem(this.key);}catch{}return null;}
  begin(uid,accessToken,expiresAt=this.now()+50*60*1000){if(!uid||uid!==this.owner||!accessToken)throw Error('Подключение Диска не подтверждено.');this.accessToken=accessToken;this.expiresAt=expiresAt;this.ready=false;return ++this.generation;}
  finish(generation){if(generation!==this.generation||!this.owner)return false;this.ready=true;try{this.storage?.setItem(this.key,JSON.stringify({uid:this.owner,accessToken:this.accessToken,expiresAt:this.expiresAt}));}catch{}return true;}
  token(){if(this.accessToken&&this.expiresAt<=this.now()){this.clear();throw Object.assign(Error('Срок доступа Google истёк. Нажмите «Подключить Диск».'),{code:'DRIVE_AUTH_REQUIRED'});}if(!this.accessToken||!this.ready)throw Error('Подтвердите доступ к Диску кнопкой «Подключить Диск».');return this.accessToken;}
}
