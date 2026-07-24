import { spawn } from "node:child_process";
import path from "node:path";
import { app, ipcMain, shell, systemPreferences } from "electron";
import { getMacPrivacySettingsUrl } from "../utils";

export function registerPermissionHandlers() {
  ipcMain.handle('relaunch-app', () => {
    // macOS caches permission-check results (getMediaAccessStatus, etc.) for
    // the life of the process, so a grant made in System Settings is invisible
    // until the app actually restarts - closing the window isn't enough on
    // macOS, since that doesn't quit the process. This gives the renderer a
    // real fix instead of a "refresh" that can never work mid-process.
    //
    // app.relaunch() alone isn't enough here: on macOS it re-execs the new
    // process from the current one rather than handing off to launchd/Finder,
    // and TCC's "is this app authorized" check can still resolve against the
    // old (denied) process's context - verified directly: a process spawned
    // via `open` always saw a fresh grant correctly, one spawned via
    // app.relaunch() kept seeing the stale denial. Shelling out to `open` on
    // the app bundle gives the new process the same independent launch
    // lineage as double-clicking it in Finder/Dock actually has.
    if (process.platform === "darwin") {
      // Verified directly (with debug logging) that spawning `open` on the
      // bundle *before* this process has actually exited doesn't start a
      // second instance at all: macOS's `open` treats an already-running
      // regular app bundle as "bring it to front", not "launch another one",
      // regardless of Electron's own requestSingleInstanceLock() state. So
      // if `open` runs while this process is still alive - even just for a
      // short fixed delay - it silently re-activates *this* (dying) process
      // instead of starting a new one, and once this one exits, nothing is
      // left running.
      //
      // The fix has to live outside this process, since once app.exit() is
      // called nothing else here runs: hand a detached shell script the job
      // of waiting until this exact pid is actually gone (polling, not a
      // fixed guess) before it calls `open`. releaseSingleInstanceLock() is
      // kept too so the new process's own lock check never depends on this
      // one's exit timing either.
      app.releaseSingleInstanceLock();
      const appBundlePath = path.dirname(path.dirname(path.dirname(process.execPath)));
      const waitThenReopen = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.05; done; open ${JSON.stringify(appBundlePath)}`;
      spawn("/bin/sh", ["-c", waitThenReopen], { detached: true, stdio: "ignore" }).unref();
      app.exit(0);
    } else {
      app.relaunch();
      app.exit(0);
    }
    return { success: true }
  })

  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      // Security: only allow http/https URLs to prevent file:// or custom protocol abuse
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { success: false, error: `Blocked non-HTTP URL: ${parsed.protocol}` }
      }
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open URL:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-accessibility-permission-status', () => {
    if (process.platform !== 'darwin') {
      return { success: true, trusted: true, prompted: false }
    }

    return {
      success: true,
      trusted: systemPreferences.isTrustedAccessibilityClient(false),
      prompted: false,
    }
  })

  ipcMain.handle('request-accessibility-permission', () => {
    if (process.platform !== 'darwin') {
      return { success: true, trusted: true, prompted: false }
    }

    return {
      success: true,
      trusted: systemPreferences.isTrustedAccessibilityClient(true),
      prompted: true,
    }
  })

  ipcMain.handle('get-screen-recording-permission-status', () => {
    if (process.platform !== 'darwin') {
      return { success: true, status: 'granted' }
    }

    try {
      return {
        success: true,
        status: systemPreferences.getMediaAccessStatus('screen'),
      }
    } catch (error) {
      console.error('Failed to get screen recording permission status:', error)
      return { success: false, status: 'unknown', error: String(error) }
    }
  })

  ipcMain.handle('open-screen-recording-preferences', async () => {
    if (process.platform !== 'darwin') {
      return { success: true }
    }

    try {
      await shell.openExternal(getMacPrivacySettingsUrl('screen'))
      return { success: true }
    } catch (error) {
      console.error('Failed to open Screen Recording preferences:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('open-accessibility-preferences', async () => {
    if (process.platform !== 'darwin') {
      return { success: true }
    }

    try {
      await shell.openExternal(getMacPrivacySettingsUrl('accessibility'))
      return { success: true }
    } catch (error) {
      console.error('Failed to open Accessibility preferences:', error)
      return { success: false, error: String(error) }
    }
  })
}
