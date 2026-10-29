// Google Apps Script relay. Set MAIL_RELAY_SECRET in Script Properties, never in this file.
// Deploy as a Web App: execute as the owner. Recipient is fixed and cannot be overridden.
function doPost(event) {
  const lock=LockService.getScriptLock();
  try {
    if(!event || !event.postData || event.postData.contents.length>32768)throw Error('invalid');
    const body=JSON.parse(event.postData.contents),secret=PropertiesService.getScriptProperties().getProperty('MAIL_RELAY_SECRET');
    if(!secret || typeof body.payload!=='string' || body.payload.length>30000
      || !Number.isSafeInteger(body.timestamp) || Math.abs(Date.now()-body.timestamp)>300000)throw Error('invalid');
    const signature=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body.timestamp+'.'+body.payload,secret)).replace(/=+$/,'');
    if(typeof body.signature!=='string'||signature.length!==body.signature.length)throw Error('invalid');
    let difference=0;for(let i=0;i<signature.length;i++)difference|=signature.charCodeAt(i)^body.signature.charCodeAt(i);
    if(difference)throw Error('invalid');
    const payload=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body.payload)).getDataAsString('UTF-8'));
    if(payload.consent!==true||! /^[A-Za-z0-9_-]{10,100}$/.test(payload.requestId||'')
      || !/^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(payload.email||'')||!payload.name||!payload.message)throw Error('invalid');
    const limits={name:120,email:254,phone:80,city:120,date:30,message:4000,policyVersion:200};
    for(const key in limits)if(typeof payload[key]!=='string'||payload[key].length>limits[key]||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(payload[key]))throw Error('invalid');
    if(!lock.tryLock(10000))return output_({ok:false});
    const props=PropertiesService.getScriptProperties(),key='sent_'+payload.requestId;
    const reference='ES-'+payload.requestId.slice(0,12).toUpperCase();
    if(props.getProperty(key))return output_({ok:true,reference:reference});
    if(MailApp.getRemainingDailyQuota()<1)return output_({ok:false});
    const text='Заявка с eduardshilov.com\nНомер: '+reference+'\n\nИмя: '+payload.name+'\nE-mail: '+payload.email+'\nТелефон: '+payload.phone+'\nГород: '+payload.city+'\nДата: '+payload.date+'\n\n'+payload.message+'\n\nСогласие подтверждено. Версия: '+payload.policyVersion;
    MailApp.sendEmail({to:'troikaband@mail.ru',replyTo:payload.email,subject:'Заявка на выступление — '+reference,body:text});
    // Store only idempotency IDs and timestamps; no copies of visitors' form data.
    props.setProperty(key,String(Date.now()));
    const all=props.getProperties();for(const name in all)if(name.indexOf('sent_')===0&&Number(all[name])<Date.now()-48*3600000)props.deleteProperty(name);
    return output_({ok:true,reference:reference});
  }catch(error){return output_({ok:false});}
  finally{if(lock.hasLock())lock.releaseLock();}
}
function output_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
