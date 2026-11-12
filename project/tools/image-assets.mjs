import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
export const imageFilePattern=/^[a-f0-9]{24}\.webp$/;
export async function optimizeImage(bytes,directory){
 const input=sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate();
 const variants=[];
 for(const width of [320,640,1280]){
  const {data,info}=await input.clone().resize({width,withoutEnlargement:true}).webp({quality:76,effort:4}).toBuffer({resolveWithObject:true});
  if(variants.some(v=>v.width===info.width))continue;
  const name=createHash('sha256').update(data).digest('hex').slice(0,24)+'.webp';
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name),data);
  variants.push({file:name,width:info.width,height:info.height,bytes:data.length});
 }
 return variants;
}
export function loadImageAssets(root,origin){
 const file=path.join(root,'.image-cache/index.json');if(!fs.existsSync(file))return {};
 const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.origin!==origin)return {};
 const result={};
 for(const [media,entry] of Object.entries(data.images||{})){
  if(!/^\/media\/[A-Za-z0-9_-]{10,160}\/[^/]+$/.test(media)||!Array.isArray(entry.variants)||!entry.variants.length)continue;
  const variants=entry.variants;
  if(!variants.every(v=>imageFilePattern.test(v.file)&&Number.isInteger(v.width)&&v.width>0&&v.width<=1280&&Number.isInteger(v.height)&&v.height>0&&fs.existsSync(path.join(root,'.image-cache',v.file))))continue;
  const largest=variants.at(-1);
  result[media]={src:'/assets/optimized/'+largest.file,srcset:variants.map(v=>'/assets/optimized/'+v.file+' '+v.width+'w').join(', '),width:largest.width,height:largest.height};
 }
 return result;
}
