import { describe, expect, it } from "vitest";

/**
 * Walks an XML string tag-by-tag, correctly skipping over quoted attribute
 * values (so a "/" inside a file:// URL attribute doesn't get mistaken for
 * a self-closing marker). Used to sanity-check tag balance without pulling
 * in a full XML parser dependency for one test.
 */
function countTags(xml: string): { opens: number; closes: number; selfClosing: number } {
	let opens = 0;
	let closes = 0;
	let selfClosing = 0;
	let i = 0;

	while (i < xml.length) {
		if (xml[i] !== "<") {
			i += 1;
			continue;
		}

		let j = i + 1;
		let inQuote: string | null = null;
		while (j < xml.length) {
			const ch = xml[j];
			if (inQuote) {
				if (ch === inQuote) inQuote = null;
			} else if (ch === '"' || ch === "'") {
				inQuote = ch;
			} else if (ch === ">") {
				break;
			}
			j += 1;
		}

		const tag = xml.slice(i, j + 1);
		if (tag.startsWith("<?") || tag.startsWith("<!")) {
			// XML declaration / DOCTYPE, not a story element
		} else if (tag.startsWith("</")) {
			closes += 1;
		} else if (tag.endsWith("/>")) {
			selfClosing += 1;
		} else {
			opens += 1;
		}

		i = j + 1;
	}

	return { opens, closes, selfClosing };
}

import type { ProjectEditorState } from "@/components/video-editor/projectPersistence";
import { DEFAULT_CROP_REGION, DEFAULT_WEBCAM_OVERLAY } from "@/components/video-editor/types";
import {
	buildCropXml,
	buildFcpxml,
	buildTimeMapXml,
	computeKeptSourceSegments,
	escapeXmlText,
	type FcpxmlVideoAsset,
	splitSegmentsBySpeed,
	toFileUrl,
} from "./buildFcpxml";

function minimalEditor(overrides: Partial<ProjectEditorState> = {}): ProjectEditorState {
	return {
		trimRegions: [],
		speedRegions: [],
		zoomRegions: [],
		clipRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: [],
		cropRegion: DEFAULT_CROP_REGION,
		webcam: DEFAULT_WEBCAM_OVERLAY,
		zoomInDurationMs: 300,
		...overrides,
	} as ProjectEditorState;
}

const videoAsset: FcpxmlVideoAsset = {
	path: "/Users/test/Movies/recording.mp4",
	name: "recording",
	durationMs: 10_000,
	width: 1920,
	height: 1080,
	frameRate: 30,
	hasAudio: true,
};

describe("escapeXmlText", () => {
	it("escapes all five XML special characters", () => {
		expect(escapeXmlText(`<a> & "b" 'c'`)).toBe("&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;");
	});
});

describe("toFileUrl", () => {
	it("percent-encodes spaces and produces a file:// URL", () => {
		expect(toFileUrl("/Users/test/My Recording.mp4")).toBe(
			"file:///Users/test/My%20Recording.mp4",
		);
	});
});

describe("computeKeptSourceSegments", () => {
	it("returns the whole duration when there are no trims", () => {
		expect(computeKeptSourceSegments([], 10_000)).toEqual([{ startMs: 0, endMs: 10_000 }]);
	});

	it("returns the complement of trimmed ranges", () => {
		const segments = computeKeptSourceSegments(
			[{ id: "a", startMs: 2000, endMs: 4000 }],
			10_000,
		);
		expect(segments).toEqual([
			{ startMs: 0, endMs: 2000 },
			{ startMs: 4000, endMs: 10_000 },
		]);
	});

	it("merges/ignores overlapping and out-of-order trims", () => {
		const segments = computeKeptSourceSegments(
			[
				{ id: "b", startMs: 5000, endMs: 6000 },
				{ id: "a", startMs: 1000, endMs: 3000 },
			],
			10_000,
		);
		expect(segments).toEqual([
			{ startMs: 0, endMs: 1000 },
			{ startMs: 3000, endMs: 5000 },
			{ startMs: 6000, endMs: 10_000 },
		]);
	});

	it("drops degenerate sub-millisecond segments", () => {
		const segments = computeKeptSourceSegments(
			[{ id: "a", startMs: 0, endMs: 9999.8 }],
			10_000,
		);
		expect(segments).toEqual([]);
	});
});

describe("splitSegmentsBySpeed", () => {
	it("returns 1x speed when no speed regions overlap", () => {
		const result = splitSegmentsBySpeed([{ startMs: 0, endMs: 10_000 }], []);
		expect(result).toEqual([{ startMs: 0, endMs: 10_000, speed: 1 }]);
	});

	it("splits a kept segment at speed region boundaries", () => {
		const result = splitSegmentsBySpeed(
			[{ startMs: 0, endMs: 10_000 }],
			[{ id: "s", startMs: 3000, endMs: 6000, speed: 2 }],
		);
		expect(result).toEqual([
			{ startMs: 0, endMs: 3000, speed: 1 },
			{ startMs: 3000, endMs: 6000, speed: 2 },
			{ startMs: 6000, endMs: 10_000, speed: 1 },
		]);
	});
});

