import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {optimizeImage,loadImageAssets} from '../tools/image-assets.mjs';
test('Public image preparation creates bounded WebP variants and ignores cache entries from another origin or missing files',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ed-images-')),directory=root+'/.image-cache';
 try{
  const input=await sharp({create:{width:1800,height:1200,channels:3,background:'#433629'}}).png().toBuffer();
  const variants=await optimizeImage(input,directory);assert.deepEqual(variants.map(v=>v.width),[320,640,1280]);
  for(const v of variants){const meta=await sharp(directory+'/'+v.file).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,v.width);}
  const media='/media/public_image_123/cover.png';fs.writeFileSync(directory+'/index.json',JSON.stringify({origin:'https://media.example',images:{[media]:{variants}}}));
  assert.equal(loadImageAssets(root,'https://other.example')[media],undefined);assert.ok(loadImageAssets(root,'https://media.example')[media].srcset.includes('320w'));
  fs.unlinkSync(directory+'/'+variants[0].file);assert.equal(loadImageAssets(root,'https://media.example')[media],undefined);
  await assert.rejects(optimizeImage(Buffer.from('not an image'),directory));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
