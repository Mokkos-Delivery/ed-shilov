import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

test('The real bundled encoder produces playable MP3 at both offered bitrates',async()=>{
  const messages=[],context=vm.createContext({Blob,self:{postMessage:message=>messages.push(message)}});
  context.importScripts=name=>{assert.equal(name,'/assets/vendor/lame.min.js');vm.runInContext(fs.readFileSync('public/assets/vendor/lame.min.js','utf8'),context);};
  vm.runInContext(fs.readFileSync('web/quality-worker.js','utf8'),context);
  const pcm=new Int16Array(44100);for(let i=0;i<pcm.length;i++)pcm[i]=Math.sin(i*2*Math.PI*440/44100)*16000;
  context.self.onmessage({data:{channels:[pcm],sampleRate:44100,qualities:[128,192]}});
  const finished=messages.find(x=>x.result);assert.ok(finished,JSON.stringify(messages));assert.equal(finished.result.length,2);
  for(const value of finished.result){const bytes=Buffer.from(await value.blob.arrayBuffer());assert.ok(bytes.length>1000);
    const output=execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name,sample_rate,bit_rate','-of','json','-i','pipe:0'],{input:bytes});
    const stream=JSON.parse(output).streams[0];assert.equal(stream.codec_name,'mp3');assert.equal(Number(stream.sample_rate),44100);assert.equal(Number(stream.bit_rate),value.quality*1000);
  }
});
