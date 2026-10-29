import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPublication,publicationReference,referencedMediaIds} from '../web/publication-media.mjs';

test('All original, cover and quality files are linked to the publication; external URLs are excluded',()=>{
  const item={audio_mp3:'/media/original_file_1/a.mp3',cover:'/media/cover_file_001/a.jpg',qualities:{128:'/media/quality_file_1/a.mp3?download=1',192:'https://other.example/media/external_file/a.mp3'}};
  assert.deepEqual([...referencedMediaIds(item)],['original_file_1','cover_file_001','quality_file_1']);
  const record=bindPublication({driveId:'original_file_1'},'tracks','track_1');
  assert.deepEqual(publicationReference(record),{kind:'tracks',id:'track_1'});
  assert.equal(publicationReference({driveId:'shared_asset_1'}),null);
  assert.throws(()=>publicationReference({ownerKind:'tracks'}));
  assert.throws(()=>bindPublication({},'settings','private'));
  assert.throws(()=>bindPublication({},'tracks','../private'));
});
