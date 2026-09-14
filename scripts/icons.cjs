const sharp = require('sharp');
const fs = require('node:fs/promises');
const {execFileSync} = require('node:child_process');
(async () => {
  await fs.mkdir('build/icon.iconset', {recursive: true});
  const svg = await fs.readFile('build/icon.svg');
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1,2]) await sharp(svg).resize(size*scale).png().toFile(`build/icon.iconset/icon_${size}x${size}${scale===2?'@2x':''}.png`);
  }
  await sharp(svg).resize(512).png().toFile('build/icon.png');
  if(process.platform==='darwin') execFileSync('iconutil',['-c','icns','build/icon.iconset','-o','build/icon.icns']);
  const png=await sharp(svg).resize(256).png().toBuffer();
  const header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  await fs.writeFile('build/icon.ico',Buffer.concat([header,png]));
  const tray=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M5 15 4 4l9 6h6l9-6-1 11v7c0 9-22 9-22 0z"/><circle cx="12" cy="19" r="2" fill="white"/><circle cx="21" cy="19" r="2" fill="white"/></svg>');
  await sharp(tray).resize(22).png().toFile('app/assets/trayTemplate.png');
  await sharp(tray).resize(44).png().toFile('app/assets/trayTemplate@2x.png');
  await sharp(svg).resize(32).png().toFile('app/assets/tray.png');
})();
