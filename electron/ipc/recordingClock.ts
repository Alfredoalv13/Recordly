import type { RecordingPauseInterval } from "./state";

export interface RecordingClockParams {
	recordingStartMs: number;
	recordingEndMs: number;
	pauseIntervals: RecordingPauseInterval[];
}

/**
 * Maps an arbitrary wall-clock timestamp (e.g. from an external app's event
 * log, read back after the fact) to video-relative elapsed milliseconds,
 * accounting for every pause/resume interval during the recording.
 *
 * Distinct from `getCursorCaptureElapsedMs` in cursor/telemetry.ts, which
 * only answers "elapsed as of right now" using a running paused-duration
 * total — that's wrong for a historical timestamp, since a total accumulated
 * *after* the timestamp would be incorrectly subtracted from it. This
 * function instead walks the ordered interval list and only subtracts pause
 * time that occurred strictly before `tsMs`.
 *
 * Returns `null` when `tsMs` falls outside the recording (`< recordingStartMs`
 * or `> recordingEndMs`), or lands inside a completed pause window — in both
 * cases nothing was actually being recorded at that instant, so callers
 * should drop the event rather than mapping it to a fabricated time.
 */
export function mapWallClockToElapsedMs(tsMs: number, params: RecordingClockParams): number | null {
	const { recordingStartMs, recordingEndMs, pauseIntervals } = params;

	if (tsMs < recordingStartMs || tsMs > recordingEndMs) {
		return null;
	}

	let pauseDurationBeforeTs = 0;

	for (const interval of pauseIntervals) {
		// A pause the recording stopped inside of (never resumed) extends to
		// the end of the recording.
		const resumedAtMs = interval.resumedAtMs ?? recordingEndMs;

		if (tsMs >= interval.pausedAtMs && tsMs < resumedAtMs) {
			// tsMs falls strictly inside this pause window — nothing was
			// being recorded at that instant.
			return null;
		}

		if (interval.pausedAtMs < tsMs) {
			pauseDurationBeforeTs += Math.max(0, Math.min(resumedAtMs, tsMs) - interval.pausedAtMs);
		}
	}

	return Math.max(0, tsMs - recordingStartMs - pauseDurationBeforeTs);
}

/**
 * Opens a new pause interval, unless one is already open.
 *
 * The renderer's pause guard reads React state through a closure
 * (`if (!recording || paused) return;`) — two rapid pause invocations can
 * both observe `paused === false` before the first call's `setPaused(true)`
 * commits, so a duplicate `pause-cursor-capture` IPC call with no resume in
 * between is a real scenario, not just a defensive hypothetical (mirrors
 * `pauseCursorCaptureAtBoundary`'s own idempotency guard in cursor/telemetry.ts,
 * which exists for exactly this reason).
 *
 * Appending a second open interval on a duplicate call would leave the
 * FIRST one permanently unresolved, since resume only ever patches the last
 * array entry — `mapWallClockToElapsedMs` would then treat every timestamp
 * from that stale pause onward as "inside a pause" for the rest of the
 * recording.
 */
export function appendPauseInterval(
	intervals: RecordingPauseInterval[],
	pausedAtMs: number,
): RecordingPauseInterval[] {
	const lastIndex = intervals.length - 1;
	const alreadyPaused = lastIndex >= 0 && intervals[lastIndex].resumedAtMs === null;
	if (alreadyPaused) {
		return intervals;
	}
	return [...intervals, { pausedAtMs, resumedAtMs: null }];
}

/**
 * Resolves the most recent open pause interval, if any. A resume with no
 * open pause (duplicate resume, or resume with no prior pause at all) is a
 * safe no-op — mirrors `resumeCursorCapture`'s own guard.
 */
export function resolvePauseInterval(
	intervals: RecordingPauseInterval[],
	resumedAtMs: number,
): RecordingPauseInterval[] {
	const lastIndex = intervals.length - 1;
	if (lastIndex < 0 || intervals[lastIndex].resumedAtMs !== null) {
		return intervals;
	}
	const updated = intervals.slice();
	updated[lastIndex] = { ...updated[lastIndex], resumedAtMs };
	return updated;
}
