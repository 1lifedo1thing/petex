const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync,spawnSync}=require('node:child_process');
const version=require('../package.json').version,tag=`v${version}`;
if(process.env.RELEASE_REF?.startsWith('refs/tags/')&&process.env.RELEASE_REF!==`refs/tags/${tag}`)throw new Error('Tag must match package.json version.');
const expected=[`Petex-${version}-mac-arm64.dmg`,`Petex-${version}-mac-arm64.zip`,`Petex-${version}-mac-x64.dmg`,`Petex-${version}-mac-x64.zip`,`Petex-${version}-win-x64.exe`];
for(const name of expected)if(!fs.existsSync(path.join('release',name)))throw new Error(`Missing installer: ${name}`);
const existing=spawnSync('gh',['release','view',tag,'--json','isDraft'],{encoding:'utf8'});
if(existing.status===0&&!JSON.parse(existing.stdout).isDraft){console.log(`${tag} is already published. Bump package.json to release a new version.`);process.exit(0);}
fs.writeFileSync('release/SHA256SUMS.txt',expected.map(name=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join('release',name))).digest('hex')}  ${name}`).join('\n')+'\n');
const gh=args=>execFileSync('gh',args,{stdio:'inherit'});
if(existing.status!==0)gh(['release','create',tag,'--draft','--target',process.env.RELEASE_COMMIT,'--title',`Petex ${version}`,'--generate-notes']);
gh(['release','upload',tag,...expected.map(name=>path.join('release',name)),'release/SHA256SUMS.txt','--clobber']);
gh(['release','edit',tag,'--draft=false','--latest']);
