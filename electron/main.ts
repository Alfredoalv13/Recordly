import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	Menu,
	Notification,
	nativeImage,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { RECORDINGS_DIR } from "./appPaths";
import { showCursor } from "./cursorHider";
import { registerExtensionIpcHandlers } from "./extensions/extensionIpc";
import { getGpuSwitches } from "./gpuSwitches";
import {
	cleanupAllExportStreams,
	cleanupNativeVideoExportSessions,
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import { ensureMediaServer, getMediaServerBaseUrl } from "./mediaServer";
import { ensurePackagedRendererServer, getPackagedRendererBaseUrl } from "./rendererServer";
import type { UpdateToastPayload } from "./updater";
import {
	checkForAppUpdates,
	deferUpdateReminder,
	dismissUpdateToast,
	downloadAvailableUpdate,
	getCurrentUpdateToastPayload,
	getUpdaterLogPath,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	previewUpdateToast,
	setupAutoUpdates,
	skipAvailableUpdateVersion,
} from "./updater";
import {
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	createStudioWindow,
	getHudOverlayWindow,
	getUpdateToastWindow,
	hideUpdateToastWindow,
	isHudOverlayMousePassthroughSupported,
	reassertHudOverlayMousePassthrough as reassertHudOverlayMouseState,
	setHudOverlayRecordingActive,
	showUpdateToastWindow,
} from "./windows";

const electronMainDir = path.dirname(fileURLToPath(import.meta.url));
const IS_SMOKE_EXPORT = process.env.RECORDLY_SMOKE_EXPORT === "1";

function ignoreBrokenConsolePipe(stream: NodeJS.WritableStream | undefined) {
	stream?.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EPIPE") {
			return;
		}
		throw error;
	});
}

ignoreBrokenConsolePipe(process.stdout);
ignoreBrokenConsolePipe(process.stderr);

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-gpu-rasterization");

function configureGpuAccelerationSwitches() {
	const { useAngle, useGl, disableFeatures } = getGpuSwitches(process.platform, process.env);
	if (useAngle) {
		app.commandLine.appendSwitch("use-angle", useAngle);
	}
	if (useGl) {
		app.commandLine.appendSwitch("use-gl", useGl);
	}
	if (disableFeatures && disableFeatures.length > 0) {
		app.commandLine.appendSwitch("disable-features", disableFeatures.join(","));
	}
}

async function logSmokeExportGpuDiagnostics() {
	if (!IS_SMOKE_EXPORT) {
		return;
	}

	try {
		console.log("[smoke-export] GPU feature status", JSON.stringify(app.getGPUFeatureStatus()));
		console.log("[smoke-export] GPU info", JSON.stringify(await app.getGPUInfo("basic")));
	} catch (error) {
		console.warn("[smoke-export] Failed to read GPU diagnostics:", error);
	}
}

