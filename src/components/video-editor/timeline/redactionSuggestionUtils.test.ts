import { describe, expect, it } from "vitest";
import {
	type BlurBoxRedactionEvent,
	buildRedactionEpisodes,
	buildRedactionSuggestions,
	clusterRedactionEpisodesIntoSuggestions,
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
	it("anchors an episode's start to the nearest preceding create_action_started", () => {
		const episodes = buildRedactionEpisodes([
			started(1000),
			created(1050, "a"),
			updated(1600, "a"),
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 1000, end: 1600 }]);
	});

	it("falls back to the creation time when no create_action_started is within the match window", () => {
		const episodes = buildRedactionEpisodes([
			started(0), // 100_000ms before creation — well outside the 60s match window
			created(100_000, "a"),
			updated(100_500, "a"),
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 100_000, end: 100_500 }]);
	});

	it("matches the nearest preceding create_action_started, not an earlier unrelated one", () => {
		const episodes = buildRedactionEpisodes([
			started(1000),
			started(5000),
			created(5100, "a"),
			updated(5300, "a"),
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 5000, end: 5300 }]);
	});

	it("falls back to the creation time as the end when the overlay was never subsequently moved", () => {
		const episodes = buildRedactionEpisodes([started(2000), created(2050, "a")]);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 2000, end: 2050 }]);
	});

	it("excludes a create+immediate-delete with no move in between (accidental-create guard)", () => {
		const episodes = buildRedactionEpisodes([
			started(3000),
			created(3050, "a"),
			removed(3600, "a"), // 550ms after creation, within the 1000ms grace, no update
		]);
		expect(episodes).toEqual([]);
	});

	it("does NOT apply the accidental-create guard when the box was moved before being removed", () => {
		const episodes = buildRedactionEpisodes([
			started(4000),
			created(4050, "a"),
			updated(4300, "a"),
			removed(4400, "a"), // within the grace window, but there WAS a move — real redaction
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 4000, end: 4300 }]);
	});

	it("does not apply the accidental-create guard once removal happens after the grace period", () => {
		// No update either way, so the end still falls back to the creation
		// time per the approved "end = last move, else creation time" rule —
		// removal itself is never used as an end marker.
		const episodes = buildRedactionEpisodes([
			started(5000),
			created(5050, "a"),
			removed(7000, "a"),
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([{ start: 5000, end: 5050 }]);
	});

	it("produces independent episodes for independent overlays", () => {
		const episodes = buildRedactionEpisodes([
			started(1000),
			created(1050, "a"),
			updated(1600, "a"),
			started(20_000, "drag"),
			created(20_200, "b"),
			updated(20_900, "b"),
		]);
		expect(episodes).toEqual<RedactionEpisode[]>([
			{ start: 1000, end: 1600 },
			{ start: 20_000, end: 20_900 },
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
	it("drops an episode shorter than minWindowMs, evaluated on RAW (pre-padding) duration", () => {
		// Raw duration 300ms < 400ms MIN — must be dropped even though padding
		// (100 + 350 = 450ms) alone would otherwise clear the threshold if
		// checked after padding instead of before.
		const suggestions = clusterRedactionEpisodesIntoSuggestions([{ start: 1000, end: 1300 }], {
			totalMs: 30_000,
		});
		expect(suggestions).toEqual([]);
	});

	it("keeps and pads an episode exactly at minWindowMs", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions([{ start: 1000, end: 1400 }], {
			totalMs: 30_000,
		});
		expect(suggestions).toEqual([{ start: 900, end: 1750, isLongOutlier: false }]);
	});

	it("merges two episodes whose gap is exactly at the merge threshold", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 1000, end: 2000 },
				{ start: 4000, end: 4500 }, // gap = 2000ms, equal to the default merge gap
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([{ start: 900, end: 4850, isLongOutlier: false }]);
	});

	it("does not merge two episodes whose gap exceeds the merge threshold by 1ms", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 1000, end: 2000 },
				{ start: 4001, end: 4500 }, // gap = 2001ms
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([
			{ start: 900, end: 2350, isLongOutlier: false },
			{ start: 3901, end: 4850, isLongOutlier: false },
		]);
	});

	it("merges a fully-nested episode without shrinking or duplicating the outer window", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[
				{ start: 1000, end: 5000 },
				{ start: 2000, end: 3000 }, // entirely inside the first
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([{ start: 900, end: 5350, isLongOutlier: false }]);
	});

	it("flags but does not drop an episode longer than maxWindowMs", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions(
			[{ start: 1000, end: 26_000 }],
			{
				totalMs: 40_000,
			},
		);
		expect(suggestions).toEqual([{ start: 900, end: 26_350, isLongOutlier: true }]);
	});

	it("clamps padding to [0, totalMs] at the edges of the recording", () => {
		const suggestions = clusterRedactionEpisodesIntoSuggestions([{ start: 50, end: 500 }], {
			totalMs: 600,
		});
		expect(suggestions).toEqual([{ start: 0, end: 600, isLongOutlier: false }]);
	});

	it("drops a span that collapses to zero-width after clamping to a near-zero totalMs", () => {
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
		expect(suggestions.map((s) => s.start)).toEqual([900, 19_900]);
	});
});

describe("buildRedactionSuggestions (full pipeline)", () => {
	it("a single realistic fumble produces one padded, non-outlier suggestion", () => {
		const suggestions = buildRedactionSuggestions(
			[started(5000), created(5010, "a"), updated(5610, "a")],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([{ start: 4900, end: 5960, isLongOutlier: false }]);
	});

	it("a quick click-to-place with no real fumbling produces no suggestions", () => {
		const suggestions = buildRedactionSuggestions(
			[started(1000), created(1010, "a"), updated(1030, "a")],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([]);
	});

	it("two overlays created close together merge into a single suggestion", () => {
		const suggestions = buildRedactionSuggestions(
			[
				started(10_000),
				created(10_010, "a"),
				updated(10_510, "a"),
				started(11_200),
				created(11_210, "b"),
				updated(11_710, "b"),
			],
			{ totalMs: 30_000 },
		);
		expect(suggestions).toEqual([{ start: 9900, end: 12_060, isLongOutlier: false }]);
	});
});
