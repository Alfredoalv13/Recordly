import type { ClipRegion } from "../types";

export interface SilenceSpan {
	startMs: number;
	endMs: number;
}

export interface SilenceDetectionOptions {
	/** RMS level, in dBFS, below which a window is considered silent. */
	thresholdDb: number;
	/** Minimum continuous quiet duration (before padding) to count as a cuttable gap. */
	minSilenceMs: number;
	/** Kept on each side of a detected gap so words aren't clipped abruptly. */
	paddingMs: number;
	/** Analysis window size. */
	windowMs: number;
}

export const DEFAULT_SILENCE_THRESHOLD_DB = -40;
export const DEFAULT_MIN_SILENCE_MS = 700;
export const DEFAULT_SILENCE_PADDING_MS = 120;
export const DEFAULT_SILENCE_WINDOW_MS = 50;

export const DEFAULT_SILENCE_DETECTION_OPTIONS: SilenceDetectionOptions = {
	thresholdDb: DEFAULT_SILENCE_THRESHOLD_DB,
	minSilenceMs: DEFAULT_MIN_SILENCE_MS,
	paddingMs: DEFAULT_SILENCE_PADDING_MS,
	windowMs: DEFAULT_SILENCE_WINDOW_MS,
};

function computeWindowRmsDb(
	channelData: Float32Array[],
	sampleRate: number,
	windowMs: number,
): number[] {
	const totalSamples = channelData[0]?.length ?? 0;
	const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
	const windowCount = totalSamples > 0 ? Math.ceil(totalSamples / windowSamples) : 0;
	const dbPerWindow: number[] = new Array(windowCount);

	for (let w = 0; w < windowCount; w++) {
		const start = w * windowSamples;
		const end = Math.min(totalSamples, start + windowSamples);
		let sumSquares = 0;
		let sampleCount = 0;
		for (const channel of channelData) {
			for (let i = start; i < end; i++) {
				const sample = channel[i];
				sumSquares += sample * sample;
				sampleCount++;
			}
		}
		const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
		dbPerWindow[w] = rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
	}

	return dbPerWindow;
}

/**
 * Detects silent gaps in the given (already-decoded) audio channel data.
 * Pure function: no I/O, no Web Audio dependency, fully unit-testable.
 */
export function detectSilenceSpans(
	channelData: Float32Array[],
	sampleRate: number,
	options: Partial<SilenceDetectionOptions> = {},
): SilenceSpan[] {
	if (channelData.length === 0 || sampleRate <= 0) {
		return [];
	}

	const { thresholdDb, minSilenceMs, paddingMs, windowMs } = {
		...DEFAULT_SILENCE_DETECTION_OPTIONS,
		...options,
	};

	const totalSamples = channelData[0].length;
	if (totalSamples === 0) {
		return [];
	}

	const dbPerWindow = computeWindowRmsDb(channelData, sampleRate, windowMs);
	const totalMs = (totalSamples / sampleRate) * 1000;

	const rawSpans: SilenceSpan[] = [];
	let spanStartWindow: number | null = null;

	for (let w = 0; w < dbPerWindow.length; w++) {
		const isQuiet = dbPerWindow[w] < thresholdDb;
		if (isQuiet && spanStartWindow === null) {
			spanStartWindow = w;
		} else if (!isQuiet && spanStartWindow !== null) {
			rawSpans.push({
				startMs: spanStartWindow * windowMs,
				endMs: Math.min(totalMs, w * windowMs),
			});
			spanStartWindow = null;
		}
	}
	if (spanStartWindow !== null) {
		rawSpans.push({ startMs: spanStartWindow * windowMs, endMs: totalMs });
	}

	return rawSpans
		.filter((span) => span.endMs - span.startMs >= minSilenceMs)
		.map((span) => ({
			startMs: span.startMs + paddingMs,
			endMs: span.endMs - paddingMs,
		}))
		.filter((span) => span.endMs > span.startMs);
}

export interface ApplySilenceRemovalResult {
	clipRegions: ClipRegion[];
	removedSpans: SilenceSpan[];
}

/**
 * Subtracts the given silence spans from each existing ClipRegion, splitting
 * a region into up to two surviving pieces (or removing it entirely if the
 * silence covers it end to end). Mirrors the existing manual
 * split-then-delete trim pattern - the derived TrimRegion/export/playback
 * pipeline picks the result up unchanged.
 */
export function applySilenceSpansToClipRegions(
	clipRegions: ClipRegion[],
	silenceSpans: SilenceSpan[],
	createId: () => string,
): ApplySilenceRemovalResult {
	if (silenceSpans.length === 0 || clipRegions.length === 0) {
		return { clipRegions, removedSpans: [] };
	}

	const sortedSpans = [...silenceSpans].sort((a, b) => a.startMs - b.startMs);
	const removedSpans: SilenceSpan[] = [];
	const nextClipRegions: ClipRegion[] = [];

	for (const clip of clipRegions) {
		const overlapping = sortedSpans
			.map((span) => ({
				startMs: Math.max(span.startMs, clip.startMs),
				endMs: Math.min(span.endMs, clip.endMs),
			}))
			.filter((span) => span.endMs > span.startMs);

		if (overlapping.length === 0) {
			nextClipRegions.push(clip);
			continue;
		}

		let cursor = clip.startMs;
		let usedOriginalId = false;
		const nextId = () => (usedOriginalId ? createId() : ((usedOriginalId = true), clip.id));

		for (const span of overlapping) {
			if (span.startMs > cursor) {
				nextClipRegions.push({ ...clip, id: nextId(), startMs: cursor, endMs: span.startMs });
			}
			removedSpans.push(span);
			cursor = span.endMs;
		}
		if (cursor < clip.endMs) {
			nextClipRegions.push({ ...clip, id: nextId(), startMs: cursor, endMs: clip.endMs });
		}
	}

	return { clipRegions: nextClipRegions, removedSpans };
}
