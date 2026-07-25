import { describe, expect, it } from "vitest";
import type { ClipRegion } from "../types";
import { applySilenceSpansToClipRegions, detectSilenceSpans } from "./silenceDetection";

const SAMPLE_RATE = 1000; // 1 sample = 1ms, keeps the math easy to reason about.

function tone(durationMs: number, amplitude: number): Float32Array {
	const samples = new Float32Array(durationMs);
	samples.fill(amplitude);
	return samples;
}

function concat(...parts: Float32Array[]): Float32Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Float32Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const LOUD = 0.5; // ~ -6 dBFS
const QUIET = 0.0001; // ~ -80 dBFS, well below any reasonable threshold

describe("detectSilenceSpans", () => {
	it("returns nothing for empty input", () => {
		expect(detectSilenceSpans([], SAMPLE_RATE)).toEqual([]);
		expect(detectSilenceSpans([new Float32Array(0)], SAMPLE_RATE)).toEqual([]);
	});

	it("returns nothing when the whole clip is loud", () => {
		const channel = tone(2000, LOUD);
		expect(detectSilenceSpans([channel], SAMPLE_RATE)).toEqual([]);
	});

	it("detects a silent gap long enough to clear the minimum duration, with padding applied", () => {
		const channel = concat(tone(1000, LOUD), tone(2000, QUIET), tone(1000, LOUD));
		const spans = detectSilenceSpans([channel], SAMPLE_RATE, {
			minSilenceMs: 700,
			paddingMs: 100,
			windowMs: 50,
		});
		expect(spans).toHaveLength(1);
		expect(spans[0].startMs).toBeCloseTo(1100, -1);
		expect(spans[0].endMs).toBeCloseTo(2900, -1);
		// Padding keeps room on both sides of the raw 1000-3000ms gap.
		expect(spans[0].startMs).toBeGreaterThan(1000);
		expect(spans[0].endMs).toBeLessThan(3000);
	});

	it("ignores a quiet gap shorter than the minimum silence duration", () => {
		const channel = concat(tone(1000, LOUD), tone(300, QUIET), tone(1000, LOUD));
		const spans = detectSilenceSpans([channel], SAMPLE_RATE, {
			minSilenceMs: 700,
			paddingMs: 100,
			windowMs: 50,
		});
		expect(spans).toEqual([]);
	});

	it("drops a gap that becomes degenerate once padding is subtracted from both sides", () => {
		const channel = concat(tone(1000, LOUD), tone(750, QUIET), tone(1000, LOUD));
		const spans = detectSilenceSpans([channel], SAMPLE_RATE, {
			minSilenceMs: 700,
			paddingMs: 400, // 2 * 400 = 800 > 750, so nothing should survive
			windowMs: 50,
		});
		expect(spans).toEqual([]);
	});

	it("handles silence starting at time zero and silence running to the end", () => {
		const channel = concat(tone(2000, QUIET), tone(1000, LOUD), tone(2000, QUIET));
		const spans = detectSilenceSpans([channel], SAMPLE_RATE, {
			minSilenceMs: 700,
			paddingMs: 50,
			windowMs: 50,
		});
		expect(spans).toHaveLength(2);
		expect(spans[0].startMs).toBeCloseTo(50, -1);
		expect(spans[1].endMs).toBeCloseTo(4950, -1);
	});

	it("treats multi-channel audio as quiet only when all channels are quiet", () => {
		const loudLeft = concat(tone(1000, LOUD), tone(2000, LOUD), tone(1000, LOUD));
		const quietRight = concat(tone(1000, LOUD), tone(2000, QUIET), tone(1000, LOUD));
		// One channel stays loud throughout - the combined signal should not read as silence.
		const spans = detectSilenceSpans([loudLeft, quietRight], SAMPLE_RATE, {
			minSilenceMs: 700,
			paddingMs: 100,
			windowMs: 50,
		});
		expect(spans).toEqual([]);
	});

	it("detects silence when all channels are quiet together", () => {
		const left = concat(tone(1000, LOUD), tone(2000, QUIET), tone(1000, LOUD));
		const right = concat(tone(1000, LOUD), tone(2000, QUIET), tone(1000, LOUD));
		const spans = detectSilenceSpans([left, right], SAMPLE_RATE, {
			minSilenceMs: 700,
			paddingMs: 100,
			windowMs: 50,
		});
		expect(spans).toHaveLength(1);
	});
});