describe("buildCropXml", () => {
	it("returns null for the full/default frame", () => {
		expect(buildCropXml(DEFAULT_CROP_REGION)).toBeNull();
	});

	it("computes left/top/right/bottom from a normalized crop region", () => {
		const xml = buildCropXml({ x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
		expect(xml).toContain('mode="crop"');
		expect(xml).toContain('left="0.1"');
		expect(xml).toContain('top="0.2"');
		expect(xml).toContain('right="0.4"');
		expect(xml).toContain('bottom="0.2"');
	});
});

describe("buildTimeMapXml", () => {
	it("returns null at 1x speed", () => {
		expect(buildTimeMapXml({ startMs: 0, endMs: 10_000, speed: 1 }, 30)).toBeNull();
	});

	it("maps a 2x-speed segment to half its source duration in timeline time", () => {
		const xml = buildTimeMapXml({ startMs: 0, endMs: 10_000, speed: 2 }, 30);
		expect(xml).toContain("<timeMap>");
		expect(xml).toContain('time="0s" value="0s"');
		expect(xml).toContain('time="5s" value="10s"');
	});
});

describe("buildFcpxml", () => {
	it("produces a well-formed document with the expected root structure", () => {
		const xml = buildFcpxml(minimalEditor(), videoAsset);

		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain('<fcpxml version="1.10">');
		expect(xml).toContain("<resources>");
		expect(xml).toContain("<spine>");
		expect(xml).toContain('src="file:///Users/test/Movies/recording.mp4"');
		expect(xml).toContain("</fcpxml>");

		// Every opened tag should have a matching close (simple balance check,
		// not a full XML parse, but catches missing/mismatched closing tags).
		const { opens, closes } = countTags(xml);
		expect(opens).toBe(closes);
	});

	it("omits adjust-crop when the project has no crop applied", () => {
		const xml = buildFcpxml(minimalEditor(), videoAsset);
		expect(xml).not.toContain("adjust-crop");
	});

	it("includes adjust-crop when the project has a non-default crop", () => {
		const xml = buildFcpxml(
			minimalEditor({ cropRegion: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }),
			videoAsset,
		);
		expect(xml).toContain("adjust-crop");
	});

	it("includes a keyframed adjust-transform for an overlapping zoom region", () => {
		const xml = buildFcpxml(
			minimalEditor({
				zoomRegions: [
					{
						id: "z1",
						startMs: 1000,
						endMs: 3000,
						depth: 3,
						focus: { cx: 0.5, cy: 0.5 },
					},
				],
			}),
			videoAsset,
		);
		expect(xml).toContain("adjust-transform");
		expect(xml).toContain("keyframeAnimation");
	});

	it("includes a timeMap for a speed-ramped segment", () => {
		const xml = buildFcpxml(
			minimalEditor({ speedRegions: [{ id: "s1", startMs: 0, endMs: 5000, speed: 2 }] }),
			videoAsset,
		);
		expect(xml).toContain("<timeMap>");
	});

	it("includes a title element per caption cue", () => {
		const xml = buildFcpxml(
			minimalEditor({
				autoCaptions: [{ id: "c1", startMs: 0, endMs: 2000, text: "Hello & welcome" }],
			}),
			videoAsset,
		);
		expect(xml).toContain("<title");
		expect(xml).toContain("Hello &amp; welcome");
	});

	it("omits the webcam connected clip when webcam is disabled", () => {
		const xml = buildFcpxml(minimalEditor(), videoAsset);
		expect(xml).not.toContain('name="Webcam"');
	});

	it("includes a lane=1 connected clip when webcam is enabled with an asset", () => {
		const xml = buildFcpxml(
			minimalEditor({
				webcam: { ...DEFAULT_WEBCAM_OVERLAY, enabled: true, sourcePath: "/tmp/webcam.mp4" },
			}),
			videoAsset,
			{ path: "/tmp/webcam.mp4", width: 640, height: 480 },
		);
		expect(xml).toContain('lane="1"');
		expect(xml).toContain('name="Webcam"');
	});

	it("never throws on an empty/all-trimmed project", () => {
		expect(() =>
			buildFcpxml(
				minimalEditor({ trimRegions: [{ id: "t1", startMs: 0, endMs: 10_000 }] }),
				videoAsset,
			),
		).not.toThrow();
	});
});
