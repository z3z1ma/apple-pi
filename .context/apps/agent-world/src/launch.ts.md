## symbol:installElectron

Electron's binary is downloaded by running `node_modules/electron/install.js` explicitly after `npm install --ignore-scripts`.
Why: npm 11 skips dependency install scripts unless approved, so `npm install electron` alone leaves no binary; running the installer ourselves works under either npm policy.
