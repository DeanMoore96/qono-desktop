# Qono desktop

This repository builds the Qono desktop app with GitHub Actions.

Current Windows installer: `Qono-Setup-1.2.0.exe`, also published as `Qono-Setup.exe` on the `v1.2.0` release, with `Qono-Setup-1.2.0.exe.blockmap` and `latest.yml` for auto-update. The macOS disk image, when a Mac runner is available, is `Qono-1.2.0.dmg`.

The app is an Electron tray shell. It shows a local consent window, then requires a qono.net sign-in at least every 24 hours, then opens https://qono.net. Closing the window hides it to the tray. Quit is the real exit. Sign out is in the tray menu. Account and billing stay in the browser at https://qono.net/members.

`QONO_URL` overrides the site origin for local tests. The version in `package.json` stays `1.2.0` for the rebuilt installer on the existing release, so copies that are already installed do not see an auto-update.

The builds are unsigned, so the first launch asks for a one-time confirmation.