configureGpuAccelerationSwitches();

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(electronMainDir, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
const IS_DEV = Boolean(VITE_DEV_SERVER_URL);

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

/**
 * Registers a Content-Security-Policy header for every response served to
 * our renderers. This is the mitigation that lets `webSecurity` stay enabled
 * (see electron/windows.ts) while still allowing the app to talk to its own
 * local-only HTTP servers:
 *   - ensurePackagedRendererServer() serves the packaged index.html/js/css
 *     from http://127.0.0.1:<random-port> (electron/rendererServer.ts).
 *   - ensureMediaServer() streams allow-listed local video/audio files from
 *     http://127.0.0.1:<random-port>/video (electron/mediaServer.ts).
 *   - In dev, the renderer is loaded from the Vite dev server
 *     (VITE_DEV_SERVER_URL, typically http://localhost:5173), which is
 *     already covered by 'self'.
 * `file:` is additionally allowed for img-src/media-src only, since
 * user-installed extensions (already fully-trusted local code — see
 * EXTENSIONS.md) reference their own icon/asset files via file:// URLs
 * (see src/components/video-editor/ExtensionIcon.tsx), and
 * getRenderableVideoUrl() falls back to file:// if the media server is
 * unavailable (src/lib/assetPath.ts).
 */
function configureContentSecurityPolicy() {
	const selfOrigins = new Set<string>(["'self'"]);

	const rendererBaseUrl = getPackagedRendererBaseUrl();
	if (rendererBaseUrl) {
		selfOrigins.add(rendererBaseUrl);
	}

	const mediaBaseUrl = getMediaServerBaseUrl();
	if (mediaBaseUrl) {
		selfOrigins.add(mediaBaseUrl);
	}

	if (VITE_DEV_SERVER_URL) {
		selfOrigins.add(VITE_DEV_SERVER_URL);
	}

	const originList = Array.from(selfOrigins).join(" ");

	const csp = [
		`default-src 'self' ${originList}`,
		// The renderer bundle currently relies on inline/style-injected code
		// paths (React dev overlays in dev mode, dynamically constructed
		// styles for the editor canvas), so 'unsafe-inline' is kept for
		// script/style until those call sites are audited and tightened.
		`script-src 'self' 'unsafe-inline' 'unsafe-eval' ${originList}`,
		`style-src 'self' 'unsafe-inline' ${originList}`,
		`img-src 'self' data: blob: file: ${originList}`,
		`media-src 'self' data: blob: file: ${originList}`,
		`font-src 'self' data: ${originList}`,
		`connect-src 'self' ${originList} ws: wss:`,
		"object-src 'none'",
	].join("; ");

	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [csp],
			},
		});
	});
}

// Window references
let mainWindow: BrowserWindow | null = null;
let studioWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayContextMenu: Menu | null = null;
let selectedSourceName = "";
let editorHasUnsavedChanges = false;
let isForceClosing = false;
let isCreatingMainWindow = false;
let isCreatingEditorWindow = false;
let isAppQuitting = false;
let activeUpdateNotification: Notification | null = null;
let activeUpdateNotificationKey: string | null = null;
const shouldEnforceSingleInstanceLock = !IS_DEV;
const hasSingleInstanceLock = shouldEnforceSingleInstanceLock
	? app.requestSingleInstanceLock()
	: true;

if (!hasSingleInstanceLock) {
	app.quit();
}

function closeEditorWindowBypassingUnsavedPrompt(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (isEditorWindow(window)) {
		isForceClosing = true;
		editorHasUnsavedChanges = false;
	}
	window.close();
}

function restoreWindowSafely(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (window === getHudOverlayWindow() && process.platform === "win32") {
		showHudOverlayFromTray();
		return;
	}

	if (window.isMinimized()) {
		window.restore();
	}

	if (!window.isVisible()) {
		window.show();
	}

	window.moveTop();
	window.focus();
}

function getExistingEditorWindow(): BrowserWindow | null {
	return (
		BrowserWindow.getAllWindows().find(
			(window) => !window.isDestroyed() && isEditorWindow(window),
		) ?? null
	);
}

// Tray Icons (lazily created after app is ready to avoid accessing Electron APIs too early)
let defaultTrayIcon: ReturnType<typeof getTrayIcon> | null = null;
let recordingTrayIcon: ReturnType<typeof getTrayIcon> | null = null;

function getPlatformAppIconFilename(size: 32 | 128 | 512) {
	return `app-icons/vybeclip-${size}.png`;
}

function getDefaultTrayIcon() {
	if (!defaultTrayIcon) {
		defaultTrayIcon = getTrayIcon(getPlatformAppIconFilename(32));
	}
	return defaultTrayIcon;
}

function getRecordingTrayIcon() {
	if (!recordingTrayIcon) {
		recordingTrayIcon = getTrayIcon("rec-button.png");
	}
	return recordingTrayIcon;
}

function showHudOverlayFromTray() {
	const hud = getHudOverlayWindow();
	if (!hud) {
		return false;
	}

	if (hud.isMinimized()) {
		hud.restore();
	}

	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		hud.showInactive();
		hud.moveTop();
		reassertHudOverlayMouseState();
		return true;
	}

	hud.show();
	hud.moveTop();
	hud.focus();
	return true;
}

