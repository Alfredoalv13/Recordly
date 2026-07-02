import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ipcMain } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { normalizePath } from "../utils";
import { getAssetRootPath, isAllowedLocalReadPath } from "../project/manager";

export function registerAssetHandlers() {
  // Confines reads to app-managed directories (bundled asset root, recordings
  // dir, userData, temp) or paths the app has explicitly approved (e.g. a file
  // chosen via a native dialog.showOpenDialog result, tracked server-side via
  // approveUserPath/rememberApprovedLocalReadPath). This mirrors the allowlist
  // used for the loopback media server and native exports so a compromised
  // renderer cannot use these handlers to read arbitrary files on disk (SSH
  // keys, config files with secrets, etc). Both the lexical and the
  // canonicalized (realpath) form must satisfy the policy so a symlink placed
  // under an allowed prefix cannot smuggle in a target outside it.
  async function resolveReadableLocalFilePath(filePath: string) {
    const normalizedPath = normalizePath(filePath)
    if (!isAllowedLocalReadPath(normalizedPath)) {
      throw new Error('Path is not approved for local reads')
    }

    const resolvedPath = await fs.realpath(normalizedPath).catch(() => normalizedPath)
    const stats = await fs.stat(resolvedPath)
    if (!stats.isFile()) {
      throw new Error('Path is not a readable file')
    }

    const canonicalPath = normalizePath(resolvedPath)
    if (!isAllowedLocalReadPath(canonicalPath)) {
      throw new Error('Path is not approved for local reads')
    }

    return canonicalPath
  }

  // Generate a tiny thumbnail for a wallpaper image and cache it in userData.
  // Returns the cached thumbnail as raw JPEG bytes for fast grid rendering.
  // Serialized to prevent concurrent nativeImage operations from eating memory.
  const THUMB_SIZE = 96
  const thumbCacheDir = path.join(USER_DATA_PATH, 'wallpaper-thumbs')
  let thumbGenerationQueue: Promise<void> = Promise.resolve()

  ipcMain.handle('generate-wallpaper-thumbnail', async (_, filePath: string) => {
    try {
      const resolved = await resolveReadableLocalFilePath(filePath)

      // Deterministic cache key from file path + mtime
      const stat = await fs.stat(resolved)
      const cacheKey = Buffer.from(`${resolved}:${stat.mtimeMs}`).toString('base64url')
      const thumbPath = path.join(thumbCacheDir, `${cacheKey}.jpg`)

      // Return cached thumbnail if it exists (no queue needed)
      if (existsSync(thumbPath)) {
        const data = await fs.readFile(thumbPath)
        return { success: true, data }
      }

      // Serialize nativeImage operations to avoid OOM from concurrent full-res decodes
      let jpegData: Buffer
      const generation = thumbGenerationQueue.then(async () => {
        const { nativeImage } = await import('electron')
        const img = nativeImage.createFromPath(resolved)
        if (img.isEmpty()) {
          throw new Error('Failed to load image')
        }
        const { width, height } = img.getSize()
        const scale = THUMB_SIZE / Math.min(width, height)
        const resized = img.resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          quality: 'good',
        })
        jpegData = resized.toJPEG(70)

        // Cache to disk
        await fs.mkdir(thumbCacheDir, { recursive: true })
        await fs.writeFile(thumbPath, jpegData)
      })
      // Keep the queue moving even if one fails
      thumbGenerationQueue = generation.catch(() => {})
      await generation

      return { success: true, data: jpegData! }
    } catch (error) {
      console.error('Failed to generate wallpaper thumbnail:', error)
      return { success: false, error: 'Failed to generate thumbnail' }
    }
  })

  // Return base path for assets so renderer can resolve file:// paths in production
  ipcMain.handle('get-asset-base-path', () => {
    try {
      const assetPath = getAssetRootPath()
      return pathToFileURL(`${assetPath}${path.sep}`).toString()
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
    }
  })

  ipcMain.handle('list-asset-directory', async (_, relativeDir: string) => {
    try {
      const normalizedRelativeDir = String(relativeDir ?? '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')

      const assetRootPath = path.resolve(getAssetRootPath())
      const targetDirPath = path.resolve(assetRootPath, normalizedRelativeDir)
      if (targetDirPath !== assetRootPath && !targetDirPath.startsWith(`${assetRootPath}${path.sep}`)) {
        return { success: false, error: 'Invalid asset directory' }
      }

      const entries = await fs.readdir(targetDirPath, { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort(new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare)

      return { success: true, files }
    } catch (error) {
      console.error('Failed to list asset directory:', error)
      return { success: false, error: 'Failed to list asset directory' }
    }
  })

  ipcMain.handle('read-local-file', async (_, filePath: string) => {
    try {
      // Uses the same allowlist as the media server and native exports: the
      // bundled asset root, recordings dir, userData, temp dir, or a path the
      // app has explicitly approved (e.g. the result of a dialog.showOpenDialog
      // call). An arbitrary string supplied by a compromised renderer that
      // isn't one of those is rejected here.
      const resolved = await resolveReadableLocalFilePath(filePath)

      const data = await fs.readFile(resolved)
      return { success: true, data }
    } catch (error) {
      console.error('Failed to read local file:', error)
      return { success: false, error: 'Failed to read local file' }
    }
  })

}
