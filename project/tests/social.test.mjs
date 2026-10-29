import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSocial,validateSocialPost,socialConfiguration} from '../worker/src/social.mjs';
const env={PROJECT_ID:'test-project-1',TELEGRAM_BOT_TOKEN:'test-server-only-token',TELEGRAM_1_CHANNEL_ID:'@artist_channel',VK_ACCESS_TOKEN:'test-vk-token',VK_TROIKA_GROUP_ID:'123456',TELEGRAM_2_CHANNEL_ID:'-1002222222',VK_EDUARD_GROUP_ID:'654321'};
const payload=()=>({requestId:crypto.randomUUID(),text:'Новая песня <без HTML> & концерт',url:'https://eduardshilov.com/music.html',channels:['telegram_1','vk_troika'],confirmed:true});
const request=(path='/api/admin/social',method='POST')=>new Request('https://worker.example'+path,{method,headers:{Authorization:'Bearer owner-test-token'}});
function mock(options={}){
  const docs=new Map(),sends=[];
  async function net(url,init={}){
    url=String(url);
    if(url.startsWith('https://firestore.googleapis.com/')){
      assert.equal(init.headers.Authorization,'Bearer owner-test-token');
      if(url.endsWith(':runQuery'))return Response.json([...docs.values()].map(fields=>({document:{fields}})));
      const id=new URL(url).searchParams.get('documentId')||url.split('/').at(-1).split('?')[0];
      if(init.method==='POST'){
        if(options.noHistory)return new Response(null,{status:403});
        if(docs.has(id))return new Response(null,{status:409});
        docs.set(id,JSON.parse(init.body).fields);return Response.json({});
      }
      if(init.method==='PATCH'){
        if(options.journalFails)throw Error('lost journal connection');
        const field=new URL(url).searchParams.get('updateMask.fieldPaths').split('.')[1];
        const patch=JSON.parse(init.body).fields;docs.get(id).results.mapValue.fields[field]=patch.results.mapValue.fields[field];return Response.json({});
      }
      return Response.json({fields:docs.get(id)});
    }
    sends.push({url,init});
    if(options.networkUnknown)throw Error('network lost with token '+env.TELEGRAM_BOT_TOKEN);
    if(url.includes('api.telegram.org'))return Response.json({ok:true,result:{message_id:42}});
    assert.equal(url,'https://api.vk.com/method/wall.post');assert.ok(['-123456','-654321'].includes(init.body.get('owner_id')));assert.equal(init.body.get('from_group'),'1');assert.equal(init.body.get('v'),'5.199');
    return Response.json(options.vkFails?{error:{error_code:15,error_msg:'includes secret '+env.VK_ACCESS_TOKEN,request_params:[{key:'access_token',value:env.VK_ACCESS_TOKEN}]}}:{response:{post_id:84}});
  }
  return {net,sends,docs};
}
test('Composer validates confirmation, length, public URLs and fixed destination selection',()=>{
  assert.ok(validateSocialPost(payload()));
  for(const changed of [{confirmed:false},{text:' '},{text:'x'.repeat(4097)},{url:'javascript:alert(1)'},{url:'https://password:secret@example.com'},{channels:['telegram_1','telegram_1']},{channels:['other']},{channel_id:'@attacker'},{owner_id:'-42'},{requestId:'bad'}])assert.equal(validateSocialPost({...payload(),...changed}),null);
  assert.equal(JSON.stringify(socialConfiguration(env)).includes(env.TELEGRAM_BOT_TOKEN),false);
  assert.equal(JSON.stringify(socialConfiguration({...env,TELEGRAM_1_CHANNEL_ID:'123456:accidentally-pasted-secret',VK_TROIKA_GROUP_ID:'accidentally-pasted-secret'})).includes('accidentally-pasted-secret'),false);
});
test('An unconfigured destination or unavailable journal sends nothing',async()=>{
  const m=mock();assert.equal((await handleSocial(request(),{...env,VK_ACCESS_TOKEN:''},m.net,payload())).status,503);assert.equal(m.sends.length,0);
  const missing=mock({noHistory:true});assert.equal((await handleSocial(request(),env,missing.net,payload())).status,503);assert.equal(missing.sends.length,0);
});
test('Disabled VK destinations reject direct requests even with valid configured credentials',async()=>{
  const settings={...env,SOCIAL_TARGETS:'telegram_1,telegram_2'},m=mock();
  assert.equal(socialConfiguration(settings).vk_troika.enabled,false);
  assert.equal(socialConfiguration(settings).vk_troika.configured,false);
  assert.equal((await handleSocial(request(),settings,m.net,payload())).status,503);
  assert.equal(m.docs.size,0);assert.equal(m.sends.length,0);
  const result=await(await handleSocial(request(),settings,m.net,{...payload(),channels:['telegram_1','telegram_2']})).json();
  assert.equal(result.post.results.telegram_1.state,'sent');assert.equal(result.post.results.telegram_2.state,'sent');
  assert.equal(m.sends.length,2);assert.ok(m.sends.every(x=>x.url.startsWith('https://api.telegram.org/')));
});
test('Publications send plain text to the fixed destinations, with separate recorded successes',async()=>{
  const m=mock(),p=payload();const result=await(await handleSocial(request(),env,m.net,p)).json();
  assert.equal(result.post.results.telegram_1.state,'sent');assert.equal(result.post.results.vk_troika.state,'sent');assert.equal(m.sends.length,2);
  const tg=JSON.parse(m.sends[0].init.body);assert.equal(tg.chat_id,'@artist_channel');assert.equal(tg.text,p.text+'\n\n'+p.url);assert.equal(tg.parse_mode,undefined);
  assert.equal(m.sends[1].init.body.get('access_token'),env.VK_ACCESS_TOKEN);assert.equal(m.sends[1].init.body.get('guid'),p.requestId+'_vk_troika');
});
test('A double click across concurrent worker calls claims a request once; replay cannot change its content',async()=>{
  const m=mock(),p=payload();await Promise.all([handleSocial(request(),env,m.net,p),handleSocial(request(),env,m.net,p)]);
  assert.equal(m.sends.length,2);
  const again=await(await handleSocial(request(),env,m.net,p)).json();assert.equal(again.reused,true);assert.equal(again.post.results.telegram_1.state,'sent');
  assert.equal((await handleSocial(request(),env,m.net,{...p,text:'Different'})).status,409);assert.equal(m.sends.length,2);
});
test('Partial failures preserve success and return only safe provider error codes',async()=>{
  const m=mock({vkFails:true}),p=payload();const result=await(await handleSocial(request(),env,m.net,p)).json();
  assert.equal(result.post.results.telegram_1.state,'sent');assert.equal(result.post.results.vk_troika.state,'failed');assert.equal(result.post.results.vk_troika.code,15);
  assert.equal(JSON.stringify(result).includes(env.VK_ACCESS_TOKEN),false);
  await handleSocial(request(),env,m.net,p);assert.equal(m.sends.length,2);
});
test('An uncertain provider outcome is recorded and never automatically retried',async()=>{
  const m=mock({networkUnknown:true}),p={...payload(),channels:['telegram_1']};
  const result=await(await handleSocial(request(),env,m.net,p)).json();assert.equal(result.post.results.telegram_1.state,'unknown');assert.equal(JSON.stringify(result).includes(env.TELEGRAM_BOT_TOKEN),false);
  await handleSocial(request(),env,m.net,p);assert.equal(m.sends.length,1);
});
test('A journal failure after sending stops before the next destination; replay remains blocked',async()=>{
  const m=mock({journalFails:true}),p=payload();const result=await(await handleSocial(request(),env,m.net,p)).json();
  assert.equal(result.post.results.telegram_1.state,'sent');assert.equal(result.post.results.vk_troika.state,'pending');assert.ok(result.journalWarning);assert.equal(m.sends.length,1);
  await handleSocial(request(),env,m.net,p);assert.equal(m.sends.length,1);
});
test('History is loaded with owner credentials and bounded to 20 posts',async()=>{
  const m=mock();await handleSocial(request(),env,m.net,payload());
  const result=await(await handleSocial(request('/api/admin/social/history','GET'),env,m.net)).json();assert.equal(result.posts.length,1);assert.equal(result.posts[0].results.vk_troika.state,'sent');
});
test('A full history page can contain 20 posts at the supported text limit',async()=>{
  const m=mock();for(let i=0;i<20;i++)await handleSocial(request(),env,m.net,{...payload(),text:'Я'.repeat(4000),url:'',channels:['telegram_1']});
  const result=await(await handleSocial(request('/api/admin/social/history','GET'),env,m.net)).json();assert.equal(result.posts.length,20);assert.equal(result.posts[19].text.length,4000);
});

