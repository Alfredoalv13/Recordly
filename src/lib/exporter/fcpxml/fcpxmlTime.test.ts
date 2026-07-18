import { describe, expect, it } from "vitest";
import { frameDurationAttribute, frameDurationForRate, msToFcpxmlTime } from "./fcpxmlTime";

describe("frameDurationForRate", () => {
	it("returns exact broadcast fractions for common NTSC rates", () => {
		expect(frameDurationForRate(29.97)).toEqual({ numerator: 1001, denominator: 30000 });
		expect(frameDurationForRate(59.94)).toEqual({ numerator: 1001, denominator: 60000 });
		expect(frameDurationForRate(23.976)).toEqual({ numerator: 1001, denominator: 24000 });
	});

	it("returns simple reciprocals for integer rates", () => {
		expect(frameDurationForRate(30)).toEqual({ numerator: 1, denominator: 30 });
		expect(frameDurationForRate(24)).toEqual({ numerator: 1, denominator: 24 });
		expect(frameDurationForRate(60)).toEqual({ numerator: 1, denominator: 60 });
	});

	it("falls back to a reduced fraction for an unknown rate", () => {
		expect(frameDurationForRate(50)).toEqual({ numerator: 1, denominator: 50 });
	});

	it("falls back to a safe default for invalid input", () => {
		expect(frameDurationForRate(0)).toEqual({ numerator: 1, denominator: 30 });
		expect(frameDurationForRate(Number.NaN)).toEqual({ numerator: 1, denominator: 30 });
		expect(frameDurationForRate(-5)).toEqual({ numerator: 1, denominator: 30 });
	});
});

describe("frameDurationAttribute", () => {
	it("formats as a reduced fraction string", () => {
		expect(frameDurationAttribute(30)).toBe("1/30s");
		expect(frameDurationAttribute(29.97)).toBe("1001/30000s");
	});
});

describe("msToFcpxmlTime", () => {
	it("converts whole seconds at 30fps", () => {
		expect(msToFcpxmlTime(0, 30)).toBe("0s");
		expect(msToFcpxmlTime(1000, 30)).toBe("1s");
		expect(msToFcpxmlTime(2000, 30)).toBe("2s");
	});

	it("snaps to the nearest frame boundary at 30fps", () => {
		// 1 frame at 30fps = 1/30s ~= 33.333ms; 40ms rounds to 1 frame
		expect(msToFcpxmlTime(40, 30)).toBe("1/30s");
		// 100ms = exactly 3 frames at 30fps
		expect(msToFcpxmlTime(100, 30)).toBe("1/10s");
	});

	it("produces exact NTSC fractions at 29.97fps", () => {
		// 1 frame at 29.97fps = 1001/30000s ~= 33.3667ms
		expect(msToFcpxmlTime(33.3667, 29.97)).toBe("1001/30000s");
	});

	it("clamps negative input to zero", () => {
		expect(msToFcpxmlTime(-500, 30)).toBe("0s");
	});

	it("never returns a non-finite or negative time for degenerate input", () => {
		expect(msToFcpxmlTime(Number.NaN, 30)).toBe("0s");
	});
});
