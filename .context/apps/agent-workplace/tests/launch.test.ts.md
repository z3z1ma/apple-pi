## file

`/workplace` is tested with a fake `npm` on PATH. The fake installs a stand-in Electron package whose `@electron/get` reports progress or fails as if offline, and whose `install.js` writes a stand-in binary. Nothing is downloaded. An unresolvable registry report can arrive after npm has already begun writing `node_modules`.
Why: a real download would make the test depend on the network and would not isolate the install progress path.
