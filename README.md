# Stardew Valley browser build

This is a static WebAssembly build of Stardew Valley 1.6.15. It runs in the browser and loads the game's content, music, and sound effects before starting. The browser interface and default runtime culture use English (`en-US`), and the game itself defaults to English. All 3,561 content and audio-bank files were repackaged from the supplied `game.zip`; their SHA-256 hashes match the source archive.

The WebAssembly runtime and port files are based on [degloved-net/stardew-wasm](https://github.com/degloved-net/stardew-wasm); its MIT license is included. That license does not grant rights to Stardew Valley itself or its game assets. The original game remains copyrighted by its creator and publisher, so publish this build only if you have the necessary distribution rights.

See [DEPLOYMENT.md](DEPLOYMENT.md) for static-host setup.
