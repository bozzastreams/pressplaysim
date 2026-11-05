# PressPlaySim

Original PressPlaySim field hockey simulator, based on the **Kampong staff build 0.0.3 from 2 November 2026**.

## The app

- Coach-controlled field hockey simulation and player positioning.
- Players join from phones on the same local network.
- Ball possession and passing controls.
- Drawing tools: freehand, arrow, line, rectangle and circle.
- Session recording, replay and MP4 export.
- Local staff workspace and club identity settings.

This edition runs locally and does not include subscription licensing, remote activation or a hosted admin service. Drawings are temporary overlays and are not included in recordings or MP4 exports.

## Run on an Apple Silicon Mac

The supplied build requires macOS 12 or later and an Apple Silicon Mac. For the checkout, use Node.js 22.16 or later.

```sh
npm install
npm start
```

Electron is pinned to the version bundled with the original staff build. The included MP4 helper is the original Apple Silicon binary.

To serve the app locally without the Electron window:

```sh
npm run server
```

Open the printed local address. Players use the host Mac’s LAN address on the same network. This is a local application, not a static GitHub Pages site. No GitHub Pages deployment is configured.

## About this source

This repository contains the application files recovered from the original supplied app package. The browser UI is the original compiled bundle; the original React/TypeScript development project was not present in that package. The local server and Electron entry point are included. The MP4 helper path was adapted to this checkout’s `native/` folder, and a local-server launcher and smoke tests were added.

See [the original staff instructions](docs/STAFF_BUILD_0.0.3.txt) for installation, drawing and phone-connection details. The original staff build has an ad-hoc signature and is not Apple-notarized.

No staff passwords, personal recordings, commercial license keys or owner signing keys are included.

## Layout

- `electron/` — original desktop entry point.
- `dist/` — original compiled browser interface and assets.
- `dist-server/` — local simulation, workspace and recording server.
- `native/` — original Apple Silicon MP4 export helper.
- `docs/` — original staff build instructions.
- `scripts/` and `tests/` — local launch and verification.

## Verify

```sh
npm test
```