test('All four destinations retain distinct IDs and VK idempotency keys in one post',async()=>{
  const m=mock(),p={...payload(),channels:['telegram_1','telegram_2','vk_troika','vk_eduard']};
  const result=await(await handleSocial(request(),env,m.net,p)).json();
  assert.equal(m.sends.length,4);assert.deepEqual(m.sends.slice(0,2).map(x=>JSON.parse(x.init.body).chat_id),['@artist_channel','-1002222222']);
  assert.deepEqual(m.sends.slice(2).map(x=>x.init.body.get('owner_id')),['-123456','-654321']);
  assert.notEqual(m.sends[2].init.body.get('guid'),m.sends[3].init.body.get('guid'));
  assert.equal(Object.values(result.post.results).every(x=>x.state==='sent'),true);
  assert.equal(result.post.destinations.telegram_2.id,'-1002222222');assert.equal(result.post.destinations.vk_eduard.id,'654321');
  assert.equal(JSON.stringify(result).includes(env.VK_ACCESS_TOKEN),false);
  const again=await(await handleSocial(request(),{...env,VK_EDUARD_GROUP_ID:'999999'},m.net,p)).json();
  assert.equal(m.sends.length,4);assert.equal(again.post.destinations.vk_eduard.id,'654321');
});
test('Unchecked recipients stay untouched and per-group credentials remain server-side',async()=>{
  const m=mock(),p={...payload(),channels:['telegram_2','vk_eduard']},settings={...env,VK_EDUARD_ACCESS_TOKEN:'separate-eduard-secret'};
  const result=await(await handleSocial(request(),settings,m.net,p)).json();
  assert.equal(m.sends.length,2);assert.equal(JSON.parse(m.sends[0].init.body).chat_id,'-1002222222');assert.equal(m.sends[1].init.body.get('owner_id'),'-654321');
  assert.equal(m.sends[1].init.body.get('access_token'),'separate-eduard-secret');assert.equal(JSON.stringify(result).includes('separate-eduard-secret'),false);
});
test('Aliased destination slots cannot publish twice into the same configured chat',async()=>{
  const m=mock(),p={...payload(),channels:['telegram_1','telegram_2']};
  const result=await handleSocial(request(),{...env,TELEGRAM_2_CHANNEL_ID:env.TELEGRAM_1_CHANNEL_ID},m.net,p);assert.equal(result.status,400);assert.equal(m.sends.length,0);assert.equal(m.docs.size,0);
});
test('Telegram username case cannot bypass duplicate destination detection',async()=>{
  const m=mock(),p={...payload(),channels:['telegram_1','telegram_2']};
  const result=await handleSocial(request(),{...env,TELEGRAM_1_CHANNEL_ID:'@Artist_Channel',TELEGRAM_2_CHANNEL_ID:'@artist_channel'},m.net,p);
  assert.equal(result.status,400);assert.equal(m.sends.length,0);assert.equal(m.docs.size,0);
});

