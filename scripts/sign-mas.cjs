const fs=require('node:fs/promises');const path=require('node:path');const {signAsync}=require('@electron/osx-sign');
module.exports=async options=>{
  await signAsync(options);
  // Profiles contain public certificates; Apple requires every installed file to be readable.
  await fs.chmod(path.join(options.app,'Contents/embedded.provisionprofile'),0o644);
};
