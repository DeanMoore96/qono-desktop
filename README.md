# Qono desktop

This repository builds the Qono desktop installers with GitHub Actions.

Run the **Build Qono installers** workflow (Actions tab) and it compiles
`Qono-1.0.0.dmg` on macOS and `Qono-Setup-1.0.0.exe` on Windows, then publishes
them to a release.

`main.js` opens https://qono.net in its own window. Change `APP_URL` there to
point the desktop app somewhere else.

The builds are unsigned, so the first launch asks for a one-time confirmation.