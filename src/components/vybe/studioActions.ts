type StudioElectronApi = Pick<
	Window["electronAPI"],
	| "loadProjectFile"
	| "getAccessibilityPermissionStatus"
	| "getPlatform"
	| "getScreenRecordingPermissionStatus"
	| "getSources"
	| "openAccessibilityPreferences"
	| "openProjectFileAtPath"
	| "openScreenRecordingPreferences"
	| "openSourceSelector"
	| "openVideoFilePicker"
	| "requestAccessibilityPermission"
	| "setCurrentVideoPath"
	| "showRecordingControls"
	| "switchToEditor"
>;

export type StudioPermissionState = {
	platform: string;
	screenRecordingGranted: boolean;
	accessibilityGranted: boolean;
};

export async function getStudioPermissionState(
	api: StudioElectronApi,
): Promise<StudioPermissionState> {
	const platform = await api.getPlatform();
	if (platform !== "darwin") {
		return {
			platform,
			screenRecordingGranted: true,
			accessibilityGranted: true,
		};
	}

	const [screenRecording, accessibility] = await Promise.all([
		api.getScreenRecordingPermissionStatus(),
		api.getAccessibilityPermissionStatus(),
	]);

	return {
		platform,
		screenRecordingGranted: screenRecording.success && screenRecording.status === "granted",
		accessibilityGranted: accessibility.success && accessibility.trusted,
	};
}

export async function startStudioRecording(api: StudioElectronApi) {
	let permissions = await getStudioPermissionState(api);

	if (!permissions.screenRecordingGranted) {
		// macOS has no API to programmatically request Screen Recording access
		// (unlike camera/microphone) - only an actual capture-related call
		// triggers the native system prompt. getMediaAccessStatus() is a passive
		// read, so if this app has never been through that prompt, jumping
		// straight to System Settings leaves nothing there for the user to
		// grant. Trigger the real prompt now; if the user already declined it
		// before, this just fails silently like the status check did.
		await api.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
		permissions = await getStudioPermissionState(api);
	}

	if (!permissions.screenRecordingGranted) {
		await api.openScreenRecordingPreferences();
		throw new Error("Enable Screen Recording in System Settings, then reopen VybeClip");
	}
	if (!permissions.accessibilityGranted) {
		// Same issue as Screen Recording above: getAccessibilityPermissionStatus()
		// uses isTrustedAccessibilityClient(false), a passive read that never
		// prompts or registers the app in System Settings. The `true` variant
		// both triggers the real native prompt and adds/updates the app's own
		// entry there - without it, a first-time user has nothing to grant.
		await api.requestAccessibilityPermission().catch(() => null);
		permissions = await getStudioPermissionState(api);
	}

	if (!permissions.accessibilityGranted) {
		await api.openAccessibilityPreferences();
		throw new Error("Enable Accessibility in System Settings, then reopen VybeClip");
	}

	const result = await api.showRecordingControls();
	if (!result.success) {
		throw new Error("Could not open recording controls");
	}

	await api.openSourceSelector();
}

export async function importStudioVideo(api: StudioElectronApi) {
	const result = await api.openVideoFilePicker();
	if (result.canceled) return false;
	if (!result.success || !result.path) {
		throw new Error("Could not open that video");
	}

	await api.setCurrentVideoPath(result.path);
	await api.switchToEditor();
	return true;
}

export async function openStudioProject(api: StudioElectronApi) {
	const result = await api.loadProjectFile();
	if (result.canceled) return false;
	if (!result.success) {
		throw new Error(result.message || "Could not open that project");
	}

	await api.switchToEditor();
	return true;
}

export async function openRecentStudioProject(api: StudioElectronApi, projectPath: string) {
	const result = await api.openProjectFileAtPath(projectPath);
	if (result.canceled) return false;
	if (!result.success) {
		throw new Error(result.message || "Could not open that project");
	}

	await api.switchToEditor();
	return true;
}