test('Telegram photos and videos are multipart attachments; replay cannot substitute another file',async()=>{
  for(const [name,type,method,field] of [['cover.png','image/png','sendPhoto','photo'],['clip.mp4','video/mp4','sendVideo','video']]){
    const m=mock(),p={...payload(),text:'Подпись',url:'',channels:['telegram_1','telegram_2']},file=new File(['fixture-media'],name,{type});
    const result=await(await handleSocial(request(),env,m.net,p,file)).json();
    assert.equal(result.post.attachment.kind,field);assert.equal(result.post.attachment.sha256.length,64);assert.equal(m.sends.length,2);
    for(const sent of m.sends){assert.ok(sent.url.endsWith('/'+method));assert.ok(sent.init.body instanceof FormData);assert.equal(sent.init.body.get(field).name,name);assert.equal(sent.init.body.get('caption'),'Подпись');assert.equal(sent.init.headers['Content-Type'],undefined);}
    const again=await(await handleSocial(request(),env,m.net,p,file)).json();assert.equal(again.reused,true);assert.equal(m.sends.length,2);
    assert.equal((await handleSocial(request(),env,m.net,p,new File(['different'],name,{type}))).status,409);assert.equal(m.sends.length,2);
    assert.equal((await handleSocial(request(),env,m.net,p)).status,409);
  }
});

test('Attachment limits, formats, caption limits and VK selections fail before a provider call',async()=>{
  const m=mock(),p={...payload(),channels:['telegram_1'],url:''};
  await assert.rejects(handleSocial(request(),env,m.net,p,new File(['x'],'bad.svg',{type:'image/svg+xml'})),/JPG/);
  const huge=new File(['x'],'large.png',{type:'image/png'});Object.defineProperty(huge,'size',{value:11*1024*1024});
  await assert.rejects(handleSocial(request(),env,m.net,p,huge),/10 МБ/);
  const file=new File(['x'],'cover.jpg',{type:'image/jpeg'});
  assert.equal((await handleSocial(request(),env,m.net,{...p,text:'x'.repeat(1025)},file)).status,400);
  assert.equal((await handleSocial(request(),env,m.net,{...p,channels:['vk_troika']},file)).status,400);assert.equal(m.sends.length,0);
  const withoutCaption=await(await handleSocial(request(),env,m.net,{...p,text:''},file)).json();assert.equal(withoutCaption.post.results.telegram_1.state,'sent');
});
