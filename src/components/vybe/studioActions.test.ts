import { describe, expect, it, vi } from "vitest";
import {
	importStudioVideo,
	openRecentStudioProject,
	openStudioProject,
	startStudioRecording,
} from "./studioActions";

function createApi() {
	return {
		showRecordingControls: vi.fn().mockResolvedValue({ success: true }),
		openSourceSelector: vi.fn().mockResolvedValue(undefined),
		openVideoFilePicker: vi.fn().mockResolvedValue({ success: true, path: "/tmp/capture.mp4" }),
		setCurrentVideoPath: vi.fn().mockResolvedValue({ success: true }),
		switchToEditor: vi.fn().mockResolvedValue(undefined),
		loadProjectFile: vi.fn().mockResolvedValue({ success: true, path: "/tmp/demo.vybeclip" }),
		openProjectFileAtPath: vi
			.fn()
			.mockResolvedValue({ success: true, path: "/tmp/demo.vybeclip" }),
	};
}

describe("VybeClip Studio actions", () => {
	it("opens recording controls before the source selector", async () => {
		const api = createApi();

		await startStudioRecording(api);

		expect(api.showRecordingControls).toHaveBeenCalledOnce();
		expect(api.openSourceSelector).toHaveBeenCalledOnce();
		expect(api.showRecordingControls.mock.invocationCallOrder[0]).toBeLessThan(
			api.openSourceSelector.mock.invocationCallOrder[0],
		);
	});

	it("imports a selected video before opening the editor", async () => {
		const api = createApi();

		await expect(importStudioVideo(api)).resolves.toBe(true);
		expect(api.setCurrentVideoPath).toHaveBeenCalledWith("/tmp/capture.mp4");
		expect(api.switchToEditor).toHaveBeenCalledOnce();
	});

	it("does not open the editor when video import is cancelled", async () => {
		const api = createApi();
		api.openVideoFilePicker.mockResolvedValue({ success: false, canceled: true });

		await expect(importStudioVideo(api)).resolves.toBe(false);
		expect(api.setCurrentVideoPath).not.toHaveBeenCalled();
		expect(api.switchToEditor).not.toHaveBeenCalled();
	});

	it("opens a project selected by the file picker", async () => {
		const api = createApi();

		await expect(openStudioProject(api)).resolves.toBe(true);
		expect(api.loadProjectFile).toHaveBeenCalledOnce();
		expect(api.switchToEditor).toHaveBeenCalledOnce();
	});

	it("opens a recent project by path", async () => {
		const api = createApi();

		await expect(openRecentStudioProject(api, "/tmp/recent.vybeclip")).resolves.toBe(true);
		expect(api.openProjectFileAtPath).toHaveBeenCalledWith("/tmp/recent.vybeclip");
		expect(api.switchToEditor).toHaveBeenCalledOnce();
	});
});
