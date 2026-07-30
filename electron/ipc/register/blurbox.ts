import { ipcMain } from "electron";
import {
	blurBoxEventLogExists,
	normalizeBlurBoxEvents,
	readBlurBoxEvents,
} from "../blurbox/eventLog";
import { cursorCaptureStartTimeMs, recordingPauseIntervals, recordingStoppedAtMs } from "../state";

export function registerBlurBoxHandlers() {
	ipcMain.handle("get-blurbox-redaction-events", async () => {
		try {
			const installed = await blurBoxEventLogExists();

			// No recording has finished in this app session yet, so there's
			// no [start, end] window to correlate against. This mirrors
			// auto-zoom's existing scope — both only ever apply to a
			// just-finished recording, not an arbitrarily reopened old
			// project from a previous session.
			if (!cursorCaptureStartTimeMs || recordingStoppedAtMs === null) {
				return { success: true, installed, events: [] };
			}

			const rawEvents = await readBlurBoxEvents();
			const events = normalizeBlurBoxEvents(rawEvents, {
				recordingStartMs: cursorCaptureStartTimeMs,
				recordingEndMs: recordingStoppedAtMs,
				pauseIntervals: recordingPauseIntervals,
			});

			return { success: true, installed, events };
		} catch (error) {
			console.error("Failed to read BlurBox redaction events:", error);
			return {
				success: false,
				message: "Failed to read BlurBox redaction events",
				error: String(error),
				installed: false,
				events: [],
			};
		}
	});
}
