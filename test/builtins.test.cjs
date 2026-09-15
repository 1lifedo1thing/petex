const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const asar=require('@electron/asar');const sharp=require('sharp');const {findArchive,readBuiltins}=require('../app/codex-builtins.cjs');
test('imports only compatible atlases from an application archive without running its code',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'petex-builtins-'));
 try{
  const assets=path.join(root,'source/webview/assets');await fs.mkdir(assets,{recursive:true});
  await sharp({create:{width:1536,height:2288,channels:4,background:'#40aacc'}}).webp().toFile(path.join(assets,'dewey-spritesheet-v5-test.webp'));
  await fs.writeFile(path.join(assets,'bad-spritesheet-v1-test.webp'),'invalid');
  await fs.writeFile(path.join(assets,'codex-pet-assets-test.js'),'throw new Error("Never execute source app code")');
  const archive=path.join(root,'ChatGPT.app/Contents/Resources/app.asar');await fs.mkdir(path.dirname(archive),{recursive:true});await asar.createPackage(path.join(root,'source'),archive);
  assert.equal(await findArchive(path.join(root,'ChatGPT.app')),archive);
  const pets=await readBuiltins(archive);assert.equal(pets.length,1);assert.equal(pets[0].manifest.displayName,'Dewey');assert.equal(pets[0].manifest.spriteVersionNumber,2);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('rejects truncated and oversized application archive headers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'petex-bad-'));const archive=path.join(root,'app.asar');
 try{await fs.writeFile(archive,Buffer.alloc(4));await assert.rejects(readBuiltins(archive),/Invalid application archive/);const header=Buffer.alloc(16);header.writeUInt32LE(4,0);header.writeUInt32LE(0xffffffff,4);await fs.writeFile(archive,header);await assert.rejects(readBuiltins(archive),/Invalid application archive/);}finally{await fs.rm(root,{recursive:true,force:true});}
});
