import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installHostingPathFix} from '../tools/hosting-emulator.cjs';

const require=createRequire(import.meta.url);
const hostingRequire=createRequire(require.resolve('firebase-tools/lib/serve/hosting'));
const superstaticRequire=createRequire(hostingRequire.resolve('superstatic'));
const globSlash=superstaticRequire('glob-slash');
const {server}=hostingRequire('superstatic');

async function checkEngine(){
  const service=server({port:0,hostname:'127.0.0.1',cwd:process.cwd(),stack:'strict',config:{
    public:'public',cleanUrls:false,trailingSlash:false,
    redirects:[{source:'/media/:id/:name',destination:'https://media.example/media/:id/:name',type:302}],
    headers:[{source:'**',headers:[{key:'X-Content-Type-Options',value:'nosniff'}]}]
  }}).listen();
  try{
    if(!service.listening)await new Promise((resolve,reject)=>{service.once('listening',resolve);service.once('error',reject);});
    const base='http://127.0.0.1:'+service.address().port;
    const media=await fetch(base+'/media/public_file_123/'+encodeURIComponent('Ах, какая женщина.mp4')+'?download=1',{redirect:'manual'});
    const css=await fetch(base+'/assets/css/site-v10.css');
    const result={redirect:media.status,location:media.headers.get('Location'),css:css.status,nosniff:css.headers.get('X-Content-Type-Options')};
    await media.body?.cancel();await css.body?.cancel();return result;
  }finally{await new Promise((resolve,reject)=>service.close(error=>error?reject(error):resolve()));}
}

test('The actual Hosting engine reproduces Windows 404/missing headers, then preserves redirects and nosniff with POSIX URL paths',async()=>{
  const original=globSlash.normalize;
  try{
    // Reproduce glob-slash's native Windows operations without pretending to
    // have run an entire Windows OS or changing Node filesystem semantics.
    globSlash.normalize=value=>path.win32.normalize(path.win32.join('/',value));
    const broken=await checkEngine();
    assert.equal(broken.redirect,404);assert.equal(broken.css,200);assert.equal(broken.nosniff,null);
    installHostingPathFix();
    const fixed=await checkEngine();
    assert.equal(fixed.redirect,302);assert.equal(fixed.css,200);assert.equal(fixed.nosniff,'nosniff');
    const url=new URL(fixed.location);assert.equal(url.origin,'https://media.example');assert.equal(url.pathname.split('/')[2],'public_file_123');assert.equal(url.searchParams.get('download'),'1');
  }finally{globSlash.normalize=original;}
});
