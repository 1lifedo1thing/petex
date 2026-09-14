const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const {Library, normalizeSettings, parseManifest, validateSprite} = require('../app/library.cjs');
async function fixture(t, version=2) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pedex-unit-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source');await fs.mkdir(source);
  const bytes=await sharp({create:{width:1536,height:version===2?2288:1872,channels:4,background:{r:220,g:130,b:50,alpha:1}}}).png().toBuffer();
  await fs.writeFile(path.join(source,'spritesheet.png'),bytes);
  const manifest={id:'test-pet',displayName:'Test friend',description:'A fixture.',spriteVersionNumber:version,spritesheetPath:'spritesheet.png'};
  await fs.writeFile(path.join(source,'pet.json'),JSON.stringify(manifest));
  const library=new Library(path.join(root,'library'));await library.init();
  return {root,source,bytes,manifest,library};
}
test('imports a v2 folder independently, deduplicates, and removes only the copy',async t=>{
  const f=await fixture(t);const first=await f.library.import(f.source);
  assert.equal(first.pet.spriteVersionNumber,2);assert.equal(first.duplicate,false);
  assert.equal((await f.library.import(path.join(f.source,'pet.json'))).duplicate,true);
  assert.equal((await f.library.list()).length,2);
  await f.library.remove(first.pet.id);assert.equal((await f.library.list()).length,1);
  assert.ok(await fs.stat(path.join(f.source,'spritesheet.png')));
});
test('supports v1 and raw atlases',async t=>{const f=await fixture(t,1);assert.equal((await f.library.import(path.join(f.source,'spritesheet.png'))).pet.spriteVersionNumber,1);});
test('reads nested zip packages without extracting arbitrary files',async t=>{
  const f=await fixture(t);const zip=new AdmZip();zip.addFile('friend/pet.json',Buffer.from(JSON.stringify(f.manifest)));zip.addFile('friend/spritesheet.png',f.bytes);zip.addFile('readme.txt',Buffer.from('hello'));
  const zipPath=path.join(f.root,'friend.zip');zip.writeZip(zipPath);assert.equal((await f.library.import(zipPath)).pet.displayName,'Test friend');
});
test('rejects traversal, absolute paths, unexpected versions, and malformed JSON',()=>{
  for(const spritesheetPath of ['../secret.png','/secret.png','C:/secret.png','..\\secret.png','folder/../../secret.png']) assert.throws(()=>parseManifest(Buffer.from(JSON.stringify({spritesheetPath}))),/unsafe/);
  assert.throws(()=>parseManifest(Buffer.from('{')),/JSON/);assert.throws(()=>parseManifest(Buffer.from('{"spriteVersionNumber":3}')),/unsupported/);
});
test('rejects symlink escapes without reading the target image',async t=>{
  const f=await fixture(t);await fs.rename(path.join(f.source,'spritesheet.png'),path.join(f.root,'outside.png'));await fs.symlink(path.join(f.root,'outside.png'),path.join(f.source,'spritesheet.png'));
  await assert.rejects(f.library.import(f.source),/inside/);
});
test('rejects bad dimensions and damaged image payloads',async t=>{
  const f=await fixture(t);const small=await sharp({create:{width:32,height:32,channels:4,background:'red'}}).png().toBuffer();
  await assert.rejects(validateSprite(small,2),/1536/);await assert.rejects(validateSprite(f.bytes.subarray(0,100),2),/damaged|readable/);
});
test('zip missing sprite and multiple pets yield actionable errors',async t=>{
  const f=await fixture(t);const zip=new AdmZip();zip.addFile('pet.json',Buffer.from(JSON.stringify(f.manifest)));const file=path.join(f.root,'bad.zip');zip.writeZip(file);
  await assert.rejects(f.library.import(file),/missing/);zip.addFile('other/pet.json',Buffer.from(JSON.stringify(f.manifest)));zip.writeZip(file);await assert.rejects(f.library.import(file),/exactly one/);
});
test('settings clamp dimensions, persist, and recover from corruption',async t=>{
  const f=await fixture(t);assert.equal(normalizeSettings({size:999,alwaysOnTop:'no'}).size,240);assert.equal(normalizeSettings({size:48}).size,48);assert.equal(normalizeSettings({size:1}).size,48);assert.equal(normalizeSettings({size:NaN}).size,160);assert.equal(normalizeSettings({position:{x:Infinity,y:1}}).position,null);
  await f.library.saveSettings({size:128,motion:false,position:{x:-900,y:50}});const saved=await f.library.settings();assert.equal(saved.size,128);assert.equal(saved.motion,false);assert.equal(saved.randomAnimations,true);
  await f.library.saveSettings({...saved,randomAnimations:false});assert.equal((await f.library.settings()).randomAnimations,false);assert.equal(saved.position.x,-900);
  await fs.writeFile(path.join(f.library.root,'settings.json'),'broken');assert.equal((await f.library.settings()).petId,'miso');
});
test('Codex discovery finds manifests but does not modify the source',async t=>{
  const f=await fixture(t);const home=path.join(f.root,'codex');await fs.mkdir(path.join(home,'pets'),{recursive:true});await fs.cp(f.source,path.join(home,'pets','friend'),{recursive:true});
  const found=await f.library.discover(home);assert.equal(found.length,1);assert.equal(found[0].displayName,'Test friend');assert.equal((await f.library.list()).length,1);assert.deepEqual(await f.library.discover(path.join(f.root,'missing')),[]);
});
