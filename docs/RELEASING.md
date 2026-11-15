# Releasing Qono desktop

The version, git tag, and release name all come from `version` in `package.json`.
For 1.1.0 that is tag `v1.1.0` and release name `Qono 1.1.0`.

## Windows

`npm run dist:win` builds an unsigned NSIS installer and, because `build.publish`
points at GitHub, also writes the update metadata (it does not upload anything;
`--publish never` is still set):

- `release/Qono-Setup-X.Y.Z.exe`
- `release/Qono-Setup-X.Y.Z.exe.blockmap`
- `release/latest.yml`

The GitHub Actions workflow attaches those three files to the release on
`DeanMoore96/qono-desktop`. The installed app checks that release on startup
and about every four hours, downloads in the background, installs on Quit, and
can restart from the tray item "Restart to update".

The build is unsigned. `publisherName` is intentionally absent from the publish
config: electron-updater treats a missing publisher as "do not check
Authenticode". Setting `publisherName` (or turning on code-signing verification)
will make unsigned updates fail. Add it only when the installer is actually signed.

A running tray instance hides when its window closes, so the installer does not
rely on WM_CLOSE. It launches `Qono.exe --quit`, which is a real exit and does
not start another installer, then falls back to taskkill.

## macOS

The `.dmg` has to be built on macOS. Either:

- a Mac the owner connects, running `npm run dist:mac`, or
- the `build-mac` job on the `macos-14` GitHub-hosted runner.

That job previously failed for this account because of GitHub's new-account
limit on the `macos-14-arm64-us-default` larger runners. GitHub support ticket
4997291 is open. A Mac failure does not block the Windows release.

Mac auto-update is not wired up. It needs an Apple Developer ID so the app can
be signed and notarized, and a `zip` target in addition to `dmg`. electron-updater
publishes `latest-mac.yml` from the zip; it does not update from a dmg.
`dist:mac` still builds the dmg only.
