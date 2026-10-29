import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initSocialComposer} from '../web/social-composer.mjs';
test('Composer previews a local attachment, enforces caption length and sends multipart rather than a Drive URL',async()=>{
  class Node{
    constructor(){this.value='';this.checked=false;this.files=[];this.attrs={};this.children=[];this.events={};}
    addEventListener(type,fn){this.events[type]=fn;}replaceChildren(...x){this.children=x;}append(...x){this.children.push(...x);}closest(){return new Node();}scrollIntoView(){}reportValidity(){return true;}pause(){}removeAttribute(key){delete this.attrs[key];}set src(value){this.attrs.src=value;}get src(){return this.attrs.src;}
  }
  const nodes=new Map([...fs.readFileSync('web/admin.html','utf8').matchAll(/\bid="([^"]+)"/g)].map(x=>[x[1],new Node()]));
  nodes.get('social-form').reset=()=>{for(const node of nodes.values()){node.value='';node.checked=false;node.files=[];}};
  const old=globalThis.document;globalThis.document={getElementById:id=>nodes.get(id),createElement:()=>new Node(),createTextNode:text=>text};const calls=[];
  try{
    const composer=initSocialComposer(async(path,body,method)=>{
      if(method==='POST'){calls.push(body);const p=JSON.parse(body.get('post'));return {post:{...p,results:{telegram_1:{state:'sent',postId:'42'}},destinations:{telegram_1:{platform:'telegram',id:'-1003968794089',label:'Канал'}}}};}
      return path.endsWith('/history')?{posts:[]}:{channels:{telegram_1:{platform:'telegram',id:'-1003968794089',label:'Канал',enabled:true,configured:true}}};
    });
    await composer.connect();nodes.get('social-telegram_1').checked=true;nodes.get('social-file').files=[new File(['photo'],'cover.jpg',{type:'image/jpeg'})];nodes.get('social-file').onchange();
    assert.equal(nodes.get('social-text').required,false);assert.ok(nodes.get('social-preview-image').src.startsWith('blob:'));
    nodes.get('social-text').value='x'.repeat(1025);nodes.get('social-review').onclick();assert.equal(nodes.get('social-send').disabled,true);assert.match(nodes.get('social-status').textContent,/1024/);
    nodes.get('social-text').value='Новая песня';nodes.get('social-review').onclick();assert.equal(nodes.get('social-send').disabled,false);
    await nodes.get('social-form').onsubmit({preventDefault(){}});assert.equal(calls.length,1);assert.ok(calls[0] instanceof FormData);assert.equal(calls[0].get('media').type,'image/jpeg');assert.equal(calls[0].get('media').size,5);
    composer.disconnect();
  }finally{globalThis.document=old;}
});
