const {execFileSync} = require('node:child_process');
const {verify} = require('./verify-package.cjs');
const paths = verify(process.argv[2] || process.platform, process.argv[3] || process.arch);
execFileSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test'], {
  stdio: 'inherit', env: {...process.env, PEDEX_EXECUTABLE: paths.executable},
});
