export const photoLimit=10*1024*1024,videoLimit=20*1024*1024;
const fail=message=>Object.assign(Error(message),{status:400,publicMessage:message});
export async function socialMultipart(request){
  const limit=videoLimit+65536;
  if(Number(request.headers.get('Content-Length'))>limit)throw fail('Вложение слишком большое. Фото — до 10 МБ, видео — до 20 МБ.');
  const reader=request.body?.getReader();if(!reader)throw fail('Не получен файл публикации.');let size=0;
  const stream=new ReadableStream({async pull(controller){try{const next=await reader.read();if(next.done){reader.releaseLock();controller.close();return;}size+=next.value.byteLength;if(size>limit){await reader.cancel();controller.error(fail('Вложение превышает допустимый размер.'));return;}controller.enqueue(next.value);}catch(error){controller.error(error);}},cancel(reason){return reader.cancel(reason);}});
  const form=await new Response(stream,{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();
  if([...form.keys()].some(key=>!['post','media'].includes(key))||form.getAll('post').length!==1||form.getAll('media').length!==1)throw fail('Проверьте файл публикации.');
  const raw=form.get('post'),file=form.get('media');if(typeof raw!=='string'||raw.length>20000)throw fail('Слишком большой текст публикации.');
  let body;try{body=JSON.parse(raw);}catch{throw fail('Некорректный текст публикации.');}
  return {body,file};
}
export async function attachmentMetadata(file){
  if(!file)return null;
  if(typeof file.arrayBuffer!=='function'||typeof file.name!=='string'||file.size<=0)throw fail('Выберите картинку или видео.');
  const kind=['image/jpeg','image/png'].includes(file.type)?'photo':file.type==='video/mp4'?'video':null;
  if(!kind)throw fail('Для Telegram выберите JPG, PNG или MP4.');
  if(file.size>(kind==='photo'?photoLimit:videoLimit))throw fail(kind==='photo'?'Картинка должна быть не больше 10 МБ.':'Видео должно быть не больше 20 МБ.');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
  return {kind,name:file.name.replace(/[\x00-\x1f]/g,'').slice(0,160),mime:file.type,size:file.size,sha256};
}
