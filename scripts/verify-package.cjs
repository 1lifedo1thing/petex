const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
function packagePaths(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    const bundle = path.resolve(`release/mac${arch === 'arm64' ? '-arm64' : ''}/Pedex.app`);
    return {bundle, archive: path.join(bundle, 'Contents/Resources/app.asar'), executable: path.join(bundle, 'Contents/MacOS/Pedex')};
  }
  if (platform === 'win32') {
    return {archive: path.resolve('release/win-unpacked/resources/app.asar'), executable: path.resolve('release/win-unpacked/Pedex.exe')};
  }
  throw new Error(`Unsupported platform: ${platform}`);
}
function verify(platform, arch) {
  const paths = packagePaths(platform, arch);
  assert.ok(fs.existsSync(paths.executable), 'Packaged executable is missing');
  const metadata = JSON.parse(asar.extractFile(paths.archive, 'package.json'));
  assert.equal(metadata.version, require('../package.json').version);
  assert.equal(metadata.license, 'Apache-2.0');
  for (const file of fs.readdirSync('app', {recursive: true}).filter(f => fs.statSync(path.join('app', f)).isFile())) {
    assert.ok(fs.readFileSync(path.join('app', file)).equals(asar.extractFile(paths.archive, path.join('app', file))), `Outdated packaged file: ${file}`);
  }
  for (const file of ['LICENSE', 'NOTICE']) assert.ok(fs.readFileSync(file).equals(asar.extractFile(paths.archive, file)), `Missing ${file}`);
  const native = asar.listPackage(paths.archive).find(file => file.includes(`sharp-${platform}-${arch}`) && file.endsWith('.node'));
  assert.ok(native && fs.existsSync(`${paths.archive}.unpacked${native}`), 'Correct native image library must be unpacked');
  if (platform === 'darwin') {
    const identifier = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(paths.bundle, 'Contents/Info.plist')], {encoding: 'utf8'}).trim();
    assert.equal(identifier, 'ad.neko.petex');
  }
  console.log(`Verified ${platform}/${arch} v${metadata.version}: source, license, native library, and package identity.`);
  return paths;
}
if (require.main === module) verify(process.argv[2] || process.platform, process.argv[3] || process.arch);
module.exports = {packagePaths, verify};
