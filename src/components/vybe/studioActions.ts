type StudioElectronApi = Pick<
	Window["electronAPI"],
	| "loadProjectFile"
	| "getAccessibilityPermissionStatus"
	| "getPlatform"
	| "getScreenRecordingPermissionStatus"
	| "openAccessibilityPreferences"
	| "openProjectFileAtPath"
	| "openScreenRecordingPreferences"
	| "openSourceSelector"
	| "openVideoFilePicker"
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
	const permissions = await getStudioPermissionState(api);
	if (!permissions.screenRecordingGranted) {
		await api.openScreenRecordingPreferences();
		throw new Error("Enable Screen Recording in System Settings, then reopen VybeClip");
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
