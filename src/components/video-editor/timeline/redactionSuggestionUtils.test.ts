import { describe, expect, it } from "vitest";
import {
	type BlurBoxRedactionEvent,
	buildRedactionEpisodes,
	buildRedactionSuggestions,
	clampAdjustedRedactionSpan,
	clusterRedactionEpisodesIntoSuggestions,
	MIN_MANUAL_REDACTION_ADJUST_MS,
	PRE_CREATION_REDACTION_WINDOW_MS,
	type RedactionEpisode,
} from "./redactionSuggestionUtils";

function started(elapsedMs: number, action: "instant" | "drag" = "instant"): BlurBoxRedactionEvent {
	return { type: "create_action_started", elapsedMs, action };
}
function created(elapsedMs: number, overlayId: string): BlurBoxRedactionEvent {
	return { type: "overlay_created", elapsedMs, overlayId };
}
function updated(elapsedMs: number, overlayId: string): BlurBoxRedactionEvent {
	return { type: "overlay_updated", elapsedMs, overlayId };
}
function removed(elapsedMs: number, overlayId: string): BlurBoxRedactionEvent {
	return { type: "overlay_removed", elapsedMs, overlayId };
}

describe("buildRedactionEpisodes (Stage A)", () => {
	it("builds a fixed-length window ending at overlay_created", () => {
		const episodes = buildRedactionEpisodes([created(5000, "a")]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 5000 - PRE_CREATION_REDACTION_WINDOW_MS, end: 5000 },
		]);
	});

	it("ignores create_action_started entirely — only overlay_created anchors the window", () => {
		const episodes = buildRedactionEpisodes([started(0), created(5000, "a")]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 5000 - PRE_CREATION_REDACTION_WINDOW_MS, end: 5000 },
		]);
	});

	it("ignores overlay_updated entirely — the window never extends past creation", () => {
		const episodes = buildRedactionEpisodes([created(5000, "a"), updated(9000, "a")]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 5000 - PRE_CREATION_REDACTION_WINDOW_MS, end: 5000 },
		]);
	});

	it("honors a custom windowMs override", () => {
		const episodes = buildRedactionEpisodes([created(5000, "a")], 500);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 4500, end: 5000 }]);
	});

	it("excludes a create+immediate-delete with no move in between (accidental-create guard)", () => {
		const episodes = buildRedactionEpisodes([
			created(3050, "a"),
			removed(3600, "a"), // 550ms after creation, within the 1000ms grace, no update
		]);
		expect(episodes).toEqual([]);
	});

	it("does NOT apply the accidental-create guard when the box was moved before being removed", () => {
		const episodes = buildRedactionEpisodes([
			created(4050, "a"),
			updated(4300, "a"),
			removed(4400, "a"), // within the grace window, but there WAS a move — real redaction
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 4050 - PRE_CREATION_REDACTION_WINDOW_MS, end: 4050 },
		]);
	});

	it("does not apply the accidental-create guard once removal happens after the grace period", () => {
		const episodes = buildRedactionEpisodes([created(5050, "a"), removed(7000, "a")]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 5050 - PRE_CREATION_REDACTION_WINDOW_MS, end: 5050 },
		]);
	});

	it("produces independent windows for independent overlays", () => {
		const episodes = buildRedactionEpisodes([created(1050, "a"), created(20_200, "b")]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 1050 - PRE_CREATION_REDACTION_WINDOW_MS, end: 1050 },
			{ start: 20_200 - PRE_CREATION_REDACTION_WINDOW_MS, end: 20_200 },
		]);
	});

	it("skips an overlay id that has events but no overlay_created (repositioning an existing box, out of v1 scope)", () => {
		const episodes = buildRedactionEpisodes([updated(1000, "a")]);
		expect(episodes).toEqual([]);
	});

	it("returns an empty array for an empty event list", () => {
		expect(buildRedactionEpisodes([])).toEqual([]);
	});
});

