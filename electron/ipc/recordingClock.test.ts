import { describe, expect, it } from "vitest";

import { appendPauseInterval, mapWallClockToElapsedMs, resolvePauseInterval } from "./recordingClock";

describe("mapWallClockToElapsedMs", () => {
	const recordingStartMs = 1_000_000;
	const recordingEndMs = 1_100_000; // 100s recording

	it("maps a timestamp with no pauses to a simple offset from the start", () => {
		expect(
			mapWallClockToElapsedMs(recordingStartMs + 5_000, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [],
			}),
		).toBe(5_000);
	});

	it("returns 0 for a timestamp exactly at the recording start", () => {
		expect(
			mapWallClockToElapsedMs(recordingStartMs, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [],
			}),
		).toBe(0);
	});

	it("subtracts a single completed pause that occurred before the timestamp", () => {
		// Paused for 10s starting 20s in, resumed at 30s. A timestamp at 50s
		// (recording-relative) should map to 40s elapsed (50 - 10 paused).
		const pausedAtMs = recordingStartMs + 20_000;
		const resumedAtMs = recordingStartMs + 30_000;
		const tsMs = recordingStartMs + 50_000;

		expect(
			mapWallClockToElapsedMs(tsMs, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [{ pausedAtMs, resumedAtMs }],
			}),
		).toBe(40_000);
	});

	it("subtracts multiple completed pauses that occurred before the timestamp", () => {
		const tsMs = recordingStartMs + 90_000;

		expect(
			mapWallClockToElapsedMs(tsMs, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [
					{ pausedAtMs: recordingStartMs + 10_000, resumedAtMs: recordingStartMs + 15_000 }, // 5s
					{ pausedAtMs: recordingStartMs + 40_000, resumedAtMs: recordingStartMs + 48_000 }, // 8s
				],
			}),
		).toBe(90_000 - 5_000 - 8_000);
	});

	it("does not subtract a pause that occurred entirely after the timestamp", () => {
		const tsMs = recordingStartMs + 10_000;

		expect(
			mapWallClockToElapsedMs(tsMs, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [{ pausedAtMs: recordingStartMs + 50_000, resumedAtMs: recordingStartMs + 60_000 }],
			}),
		).toBe(10_000);
	});

	it("returns null when the timestamp lands inside a completed pause window", () => {
		const pausedAtMs = recordingStartMs + 20_000;
		const resumedAtMs = recordingStartMs + 30_000;

		expect(
			mapWallClockToElapsedMs(pausedAtMs + 5_000, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [{ pausedAtMs, resumedAtMs }],
			}),
		).toBeNull();
	});

	it("treats a pause the recording stopped inside of as extending to recordingEndMs", () => {
		// Never resumed (e.g. the user paused, then clicked stop directly).
		const pausedAtMs = recordingStartMs + 20_000;

		expect(
			mapWallClockToElapsedMs(recordingEndMs - 1, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [{ pausedAtMs, resumedAtMs: null }],
			}),
		).toBeNull();
	});

	it("returns null for a timestamp before the recording started", () => {
		expect(
			mapWallClockToElapsedMs(recordingStartMs - 1, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [],
			}),
		).toBeNull();
	});

	it("returns null for a timestamp after the recording ended", () => {
		expect(
			mapWallClockToElapsedMs(recordingEndMs + 1, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [],
			}),
		).toBeNull();
	});

	it("clamps to 0 rather than going negative when pause intervals overlap (malformed data)", () => {
		// Defensive: valid, non-overlapping intervals can never sum to more
		// than the elapsed wall time — this only happens with malformed
		// (e.g. duplicated/overlapping) interval data, and must not produce
		// a negative elapsed time.
		expect(
			mapWallClockToElapsedMs(recordingStartMs + 1_000, {
				recordingStartMs,
				recordingEndMs,
				pauseIntervals: [
					{ pausedAtMs: recordingStartMs + 100, resumedAtMs: recordingStartMs + 900 },
					{ pausedAtMs: recordingStartMs + 200, resumedAtMs: recordingStartMs + 950 },
				],
			}),
		).toBe(0);
	});
});

describe("appendPauseInterval", () => {
	it("opens a new interval on an empty list", () => {
		expect(appendPauseInterval([], 1000)).toEqual([{ pausedAtMs: 1000, resumedAtMs: null }]);
	});

	it("opens a new interval when the last one is already resolved", () => {
		const existing = [{ pausedAtMs: 100, resumedAtMs: 200 }];
		expect(appendPauseInterval(existing, 1000)).toEqual([
			{ pausedAtMs: 100, resumedAtMs: 200 },
			{ pausedAtMs: 1000, resumedAtMs: null },
		]);
	});

	it("does NOT open a second interval when one is already open (duplicate pause call)", () => {
		// Regression: a duplicate pause-cursor-capture IPC call with no resume
		// in between must not leave the first interval permanently
		// unresolved — only the last array entry ever gets patched on resume.
		const existing = [{ pausedAtMs: 1000, resumedAtMs: null }];
		expect(appendPauseInterval(existing, 2000)).toEqual(existing);
		expect(appendPauseInterval(existing, 2000)).toHaveLength(1);
	});
});

describe("resolvePauseInterval", () => {
	it("resolves the open interval", () => {
		const existing = [{ pausedAtMs: 1000, resumedAtMs: null }];
		expect(resolvePauseInterval(existing, 1500)).toEqual([{ pausedAtMs: 1000, resumedAtMs: 1500 }]);
	});

	it("resolves only the LAST interval when several precede it", () => {
		const existing = [
			{ pausedAtMs: 100, resumedAtMs: 200 },
			{ pausedAtMs: 1000, resumedAtMs: null },
		];
		expect(resolvePauseInterval(existing, 1500)).toEqual([
			{ pausedAtMs: 100, resumedAtMs: 200 },
			{ pausedAtMs: 1000, resumedAtMs: 1500 },
		]);
	});

	it("is a no-op when there is no open interval (duplicate resume, or resume with no prior pause)", () => {
		expect(resolvePauseInterval([], 1500)).toEqual([]);
		const existing = [{ pausedAtMs: 100, resumedAtMs: 200 }];
		expect(resolvePauseInterval(existing, 1500)).toEqual(existing);
	});

	it("round-trips with appendPauseInterval: duplicate pause then a single resume leaves exactly one resolved interval", () => {
		let intervals: { pausedAtMs: number; resumedAtMs: number | null }[] = [];
		intervals = appendPauseInterval(intervals, 1000); // real pause
		intervals = appendPauseInterval(intervals, 1200); // duplicate — no-op
		intervals = resolvePauseInterval(intervals, 1500); // real resume

		expect(intervals).toEqual([{ pausedAtMs: 1000, resumedAtMs: 1500 }]);
	});
});
