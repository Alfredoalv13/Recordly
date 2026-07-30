import { afterEach, describe, expect, it, vi } from "vitest";

const { readFile, access } = vi.hoisted(() => ({
	readFile: vi.fn(),
	access: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: { readFile, access },
}));

import {
	blurBoxEventLogExists,
	getBlurBoxEventLogPath,
	normalizeBlurBoxEvents,
	readBlurBoxEvents,
} from "./eventLog";

function withPlatform(platform: NodeJS.Platform, run: () => void) {
	const original = process.platform;
	Object.defineProperty(process, "platform", { value: platform, configurable: true });
	try {
		run();
	} finally {
		Object.defineProperty(process, "platform", { value: original, configurable: true });
	}
}

function enoent(): NodeJS.ErrnoException {
	const error = new Error("ENOENT") as NodeJS.ErrnoException;
	error.code = "ENOENT";
	return error;
}

describe("getBlurBoxEventLogPath", () => {
	it("returns a path under Application Support on macOS", () => {
		withPlatform("darwin", () => {
			const logPath = getBlurBoxEventLogPath();
			expect(logPath).not.toBeNull();
			expect(logPath).toContain("Library/Application Support/BlurBox/redaction-events.jsonl");
		});
	});

	it("returns null on non-macOS platforms", () => {
		withPlatform("win32", () => {
			expect(getBlurBoxEventLogPath()).toBeNull();
		});
	});
});

describe("readBlurBoxEvents", () => {
	afterEach(() => {
		readFile.mockReset();
	});

	it("returns an empty array on non-macOS without touching the filesystem", async () => {
		await withPlatform("win32", async () => {
			const events = await readBlurBoxEvents();
			expect(events).toEqual([]);
			expect(readFile).not.toHaveBeenCalled();
		});
	});

	it("returns an empty array when the log file doesn't exist (ENOENT)", async () => {
		await withPlatform("darwin", async () => {
			readFile.mockRejectedValueOnce(enoent());
			expect(await readBlurBoxEvents()).toEqual([]);
		});
	});

	it("parses well-formed lines of every event type", async () => {
		await withPlatform("darwin", async () => {
			const lines = [
				`{"v":1,"type":"create_action_started","ts":1000,"action":"instant"}`,
				`{"v":1,"type":"overlay_created","ts":1010,"overlayId":"a","frame":{"x":1,"y":2,"width":3,"height":4}}`,
				`{"v":1,"type":"overlay_updated","ts":1500,"overlayId":"a","frame":{"x":5,"y":6,"width":7,"height":8}}`,
				`{"v":1,"type":"overlay_removed","ts":2000,"overlayId":"a"}`,
			].join("\n");
			readFile.mockResolvedValueOnce(lines);

			const events = await readBlurBoxEvents();
			expect(events).toHaveLength(4);
			expect(events.map((e) => e.type)).toEqual([
				"create_action_started",
				"overlay_created",
				"overlay_updated",
				"overlay_removed",
			]);
			expect(events[1].frame).toEqual({ x: 1, y: 2, width: 3, height: 4 });
			expect(events[0].action).toBe("instant");
		});
	});

	it("skips a malformed line without dropping the rest of the file", async () => {
		await withPlatform("darwin", async () => {
			const lines = [
				`{"v":1,"type":"overlay_created","ts":1000,"overlayId":"a","frame":{"x":0,"y":0,"width":1,"height":1}}`,
				`{not valid json at all`,
				`{"v":1,"type":"overlay_removed","ts":2000,"overlayId":"a"}`,
			].join("\n");
			readFile.mockResolvedValueOnce(lines);

			const events = await readBlurBoxEvents();
			expect(events.map((e) => e.type)).toEqual(["overlay_created", "overlay_removed"]);
		});
	});

	it("skips a line with an unrecognized schema version", async () => {
		await withPlatform("darwin", async () => {
			const lines = [
				`{"v":1,"type":"overlay_created","ts":1000,"overlayId":"a"}`,
				`{"v":2,"type":"some_future_event","ts":1500,"overlayId":"a"}`,
			].join("\n");
			readFile.mockResolvedValueOnce(lines);

			const events = await readBlurBoxEvents();
			expect(events).toHaveLength(1);
			expect(events[0].v).toBe(1);
		});
	});

	it("skips a line with an unrecognized type, a missing ts, or blank lines", async () => {
		await withPlatform("darwin", async () => {
			const lines = [
				`{"v":1,"type":"totally_unknown","ts":1000,"overlayId":"a"}`,
				`{"v":1,"type":"overlay_created","overlayId":"a"}`,
				``,
				`   `,
				`{"v":1,"type":"overlay_removed","ts":3000,"overlayId":"a"}`,
			].join("\n");
			readFile.mockResolvedValueOnce(lines);

			const events = await readBlurBoxEvents();
			expect(events.map((e) => e.type)).toEqual(["overlay_removed"]);
		});
	});
});

describe("blurBoxEventLogExists", () => {
	afterEach(() => {
		access.mockReset();
	});

	it("returns false on non-macOS", async () => {
		await withPlatform("win32", async () => {
			expect(await blurBoxEventLogExists()).toBe(false);
			expect(access).not.toHaveBeenCalled();
		});
	});

	it("returns true when the file is accessible", async () => {
		await withPlatform("darwin", async () => {
			access.mockResolvedValueOnce(undefined);
			expect(await blurBoxEventLogExists()).toBe(true);
		});
	});

	it("returns false when access rejects (file missing)", async () => {
		await withPlatform("darwin", async () => {
			access.mockRejectedValueOnce(enoent());
			expect(await blurBoxEventLogExists()).toBe(false);
		});
	});
});

describe("normalizeBlurBoxEvents", () => {
	const clockParams = {
		recordingStartMs: 1_000_000,
		recordingEndMs: 1_100_000,
		pauseIntervals: [],
	};

	it("maps raw events to video-relative elapsed ms, dropping type/overlayId/action correctly", () => {
		const normalized = normalizeBlurBoxEvents(
			[
				{
					v: 1,
					type: "create_action_started",
					ts: clockParams.recordingStartMs + 100,
					action: "drag",
				},
				{
					v: 1,
					type: "overlay_created",
					ts: clockParams.recordingStartMs + 200,
					overlayId: "a",
					frame: { x: 0, y: 0, width: 1, height: 1 },
				},
			],
			clockParams,
		);

		expect(normalized).toEqual([
			{ type: "create_action_started", elapsedMs: 100, action: "drag" },
			{ type: "overlay_created", elapsedMs: 200, overlayId: "a" },
		]);
		// frame is intentionally not part of the normalized shape
		expect(normalized[1]).not.toHaveProperty("frame");
	});

	it("drops events that fall outside the recording window (mapWallClockToElapsedMs returns null)", () => {
		const normalized = normalizeBlurBoxEvents(
			[
				{
					v: 1,
					type: "overlay_created",
					ts: clockParams.recordingStartMs - 5_000,
					overlayId: "a",
				},
				{
					v: 1,
					type: "overlay_created",
					ts: clockParams.recordingStartMs + 100,
					overlayId: "b",
				},
			],
			clockParams,
		);

		expect(normalized).toHaveLength(1);
		expect(normalized[0].overlayId).toBe("b");
	});
});
