export const fileIdPattern = /^[A-Za-z0-9_-]{10,160}$/;
export const allowedMime = /^(?:image\/(?:jpeg|png|webp|gif|avif)|audio\/(?:mpeg|wav|x-wav|mp4|ogg|flac)|video\/(?:mp4|webm|quicktime)|application\/(?:pdf|zip|rtf|vnd.openxmlformats-officedocument.wordprocessingml.document))$/;

export function base64url(bytes) {
  let text=''; for(const byte of new Uint8Array(bytes)) text+=String.fromCharCode(byte);
  return btoa(text).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
export function unbase64url(value) {
  if(!/^[A-Za-z0-9_-]+$/.test(value)) throw Error('invalid encoding');
  const text=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(text,c=>c.charCodeAt(0));
}
export function jsonBytes(value) { return new TextEncoder().encode(JSON.stringify(value)); }
export function decodeFirestore(value) {
  if(value.stringValue !== undefined) return value.stringValue;
  if(value.booleanValue !== undefined) return value.booleanValue;
  if(value.integerValue !== undefined) return Number(value.integerValue);
  if(value.doubleValue !== undefined) return value.doubleValue;
  if(value.timestampValue !== undefined) return value.timestampValue;
  if(value.nullValue !== undefined) return null;
  if(value.arrayValue) return (value.arrayValue.values||[]).map(decodeFirestore);
  if(value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,decodeFirestore(v)]));
  return null;
}
export function docFields(doc) { return Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decodeFirestore(v)])); }
export function rangeValid(range) {
  if(!range) return true;
  const m=/^bytes=(\d*)-(\d*)$/.exec(range);
  if(!m||(!m[1]&&!m[2])) return false;
  if(!m[1]) return Number(m[2])>0 && Number.isSafeInteger(Number(m[2]));
  return Number.isSafeInteger(Number(m[1])) && (!m[2] || (Number.isSafeInteger(Number(m[2]))&&Number(m[2])>=Number(m[1])));
}
export function contentDisposition(name,attachment=false) {
  const safe=String(name||'media').replace(/[\r\n\x00-\x1f]/g,'').slice(0,240);
  const fallback=safe.replace(/[^A-Za-z0-9._-]/g,'_')||'media';
  const encoded=encodeURIComponent(safe).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return `${attachment?'attachment':'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
export function origins(env) { return String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean); }
export function validMedia(record,id) {
  return record?.published===true && record.driveId===id && fileIdPattern.test(id)
    && typeof record.name==='string' && allowedMime.test(record.mime||'')
    && Number.isSafeInteger(Number(record.size)) && Number(record.size)>0;
}
export function validateApplication(body,policyVersion) {
  if(!body || body.consent!==true || body.policyVersion!==policyVersion || body.website) return null;
  if(typeof body.requestId!=='string'||! /^[A-Za-z0-9_-]{10,100}$/.test(body.requestId)) return null;
  const result={requestId:body.requestId,policyVersion,consent:true};
  for(const [key,max] of Object.entries({name:120,email:254,phone:80,city:120,date:30,message:4000})) {
    if(typeof body[key]!=='string'||body[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body[key])) return null;
    result[key]=body[key].trim();
  }
  if(!result.name || !/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(result.email) || !result.message) return null;
  return result;
}
