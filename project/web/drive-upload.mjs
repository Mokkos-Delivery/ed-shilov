const chunkSize=8*1024*1024;
export function receivedOffset(header,total) {
  if(!header)return 0;
  const match=/^bytes=0-(\d+)$/.exec(header);
  if(!match)throw Error('Некорректный ответ о загрузке.');
  const offset=Number(match[1])+1;
  if(!Number.isSafeInteger(offset)||offset<0||offset>total)throw Error('Некорректный ответ о загрузке.');
  return offset;
}
function sessionURL(value) {
  const url=new URL(value);
  if(url.origin!=='https://www.googleapis.com'||url.username||url.password||url.hash||url.pathname!=='/upload/drive/v3/files')throw Error('Некорректный адрес загрузки.');
  return url.href;
}
async function uploadFailure(response,stage){
  let reason='';try{const value=await response.json();const code=value.error?.errors?.[0]?.reason||value.error?.status;if(/^[A-Za-z_]{1,80}$/.test(code||''))reason='; '+code;}catch{}
  const explanation=response.status===403?' Google не разрешил запись в папку. Проверьте выбранный аккаунт и разрешение на файлы.':response.status===507?' На Диске закончилось место.':'';
  return Error(stage+' [Drive HTTP '+response.status+reason+'].'+explanation);
}
export class DriveUpload {
  constructor(file,folderId,getToken,{net=fetch,onProgress=()=>{},signal,checkpoint=()=>{},saved=null}={}) {
    if(!file?.size||! /^[A-Za-z0-9_-]{10,160}$/.test(folderId))throw Error('Укажите файл и папку публикаций.');
    // Native Window.fetch must never receive the DriveUpload instance as `this`.
    this.file=file;this.folderId=folderId;this.getToken=getToken;this.net=(url,options)=>Reflect.apply(net,globalThis,[url,options]);this.progress=onProgress;this.signal=signal;this.session=null;this.completed=saved?.completed||null;this.fileId=saved?.fileId||null;this.checkpoint=checkpoint;
  }
  remember(){this.checkpoint({fileId:this.fileId,completed:this.completed});}
  async request(url,options) {
    if(this.signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const result=await this.net(url,{...options,headers:{Authorization:'Bearer '+this.getToken(),...options.headers},signal:this.signal,redirect:'error'});
    if(result.status===401)throw Object.assign(Error('Повторите подключение Google Диска и продолжите загрузку.'),{code:'DRIVE_AUTH_REQUIRED'});
    return result;
  }
  async start() {
    // Allocate the ID before any create request. A lost POST response must never
    // lead to another file with a different ID, including after a page reload.
    if(!this.fileId){
      const ids=await this.request('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files',{method:'GET'});
      if(!ids.ok)throw await uploadFailure(ids,'Не удалось подготовить загрузку');
      this.fileId=(await ids.json()).ids?.[0];
      if(!/^[A-Za-z0-9_-]{10,160}$/.test(this.fileId||''))throw Error('Диск не выдал идентификатор файла.');
      this.remember();
    }else if(await this.reconcile())return;
    const r=await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,parents',{
      method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':this.file.type||'application/octet-stream','X-Upload-Content-Length':String(this.file.size)},
      body:JSON.stringify({id:this.fileId,name:this.file.name,mimeType:this.file.type||'application/octet-stream',parents:[this.folderId]})
    });
    if(r.status===409&&await this.reconcile())return;
    if(!r.ok)throw await uploadFailure(r,'Не удалось создать файл');
    if(!r.headers.get('Location'))throw Error('Диск не вернул адрес продолжения загрузки.');
    this.session=sessionURL(r.headers.get('Location'));
  }
  async reconcile(){
    const r=await this.request('https://www.googleapis.com/drive/v3/files/'+this.fileId+'?fields=id,name,mimeType,size,parents',{method:'GET'});
    if(r.status===404)return false;
    if(!r.ok)throw await uploadFailure(r,'Не удалось проверить предыдущую загрузку');
    this.completed=await r.json();this.verifiedResult();this.remember();return true;
  }
  async status() {
    const r=await this.request(this.session,{method:'PUT',headers:{'Content-Range':'bytes */'+this.file.size},body:new Uint8Array()});
    if(r.status===200||r.status===201){this.completed=await r.json();this.remember();return this.file.size;}
    if(r.status===308)return receivedOffset(r.headers.get('Range'),this.file.size);
    if(r.status===401)throw Error('Повторите подключение Google Диска и нажмите «Продолжить загрузку».');
    if(r.status===404||r.status===410){this.session=null;if(await this.reconcile())return this.file.size;throw Error('Сессия загрузки истекла. Повторите загрузку: идентификатор файла сохранён.');}
    throw Error('Не удалось проверить загруженный фрагмент ('+r.status+').');
  }
  async run() {
    if(this.completed)return this.verifiedResult();
    const hadSession=!!this.session;if(!this.session)await this.start();
    if(this.completed)return this.verifiedResult();
    let offset=hadSession?await this.status():0,failures=0;
    while(offset<this.file.size) {
      this.progress(offset,this.file.size);
      const end=Math.min(offset+chunkSize,this.file.size);
      let r;
      try {r=await this.request(this.session,{method:'PUT',headers:{'Content-Type':this.file.type||'application/octet-stream','Content-Range':`bytes ${offset}-${end-1}/${this.file.size}`},body:this.file.slice(offset,end)});}
      catch(error){if(error.name==='AbortError'||error.code==='DRIVE_AUTH_REQUIRED'||++failures>4)throw error;await this.delay(failures);offset=await this.status();continue;}
      if(r.status===200||r.status===201){this.completed=await r.json();this.remember();break;}
      if(r.status===308){const acknowledged=receivedOffset(r.headers.get('Range'),this.file.size);if(acknowledged<=offset&&++failures>4)throw Error('Диск не подтверждает получение фрагмента.');if(acknowledged>offset)failures=0;offset=acknowledged;continue;}
      if(r.status===429||r.status>=500){if(++failures>4)throw Error('Диск временно недоступен. Продолжите загрузку позже.');await this.delay(failures);offset=await this.status();continue;}
      if(r.status===401)throw Error('Повторите подключение Google Диска и продолжите загрузку.');
      throw await uploadFailure(r,'Не удалось передать файл');
    }
    const result=this.verifiedResult();this.progress(this.file.size,this.file.size);return result;
  }
  verifiedResult(){
    if(!this.completed)throw Error('Диск не подтвердил завершение загрузки.');
    if(Number(this.completed.size)!==this.file.size||!this.completed.id)throw Error('Размер файла после загрузки не совпадает.');
    if(this.completed.id!==this.fileId)throw Error('Диск подтвердил другой файл. Материал не опубликован.');
    return this.completed;
  }
  delay(attempt){return new Promise((resolve,reject)=>{const signal=this.signal;if(signal?.aborted){reject(new DOMException('Cancelled','AbortError'));return;}const abort=()=>{clearTimeout(id);reject(new DOMException('Cancelled','AbortError'));};const id=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},Math.min(1000*2**attempt,16000));signal?.addEventListener('abort',abort,{once:true});});}
}
