import test from 'node:test';import assert from 'node:assert/strict';
import {playbackSource,streamURL} from '../web/playback-core.mjs';
import {playbackRange,chunkBytes,chunkKey,cachedChunk,storeChunk} from '../worker/src/media-cache.mjs';
test('Auto selects prepared MP3 before playing, honors economy and original, and falls back without inventing copies',()=>{
 const item={audio_mp3:'/media/original_123/a.mp3',qualities:{128:'/media/quality128_123/a.mp3',192:'/media/quality192_123/a.mp3'}};
 assert.equal(playbackSource(item).quality,'192');assert.equal(playbackSource(item,'auto',{saveData:true}).quality,'128');assert.equal(playbackSource(item,'original').url,item.audio_mp3);
 assert.equal(playbackSource({...item,qualities:{}}).quality,'original');assert.equal(playbackSource({...item,qualities:{192:'https://untrusted.example/track'}}).quality,'original');
 assert.equal(streamURL(item.audio_mp3,'https://media.example','https://site.example'),'https://media.example/media/original_123/a.mp3?stream=1');assert.equal(streamURL('https://foreign.example/a.mp3','https://media.example','https://site.example'),'');
});
test('Playback bounds open ranges, supports seeks/suffix/probes, and leaves downloads and image requests alone',()=>{
 const record={mime:'video/mp4',size:12*1024*1024};
 const request=(range,query='stream=1')=>new Request('https://media.example/media/video_file_1/a.mp4?'+query,{headers:{Range:range}});
 assert.equal(playbackRange(request('bytes=0-'),record).length,chunkBytes);assert.equal(playbackRange(request('bytes=0-1'),record).length,2);
 assert.equal(playbackRange(request('bytes=8000000-'),record).range,'bytes=8000000-12194303');assert.equal(playbackRange(request('bytes=-100'),record).length,100);
 assert.equal(playbackRange(request('bytes=0-','download=1&stream=1'),record),null);assert.equal(playbackRange(request('bytes=0-',''),record),null);assert.equal(playbackRange(request('bytes=999999999-'),record),null);
});
test('Chunk cache keeps byte ranges intact, rejects incomplete bodies, and never stores an unbounded stream',async()=>{
 const map=new Map(),cache={match:async key=>map.get(key.url)?.clone(),put:async(key,r)=>{assert.equal(r.status,200);map.set(key.url,r);}};
 const record={driveId:'public_file_1',mime:'audio/mpeg',size:4},request=new Request('https://media.example/media/public_file_1/a.mp3?stream=1',{headers:{Range:'bytes=0-'}}),plan=playbackRange(request,record),key=chunkKey(request,record,'project',plan);
 await storeChunk(cache,key,new Response('song',{status:206,headers:{'Content-Range':'bytes 0-3/4','Content-Length':'4'}}),plan);
 const hit=await cachedChunk(cache,key,plan);assert.equal(hit.status,206);assert.equal(hit.headers.get('Content-Range'),'bytes 0-3/4');assert.equal(await hit.text(),'song');assert.equal(hit.headers.get('Cache-Control'),'public, max-age=15');
 map.clear();await storeChunk(cache,key,new Response('bad'),plan);assert.equal(map.size,0);await storeChunk(cache,key,new Response('too long'),plan);assert.equal(map.size,0);
});
