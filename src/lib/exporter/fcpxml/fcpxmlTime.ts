/**
 * FCPXML expresses every time value as an exact rational number of seconds,
 * quantized to the sequence's frame boundaries (e.g. "1001/30000s" for a
 * single frame at 29.97fps, or "3003/30000s" for three frames). Final Cut
 * Pro and DaVinci Resolve both reject non-frame-aligned times, so every
 * value here is first snapped to the nearest frame before being expressed
 * as a fraction.
 */

export interface FrameDuration {
	numerator: number;
	denominator: number;
}

const NTSC_FRAME_DURATIONS: Record<string, FrameDuration> = {
	"23.976": { numerator: 1001, denominator: 24000 },
	"29.97": { numerator: 1001, denominator: 30000 },
	"59.94": { numerator: 1001, denominator: 60000 },
};

function gcd(a: number, b: number): number {
	let x = Math.abs(Math.round(a));
	let y = Math.abs(Math.round(b));
	while (y !== 0) {
		[x, y] = [y, x % y];
	}
	return x || 1;
}

/**
 * Returns the exact duration of a single frame at the given rate, as a
 * numerator/denominator pair in seconds. Well-known NTSC rates (23.976,
 * 29.97, 59.94) use their broadcast-exact fractions; everything else is
 * treated as an integer or three-decimal rate and reduced.
 */
export function frameDurationForRate(frameRate: number): FrameDuration {
	if (!Number.isFinite(frameRate) || frameRate <= 0) {
		return { numerator: 1, denominator: 30 };
	}

	const rounded = frameRate.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
	const ntsc = NTSC_FRAME_DURATIONS[rounded];
	if (ntsc) {
		return ntsc;
	}

	if (Number.isInteger(frameRate)) {
		return { numerator: 1, denominator: frameRate };
	}

	// Fallback for an arbitrary non-integer rate: express as
	// round(frameRate * 1000) / 1000, reduced to lowest terms.
	const numerator = 1000;
	const denominator = Math.round(frameRate * 1000);
	const divisor = gcd(numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function reduceFraction(numerator: number, denominator: number): FrameDuration {
	if (numerator === 0) {
		return { numerator: 0, denominator: 1 };
	}
	const divisor = gcd(numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/**
 * Converts a millisecond offset into an FCPXML time string, snapped to the
 * nearest frame boundary for the given frame rate. E.g. 1000ms at 30fps ->
 * "1s"; 1016ms at 29.97fps -> "30030/30000s" reduced to "1001/1000s".
 */
export function msToFcpxmlTime(ms: number, frameRate: number): string {
	const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
	const frame = frameDurationForRate(frameRate);
	const frameDurationSec = frame.numerator / frame.denominator;
	const frameCount = Math.round(safeMs / 1000 / frameDurationSec);

	const { numerator, denominator } = reduceFraction(
		frameCount * frame.numerator,
		frame.denominator,
	);

	if (numerator === 0) {
		return "0s";
	}
	if (denominator === 1) {
		return `${numerator}s`;
	}
	return `${numerator}/${denominator}s`;
}

/**
 * Formats a frame rate as an FCPXML <format> frameDuration attribute value
 * (the duration of a single frame), e.g. 29.97 -> "1001/30000s".
 */
export function frameDurationAttribute(frameRate: number): string {
	const { numerator, denominator } = frameDurationForRate(frameRate);
	return `${numerator}/${denominator}s`;
}