function makeClip(id: string, startMs: number, endMs: number, extra: Partial<ClipRegion> = {}): ClipRegion {
	return { id, startMs, endMs, speed: 1, ...extra };
}

let idCounter = 0;
function nextTestId() {
	idCounter += 1;
	return `generated-${idCounter}`;
}

describe("applySilenceSpansToClipRegions", () => {
	it("returns the input unchanged when there are no spans or no clips", () => {
		const clips = [makeClip("c1", 0, 1000)];
		expect(applySilenceSpansToClipRegions(clips, [], nextTestId)).toEqual({
			clipRegions: clips,
			removedSpans: [],
		});
		expect(applySilenceSpansToClipRegions([], [{ startMs: 0, endMs: 100 }], nextTestId)).toEqual({
			clipRegions: [],
			removedSpans: [],
		});
	});

	it("splits a clip around a silence span in the middle, keeping the original id on the first piece", () => {
		const clips = [makeClip("c1", 0, 1000, { speed: 1.5, muted: false })];
		const result = applySilenceSpansToClipRegions(
			clips,
			[{ startMs: 400, endMs: 600 }],
			nextTestId,
		);
		expect(result.clipRegions).toHaveLength(2);
		expect(result.clipRegions[0]).toMatchObject({ id: "c1", startMs: 0, endMs: 400, speed: 1.5 });
		expect(result.clipRegions[1]).toMatchObject({ startMs: 600, endMs: 1000, speed: 1.5 });
		expect(result.clipRegions[1].id).not.toBe("c1");
		expect(result.removedSpans).toEqual([{ startMs: 400, endMs: 600 }]);
	});

	it("keeps the original id on the surviving piece when silence starts exactly at the clip start", () => {
		const clips = [makeClip("c1", 0, 1000)];
		const result = applySilenceSpansToClipRegions(
			clips,
			[{ startMs: 0, endMs: 400 }],
			nextTestId,
		);
		expect(result.clipRegions).toEqual([makeClip("c1", 400, 1000)]);
	});

	it("keeps the original id on the surviving piece when silence ends exactly at the clip end", () => {
		const clips = [makeClip("c1", 0, 1000)];
		const result = applySilenceSpansToClipRegions(
			clips,
			[{ startMs: 600, endMs: 1000 }],
			nextTestId,
		);
		expect(result.clipRegions).toEqual([makeClip("c1", 0, 600)]);
	});

	it("removes a clip entirely when silence covers it end to end", () => {
		const clips = [makeClip("c1", 0, 1000), makeClip("c2", 1000, 2000)];
		const result = applySilenceSpansToClipRegions(
			clips,
			[{ startMs: 0, endMs: 1000 }],
			nextTestId,
		);
		expect(result.clipRegions).toEqual([makeClip("c2", 1000, 2000)]);
		expect(result.removedSpans).toEqual([{ startMs: 0, endMs: 1000 }]);
	});

	it("clamps a silence span to each clip's own bounds and leaves non-overlapping clips untouched", () => {
		const clips = [makeClip("c1", 0, 1000), makeClip("c2", 1000, 2000)];
		const result = applySilenceSpansToClipRegions(
			clips,
			[{ startMs: 900, endMs: 1100 }],
			nextTestId,
		);
		expect(result.clipRegions).toEqual([makeClip("c1", 0, 900), makeClip("c2", 1100, 2000)]);
		expect(result.removedSpans).toEqual([
			{ startMs: 900, endMs: 1000 },
			{ startMs: 1000, endMs: 1100 },
		]);
	});

	it("handles multiple silence spans within a single clip", () => {
		const clips = [makeClip("c1", 0, 1000)];
		const result = applySilenceSpansToClipRegions(
			clips,
			[
				{ startMs: 200, endMs: 300 },
				{ startMs: 600, endMs: 700 },
			],
			nextTestId,
		);
		expect(result.clipRegions.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
			{ startMs: 0, endMs: 200 },
			{ startMs: 300, endMs: 600 },
			{ startMs: 700, endMs: 1000 },
		]);
		expect(result.clipRegions[0].id).toBe("c1");
	});
});
