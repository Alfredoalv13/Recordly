type StudioElectronApi = Pick<
	Window["electronAPI"],
	| "loadProjectFile"
	| "openProjectFileAtPath"
	| "openSourceSelector"
	| "openVideoFilePicker"
	| "setCurrentVideoPath"
	| "showRecordingControls"
	| "switchToEditor"
>;

export async function startStudioRecording(api: StudioElectronApi) {
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
