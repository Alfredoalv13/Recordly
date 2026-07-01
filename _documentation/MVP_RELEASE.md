# VybeClip MVP Release

Status: release candidate built on July 1, 2026.

## MVP Acceptance

- VybeClip Studio is the main desktop window.
- Record, Import, Open Project, Recent Projects, and Projects Folder are connected to Electron.
- Screen Recording and Accessibility onboarding is available on macOS.
- New projects use `.vybeclip`; `.recordly` and `.openscreen` projects remain compatible.
- The editor saves project state and exports MP4.
- A real Electron smoke export produced H.264/AAC at 1920 x 1080, 30 fps, and 3 seconds.
- The complete test suite passes: 92 files and 786 tests.
- TypeScript, production renderer, Electron main-process smoke, and strict code-signature checks pass.
- The signed Apple Silicon app launches from the packaged release bundle.

## Release Artifacts

Artifacts are generated in `release/`:

- `VybeClip-arm64.dmg` for Apple Silicon Macs
- `VybeClip-arm64.zip` for Apple Silicon updates/manual distribution
- `VybeClip-x64.dmg` for Intel Macs
- `VybeClip-x64.zip` for Intel updates/manual distribution
- `SHA256SUMS.txt` for artifact verification

DMG checksums for this release candidate:

```text
10e3dcfb9c839830c34188a046cd0efe68af204fc59a0a8184e1ddde21eaab5f  VybeClip-arm64.dmg
e1bfba990d47b2537bc37c136c430dd4ca95845782a78b67ae84e9191d4fe35d  VybeClip-x64.dmg
```

## Code Signing

The app is signed with:

```text
Developer ID Application: Alfredo Alvarez (2733S52X97)
Bundle ID: studio.boxcreative.vybeclip
```

This Mac has duplicate copies of the same Developer ID certificate, so electron-builder cannot select it by display name. Package an unsigned app, then sign by SHA-1 fingerprint:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir
VYBECLIP_CODESIGN_IDENTITY=<certificate-fingerprint> npm run sign:mac -- release/mac-arm64/VybeClip.app
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg zip --arm64 --prepackaged release/mac-arm64/VybeClip.app
```

Use `--x64` and `release/mac/VybeClip.app` for the Intel build.

Verify a signed app with:

```bash
codesign --verify --deep --strict --verbose=2 release/mac-arm64/VybeClip.app
```

## Notarization

The release candidate is Developer ID signed and timestamped, but not notarized. Gatekeeper reports `Unnotarized Developer ID` until Apple notarization credentials are configured.

Before public distribution, configure an Apple notarization profile or the supported electron-builder Apple credentials, submit both DMGs, staple the accepted tickets, and rerun Gatekeeper assessment:

```bash
spctl --assess --type execute --verbose=4 release/mac-arm64/VybeClip.app
```

The expected final result is `accepted` with a notarized Developer ID source.

## Manual Release Check

Before publishing a version tag:

1. Install the DMG on a clean macOS user account.
2. Grant Screen Recording and Accessibility when prompted.
3. Record a display with microphone and system audio.
4. Stop recording and confirm the editor opens.
5. Add one zoom or visual style change.
6. Save a `.vybeclip` project, quit, reopen it from Recent Projects, and confirm the edit remains.
7. Export source-quality MP4 and play the entire file with audio.
8. Confirm the app icon, app name, permission copy, project extension, and exported filename all show VybeClip branding.