function showOrCreateRecordingControls() {
	const existingHud = getHudOverlayWindow();
	if (existingHud) {
		showHudOverlayFromTray();
		return existingHud;
	}

	return createHudOverlayWindow();
}

ipcMain.on("set-has-unsaved-changes", (_event, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function createWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			if (!mainWindow || mainWindow.isDestroyed()) {
				createWindow();
			}
		});
		return;
	}

	if (isCreatingMainWindow) {
		return;
	}

	if (studioWindow && !studioWindow.isDestroyed()) {
		mainWindow = studioWindow;
		restoreWindowSafely(studioWindow);
		return;
	}

	isCreatingMainWindow = true;
	const createdStudioWindow = createStudioWindow();
	studioWindow = createdStudioWindow;
	mainWindow = createdStudioWindow;
	createdStudioWindow.once("closed", () => {
		if (studioWindow === createdStudioWindow) {
			studioWindow = null;
		}
		if (mainWindow === createdStudioWindow) {
			mainWindow = null;
		}
	});
	isCreatingMainWindow = false;
}

function focusOrCreateMainWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			focusOrCreateMainWindow();
		});
		return;
	}

	if (!mainWindow || mainWindow.isDestroyed()) {
		createWindow();
		return;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.moveTop();
		mainWindow.focus();
	}
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	if (!isMac) {
		Menu.setApplicationMenu(null);
		return;
	}

	const template: Electron.MenuItemConstructorOptions[] = [];
	template.push({
		label: app.name,
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		],
	});

	template.push(
		{
			label: "File",
			submenu: [
				{
					label: "Open Projects…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: isMac
				? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize" }, { role: "close" }],
		},
		{
			label: "Help",
			submenu: [
				{
					label: "Check for Updates…",
					click: () => {
						void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
					},
				},
			],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function isPrimaryTrayClick(event: unknown) {
	const button =
		event && typeof event === "object" && "button" in event
			? (event as { button?: number | string }).button
			: undefined;
	return button === undefined || button === 0 || button === "left";
}

function createTray() {
	tray = new Tray(getDefaultTrayIcon());
	tray.on("click", (event) => {
		if (process.platform === "win32" && !isPrimaryTrayClick(event)) {
			return;
		}

		focusOrCreateMainWindow();
	});

	if (process.platform === "win32") {
		tray.on("right-click", () => {
			if (!tray || !trayContextMenu) {
				return;
			}

			tray.popUpContextMenu(trayContextMenu);
		});
		return;
	}

	tray.on("double-click", () => focusOrCreateMainWindow());
}

function getPublicAssetPath(filename: string) {
	return path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename);
}

function getAppImage(filename: string) {
	return nativeImage.createFromPath(getPublicAssetPath(filename));
}

function getTrayIcon(filename: string) {
	return getAppImage(filename).resize({
		width: 24,
		height: 24,
		quality: "best",
	});
}

function syncDockIcon() {
	if (process.platform !== "darwin" || !app.dock) {
		return;
	}

	const dockIcon = getAppImage(getPlatformAppIconFilename(512));
	if (!dockIcon.isEmpty()) {
		app.dock.setIcon(dockIcon);
	}
}

function getUpdateNotificationTitle(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return `VybeClip ${payload.version} is available`;
		case "downloading":
			return `Downloading VybeClip ${payload.version}`;
		case "ready":
			return `VybeClip ${payload.version} is ready`;
		case "error":
			return `VybeClip ${payload.version} needs attention`;
	}
}

function getUpdateNotificationBody(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return "Click to install the update and restart VybeClip.";
		case "downloading":
			return "VybeClip is downloading the update and will restart when it is ready.";
		case "ready":
			return "Click to install the downloaded update and restart.";
		case "error":
			return payload.primaryAction === "install-and-restart"
				? "Click to try the install again."
				: "Click to retry checking for updates.";
	}
}

function clearActiveUpdateNotification() {
	if (activeUpdateNotification) {
		activeUpdateNotification.close();
		activeUpdateNotification = null;
	}
	activeUpdateNotificationKey = null;
}

function sendUpdateToastToWindows(channel: "update-toast-state", payload: unknown) {
	if (process.platform !== "darwin") {
		if (!payload) {
			clearActiveUpdateNotification();
			return true;
		}

		const updatePayload = payload as UpdateToastPayload;
		if (updatePayload.phase === "downloading") {
			return true;
		}

		if (!Notification.isSupported()) {
			return false;
		}

		const notificationKey = [
			updatePayload.phase,
			updatePayload.version,
			updatePayload.detail,
		].join(":");
		if (activeUpdateNotificationKey === notificationKey) {
			return true;
		}

		clearActiveUpdateNotification();
		const notification = new Notification({
			title: getUpdateNotificationTitle(updatePayload),
			body: getUpdateNotificationBody(updatePayload),
			icon: getAppImage(getPlatformAppIconFilename(128)),
			silent: false,
		});

		notification.on("click", () => {
			focusOrCreateMainWindow();
			switch (updatePayload.phase) {
				case "available":
					void downloadAvailableUpdate(sendUpdateToastToWindows, {
						installAfterDownload: true,
					});
					break;
				case "ready":
					installDownloadedUpdateNow(sendUpdateToastToWindows);
					break;
				case "error":
					if (updatePayload.primaryAction === "install-and-restart") {
						void downloadAvailableUpdate(sendUpdateToastToWindows, {
							installAfterDownload: true,
						});
					} else {
						void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
					}
					break;
				default:
					break;
			}
		});

		notification.on("close", () => {
			if (activeUpdateNotification === notification) {
				activeUpdateNotification = null;
				activeUpdateNotificationKey = null;
			}
		});

		notification.show();
		// On Win10, showing a native notification can break setIgnoreMouseEvents
		// forwarding on the transparent HUD overlay.  Re-assert it after a short
		// delay so the renderer's hover detection keeps working.
		reassertHudOverlayMouseState();
		activeUpdateNotification = notification;
		activeUpdateNotificationKey = notificationKey;
		return true;
	}

	if (!payload) {
		const existingWindow = getUpdateToastWindow();
		if (!existingWindow) {
			return false;
		}

		existingWindow.webContents.send(channel, null);
		hideUpdateToastWindow();
		return true;
	}

	const toastWindow = showUpdateToastWindow();
	const sendPayload = () => {
		toastWindow.webContents.send(channel, payload);
		showUpdateToastWindow();
	};

	if (toastWindow.webContents.isLoadingMainFrame()) {
		toastWindow.webContents.once("did-finish-load", sendPayload);
	} else {
		sendPayload();
	}

	return true;
}

function getUpdateDialogWindow() {
	const focusedWindow = BrowserWindow.getFocusedWindow();
	if (focusedWindow && !focusedWindow.isDestroyed()) {
		return focusedWindow;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		return mainWindow;
	}

	return getHudOverlayWindow();
}

ipcMain.handle("install-downloaded-update", () => {
	installDownloadedUpdateNow(sendUpdateToastToWindows);
	return { success: true };
});

ipcMain.handle("download-available-update", (_event, installAfterDownload?: boolean) => {
	return downloadAvailableUpdate(sendUpdateToastToWindows, {
		installAfterDownload: Boolean(installAfterDownload),
	});
});

ipcMain.handle("defer-downloaded-update", (_event, delayMs?: number) => {
	return deferUpdateReminder(getUpdateDialogWindow, sendUpdateToastToWindows, delayMs);
});

ipcMain.handle("dismiss-update-toast", () => {
	return dismissUpdateToast(getUpdateDialogWindow, sendUpdateToastToWindows);
});

ipcMain.handle("skip-update-version", () => {
	return skipAvailableUpdateVersion(sendUpdateToastToWindows);
});

ipcMain.handle("get-current-update-toast-payload", () => {
	return getCurrentUpdateToastPayload();
});

ipcMain.handle("get-update-status-summary", () => {
	return getUpdateStatusSummary();
});

ipcMain.handle("preview-update-toast", () => {
	return { success: previewUpdateToast(sendUpdateToastToWindows) };
});

ipcMain.handle("check-for-app-updates", async () => {
	await checkForAppUpdates(getUpdateDialogWindow, { manual: true });
	return { success: true, logPath: getUpdaterLogPath() };
});

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? getRecordingTrayIcon() : getDefaultTrayIcon();
	const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "VybeClip";
	const menuTemplate = recording
		? [
				{
					label: "Show Controls",
					click: () => {
						showOrCreateRecordingControls();
					},
				},
				{
					label: "Stop Recording",
					click: () => {
						const hud = getHudOverlayWindow();
						if (hud && !hud.isDestroyed()) {
							hud.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: "Open",
					click: () => {
						focusOrCreateMainWindow();
					},
				},
				{
					label: "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	const menu = Menu.buildFromTemplate(menuTemplate);
	trayContextMenu = menu;
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	if (process.platform !== "win32") {
		tray.setContextMenu(menu);
	}
}

/**
 * Shows the "you have unsaved changes" confirmation dialog for the given editor
 * window and, if the user chooses to save, waits for the renderer to finish
 * saving via the existing request-save-before-close/save-before-close-done
 * IPC round trip.
 *
 * Returns:
 * - "close": it is safe to close/quit (either there was nothing to save, the
 *   user chose to discard, or the save completed successfully).
 * - "cancel": the user canceled; closing/quitting should be aborted.
 */
async function promptToSaveUnsavedChangesBeforeClosing(
	editorWindow: BrowserWindow,
): Promise<"close" | "cancel"> {
	const choice = dialog.showMessageBoxSync(editorWindow, {
		type: "warning",
		buttons: ["Save & Close", "Discard & Close", "Cancel"],
		defaultId: 0,
		cancelId: 2,
		title: "Unsaved Changes",
		message: "You have unsaved changes.",
		detail: "Do you want to save your project before closing?",
	});

	if (choice === 1) {
		return "close";
	}

	if (choice !== 0) {
		return "cancel";
	}

	editorWindow.webContents.send("request-save-before-close");
	const saved = await new Promise<boolean>((resolve) => {
		ipcMain.once("save-before-close-done", (_event, savedResult: boolean) => {
			resolve(savedResult);
		});
	});

	return saved ? "close" : "cancel";
}

function createEditorWindowWrapper() {
	const existingEditorWindow = getExistingEditorWindow();
	if (existingEditorWindow) {
		mainWindow = existingEditorWindow;
		restoreWindowSafely(existingEditorWindow);
		return existingEditorWindow;
	}

	if (isCreatingEditorWindow) {
		const currentWindow = mainWindow;
		if (currentWindow && !currentWindow.isDestroyed()) {
			return currentWindow;
		}

		const currentEditorWindow = getExistingEditorWindow();
		if (currentEditorWindow) {
			mainWindow = currentEditorWindow;
			return currentEditorWindow;
		}
	}

	isCreatingEditorWindow = true;
	const previousWindow = mainWindow;
	if (previousWindow && !previousWindow.isDestroyed()) {
		const closingEditorWindow = isEditorWindow(previousWindow);

		if (closingEditorWindow) {
			closeEditorWindowBypassingUnsavedPrompt(previousWindow);
		} else {
			// It's the HUD or another window. Hide it instead of closing so background
			// tasks (like webcam finalizing) can finish in its renderer process.
			previousWindow.hide();
		}

		if (!closingEditorWindow) {
			isForceClosing = false;
		}
		if (mainWindow === previousWindow) {
			mainWindow = null;
		}
	}
	const editorWindow = createEditorWindow();
	mainWindow = editorWindow;
	editorHasUnsavedChanges = false;
	const hudWindow = getHudOverlayWindow();
	if (hudWindow && !hudWindow.isDestroyed()) {
		hudWindow.hide();
	}

	editorWindow.on("closed", () => {
		if (mainWindow === editorWindow) {
			mainWindow = null;
		}
		isCreatingEditorWindow = false;
		isForceClosing = false;
		editorHasUnsavedChanges = false;
		if (!isAppQuitting && !IS_SMOKE_EXPORT) {
			createWindow();
		}
	});

	editorWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) {
			return;
		}

		event.preventDefault();

		void promptToSaveUnsavedChangesBeforeClosing(editorWindow).then((outcome) => {
			if (outcome === "close") {
				closeEditorWindowBypassingUnsavedPrompt(editorWindow);
			}
		});
	});

	return editorWindow;
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

// Guards re-entrancy for the before-quit handler below: once we've confirmed
// it's safe to quit (or timed out waiting), further before-quit events
// (triggered by our own app.quit() call) should fall through immediately
// instead of re-prompting or re-waiting.
let isQuitConfirmed = false;
// True while we're already waiting on an in-flight autosave / showing the
// unsaved-changes dialog, so a second before-quit event (e.g. the user
// mashing Cmd+Q) doesn't spawn a second prompt.
let isQuitCheckInProgress = false;

const QUIT_AUTOSAVE_WAIT_TIMEOUT_MS = 5000;

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on("before-quit", (event) => {
	if (isQuitConfirmed) {
		isAppQuitting = true;
		killWindowsCaptureProcess();
		showCursor();
		cleanupNativeVideoExportSessions();
		void cleanupAllExportStreams();
		return;
	}

	const editorWindow = getExistingEditorWindow();

	if (!editorWindow || !editorHasUnsavedChanges) {
		isQuitConfirmed = true;
		return;
	}

	// There's an unsaved (or still in-flight autosaving) editor project.
	// Block quitting until we've either waited for the save to finish or
	// asked the user what to do, reusing the same dialog/IPC flow as
	// window-close. Never hang indefinitely: fall back to quitting anyway
	// after a short timeout so a stuck save can't trap the app open.
	event.preventDefault();

	if (isQuitCheckInProgress) {
		return;
	}
	isQuitCheckInProgress = true;

	const timeoutPromise = new Promise<"timeout">((resolve) => {
		setTimeout(() => resolve("timeout"), QUIT_AUTOSAVE_WAIT_TIMEOUT_MS);
	});

	Promise.race([promptToSaveUnsavedChangesBeforeClosing(editorWindow), timeoutPromise])
		.then((outcome) => {
			isQuitCheckInProgress = false;
			if (outcome === "cancel") {
				return;
			}
			// "close" or "timeout": proceed with quitting.
			isQuitConfirmed = true;
			app.quit();
		})
		.catch(() => {
			isQuitCheckInProgress = false;
			isQuitConfirmed = true;
			app.quit();
		});
});

app.on("window-all-closed", () => {
	if (IS_SMOKE_EXPORT || process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	focusOrCreateMainWindow();
});

app.on("second-instance", () => {
	focusOrCreateMainWindow();
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	if (process.platform === "win32") {
		app.setAppUserModelId("studio.boxcreative.vybeclip");
	}

	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		callback(allowed.includes(permission));
	});

	session.defaultSession.setDevicePermissionHandler((_details) => true);

	if (process.platform === "win32") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (cameraStatus !== "granted") {
			console.warn(
				`[permissions] Camera access is "${cameraStatus}" — webcam may not work. Check Windows Settings > Privacy > Camera.`,
			);
		}
		if (micStatus !== "granted") {
			console.warn(
				`[permissions] Microphone access is "${micStatus}" — mic recording may not work. Check Windows Settings > Privacy > Microphone.`,
			);
		}
	}

	ipcMain.on("hud-overlay-close", () => {
		const hud = getHudOverlayWindow();
		if (hud) {
			console.log("[main] Closing HUD window via hud-overlay-close");
			hud.close();
		}

		// If this was the last window (or we are in a state where we should quit), do it.
		// We use a small delay to allow window.close() to propagate.
		setTimeout(() => {
			const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
			if (windows.length === 0) {
				console.log("[main] No windows left, quitting app");
				app.quit();
			}
		}, 100);
	});
	syncDockIcon();
	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	if (!VITE_DEV_SERVER_URL) {
		try {
			await ensurePackagedRendererServer(RENDERER_DIST);
		} catch (error) {
			console.warn("[renderer-server] Failed to start packaged renderer server:", error);
		}
	}

	try {
		await ensureMediaServer();
	} catch (error) {
		console.warn("[media-server] Failed to start media server:", error);
	}

	// Must run after the local servers above are started so the CSP can
	// allow-list their actual (randomly-assigned) ports.
	configureContentSecurityPolicy();

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			setHudOverlayRecordingActive(recording);
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (recording) {
				reassertHudOverlayMouseState();
			}
			if (!recording) {
				restoreWindowSafely(mainWindow);
			}
		},
	);

	registerExtensionIpcHandlers();

	ipcMain.handle("show-recording-controls", () => {
		showOrCreateRecordingControls();
		return { success: true };
	});

	if (IS_SMOKE_EXPORT || process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT) {
		await logSmokeExportGpuDiagnostics();
		if (IS_SMOKE_EXPORT) {
			const smokeSource =
				process.env.RECORDLY_SMOKE_EXPORT_PROJECT ??
				process.env.RECORDLY_SMOKE_EXPORT_INPUT ??
				"<missing input>";
			console.log(`[smoke-export] Starting editor smoke export for ${smokeSource}`);
		} else {
			console.log(
				`[dev-open-recording] Starting editor for ${process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT}`,
			);
		}
		createEditorWindowWrapper();
		return;
	}

	createWindow();
	setupAutoUpdates(getUpdateDialogWindow, sendUpdateToastToWindows);

	// Register the display media handler so that renderer's getDisplayMedia()
	// calls land on the pre-selected source without showing a system picker.
	//
	// IMPORTANT: The callback must receive a plain { id, name } Video object.
	// Passing the full DesktopCapturerSource (with thumbnail, appIcon, etc.)
	// via an unsafe cast breaks Electron's internal cursor-constraint
	// propagation and causes cursor: 'never' from the renderer to be silently
	// ignored by the native capture pipeline.
	session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
		try {
			const sourceId = getSelectedSourceId();
			// On Linux/Wayland, calling desktopCapturer.getSources() itself
			// invokes the xdg-desktop-portal picker. If we then return one of
			// those sources, Chromium triggers a SECOND portal because the
			// pre-enumerated source IDs are stale on Wayland. To collapse this
			// into a single portal invocation, when the Linux portal sentinel
			// is set we skip getSources entirely and hand back a synthetic
			// source id; Chromium then opens the portal once to actually
			// resolve the capture.
			// Default to the sentinel on Linux when no source has been
			// pre-selected (e.g. fresh session where the renderer skipped the
			// source picker entirely). This avoids calling getSources() which
			// would itself trigger an extra portal dialog.
			const isLinuxPortalSentinel =
				process.platform === "linux" && (sourceId === "screen:linux-portal" || !sourceId);
			if (isLinuxPortalSentinel) {
				callback({ video: { id: "screen:0:0", name: "Entire screen" } });
				return;
			}
			const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
			const source = sourceId
				? (sources.find((s) => s.id === sourceId) ?? sources[0])
				: sources[0];
			if (source) {
				callback({
					video: { id: source.id, name: source.name },
				});
			} else {
				callback({});
			}
		} catch (error) {
			console.error("setDisplayMediaRequestHandler error:", error);
			callback({});
		}
	});

	const currentToastPayload = getCurrentUpdateToastPayload();
	if (currentToastPayload) {
		sendUpdateToastToWindows("update-toast-state", currentToastPayload);
	}
});