describe("clusterRedactionEpisodesIntoSuggestions (Stage B + C)", () => {
	it("clamps a window to [0, totalMs] at the edges of the recording", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions([{ start: -800, end: 700 }], {
			totalMs: 30_000,
		});
		expect(suggestions).toEqual([{ start: 0, end: 700, isLongOutlier: false }]);
	});

	it("merges two windows whose gap is exactly at the merge threshold", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 1000, end: 2000 },
				{ start: 4000, end: 4500 }, // gap = 2000ms, equal to the default merge gap
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([{ start: 1000, end: 4500, isLongOutlier: false }]);
	});

	it("does not merge two windows whose gap exceeds the merge threshold by 1ms", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 1000, end: 2000 },
				{ start: 4001, end: 4500 }, // gap = 2001ms
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([
			{ start: 1000, end: 2000, isLongOutlier: false },
			{ start: 4001, end: 4500, isLongOutlier: false },
		]);
	});

	it("merges a fully-nested window without shrinking or duplicating the outer window", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 1000, end: 5000 },
				{ start: 2000, end: 3000 }, // entirely inside the first
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([{ start: 1000, end: 5000, isLongOutlier: false }]);
	});

	it("flags but does not drop a merged window longer than maxWindowMs", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[{ start: 1000, end: 26_000 }],
			{ totalMs: 40_000 },
		);
		expect(suggestions).toEqual([{ start: 1000, end: 26_000, isLongOutlier: true }]);
	});

	it("drops a window that collapses to zero-width after clamping to a near-zero totalMs", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions([{ start: 1000, end: 2000 }], {
			totalMs: 0,
		});
		expect(suggestions).toEqual([]);
	});

	it("returns an empty array for an empty episode list", () => {
		expect(clusterRedactionEpisodesIntoSuggestions([], { totalMs: 30_000 })).toEqual([]);
	});

	it("sorts suggestions chronologically", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 20_000, end: 20_500 },
				{ start: 1000, end: 1500 },
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions.map((s) => s.start)).toEqual([1000, 20_000]);
	});
});

describe("buildRedactionSuggestions (full pipeline)", () => {
	it("a single box creation produces one 1.5s suggestion ending at creation", () => {
		const suggestions = buildRedactionSuggestions([created(5000, "a")], { totalMs: 30_000 });
		expect(suggestions).toEqual([{ start: 3500, end: 5000, isLongOutlier: false }]);
	});

	it("an accidental create+immediate-delete with no move produces no suggestion", () => {
		const suggestions = buildRedactionSuggestions([created(1000, "a"), removed(1200, "a")], {
			totalMs: 30_000,
		});
		expect(suggestions).toEqual([]);
	});

	it("two overlays created close together merge into a single suggestion", () => {
		const suggestions = buildRedactionSuggestions(
			[created(10_000, "a"), created(11_200, "b")],
			{ totalMs: 30_000 },
		);
		// window a: [8500, 10000], window b: [9700, 11200] — overlapping, merge to one.
		expect(suggestions).toEqual([{ start: 8500, end: 11_200, isLongOutlier: false }]);
	});
});

describe("clampAdjustedRedactionSpan (manual timeline handle drag)", () => {
	const current = { start: 5000, end: 8000 };

	it("moves the start edge to a valid proposed position", () => {
		expect(clampAdjustedRedactionSpan(current, "start", 3000, 30_000)).toEqual({
			start: 3000,
			end: 8000,
		});
	});

	it("moves the end edge to a valid proposed position", () => {
		expect(clampAdjustedRedactionSpan(current, "end", 9000, 30_000)).toEqual({
			start: 5000,
			end: 9000,
		});
	});

	it("clamps the start edge to 0 when dragged past the beginning", () => {
		expect(clampAdjustedRedactionSpan(current, "start", -500, 30_000)).toEqual({
			start: 0,
			end: 8000,
		});
	});

	it("clamps the end edge to totalMs when dragged past the video's end", () => {
		expect(clampAdjustedRedactionSpan(current, "end", 40_000, 30_000)).toEqual({
			start: 5000,
			end: 30_000,
		});
	});

	it("prevents the start edge from crossing the end edge closer than the min window", () => {
		const result = clampAdjustedRedactionSpan(current, "start", 7999, 30_000);
		expect(result.end).toBe(8000);
		expect(result.start).toBe(8000 - MIN_MANUAL_REDACTION_ADJUST_MS);
	});

	it("prevents the end edge from crossing the start edge closer than the min window", () => {
		const result = clampAdjustedRedactionSpan(current, "end", 5001, 30_000);
		expect(result.start).toBe(5000);
		expect(result.end).toBe(5000 + MIN_MANUAL_REDACTION_ADJUST_MS);
	});

	it("never modifies the edge that wasn't dragged", () => {
		expect(clampAdjustedRedactionSpan(current, "start", 100, 30_000).end).toBe(current.end);
		expect(clampAdjustedRedactionSpan(current, "end", 29_000, 30_000).start).toBe(
			current.start,
		);
	});
});
