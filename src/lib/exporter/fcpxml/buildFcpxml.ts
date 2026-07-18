import type { ProjectEditorState } from "@/components/video-editor/projectPersistence";
import type {
	CaptionCue,
	CropRegion,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomRegion,
} from "@/components/video-editor/types";
import {
	DEFAULT_CROP_REGION,
	DEFAULT_WEBCAM_OVERLAY,
	ZOOM_DEPTH_SCALES,
} from "@/components/video-editor/types";
import { frameDurationAttribute, msToFcpxmlTime } from "./fcpxmlTime";

/**
 * Describes the source video asset an FCPXML export is built from. All
 * dimensions/rates come from the same metadata probe already used by the
 * MP4 export pipeline (see probeNativeVideoMetadata).
 */
export interface FcpxmlVideoAsset {
	path: string;
	name: string;
	durationMs: number;
	width: number;
	height: number;
	frameRate: number;
	hasAudio: boolean;
}

export interface FcpxmlWebcamAsset {
	path: string;
	width: number;
	height: number;
}

export interface KeptSourceSegment {
	startMs: number;
	endMs: number;
}

export interface TimedSourceSegment extends KeptSourceSegment {
	speed: number;
}

/** Escapes text for use inside FCPXML element content or attribute values. */
export function escapeXmlText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Converts an absolute local file path to a file:// URL, as FCPXML requires for asset src. */
export function toFileUrl(absolutePath: string): string {
	const normalized = absolutePath.replace(/\\/g, "/");
	const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
	const encoded = withLeadingSlash
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `file://${encoded}`;
}

/**
 * Returns the source-time ranges that survive the project's trims, i.e. the
 * complement of trimRegions within [0, sourceDurationMs]. Mirrors the same
 * "kept segments" algorithm the MP4 exporter uses internally, reimplemented
 * here as a small pure function rather than reaching into that pipeline.
 */
export function computeKeptSourceSegments(
	trimRegions: TrimRegion[],
	sourceDurationMs: number,
): KeptSourceSegment[] {
	const safeDuration = Number.isFinite(sourceDurationMs) ? Math.max(0, sourceDurationMs) : 0;
	const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

	if (sorted.length === 0) {
		return safeDuration > 0 ? [{ startMs: 0, endMs: safeDuration }] : [];
	}

	const segments: KeptSourceSegment[] = [];
	let cursorMs = 0;

	for (const region of sorted) {
		const startMs = Math.max(0, Math.min(region.startMs, safeDuration));
		const endMs = Math.max(startMs, Math.min(region.endMs, safeDuration));
		if (startMs > cursorMs) {
			segments.push({ startMs: cursorMs, endMs: startMs });
		}
		cursorMs = Math.max(cursorMs, endMs);
	}

	if (cursorMs < safeDuration) {
		segments.push({ startMs: cursorMs, endMs: safeDuration });
	}

	return segments.filter((segment) => segment.endMs - segment.startMs > 0.5);
}

/**
 * Splits each kept segment at any overlapping speedRegion boundary, tagging
 * every resulting sub-segment with its effective speed (1 where uncovered).
 */
export function splitSegmentsBySpeed(
	keptSegments: KeptSourceSegment[],
	speedRegions: SpeedRegion[],
): TimedSourceSegment[] {
	const result: TimedSourceSegment[] = [];

	for (const kept of keptSegments) {
		const boundaries = new Set<number>([kept.startMs, kept.endMs]);
		for (const region of speedRegions) {
			const startMs = Math.max(kept.startMs, region.startMs);
			const endMs = Math.min(kept.endMs, region.endMs);
			if (endMs - startMs > 0.5) {
				boundaries.add(startMs);
				boundaries.add(endMs);
			}
		}

		const ordered = [...boundaries].sort((a, b) => a - b);
		for (let index = 0; index < ordered.length - 1; index += 1) {
			const startMs = ordered[index] ?? 0;
			const endMs = ordered[index + 1] ?? 0;
			if (endMs - startMs <= 0.5) {
				continue;
			}
			const midpointMs = startMs + (endMs - startMs) / 2;
			const speedRegion = speedRegions.find(
				(region) => midpointMs >= region.startMs && midpointMs < region.endMs,
			);
			result.push({ startMs, endMs, speed: speedRegion?.speed ?? 1 });
		}
	}

	return result;
}

function formatNumber(value: number): string {
	if (!Number.isFinite(value)) {
		return "0";
	}
	// FCPXML numeric attributes are plain decimal text; 6 significant
	// fractional digits is more than enough precision for transform/crop
	// values while keeping the XML readable.
	return Number(value.toFixed(6)).toString();
}

/**
 * Builds the adjust-transform element for a zoom region overlapping a given
 * source segment, expressed as timeline-relative keyframes (0s = segment
 * start). Position is expressed in the sequence's pixel coordinate space,
 * approximating "center the frame on the zoom focus point" — this is a
 * best-effort mapping; verify visually after import, as exact pixel
 * semantics can vary slightly between NLEs.
 */
export function buildZoomTransformXml(
	zoomRegions: ZoomRegion[],
	segment: KeptSourceSegment,
	frameRate: number,
	width: number,
	height: number,
	transitionMs: number,
): string | null {
	const overlapping = zoomRegions.filter(
		(region) => region.endMs > segment.startMs && region.startMs < segment.endMs,
	);
	if (overlapping.length === 0) {
		return null;
	}

	const positionKeyframes: string[] = [];
	const scaleKeyframes: string[] = [];

	const pushKeyframe = (list: string[], relativeMs: number, value: string) => {
		const clampedMs = Math.max(0, Math.min(relativeMs, segment.endMs - segment.startMs));
		const time = msToFcpxmlTime(clampedMs, frameRate);
		list.push(`<keyframe time="${time}" value="${value}" interp="easeOut"/>`);
	};

	// Baseline: no zoom, at the very start of the segment.
	pushKeyframe(positionKeyframes, 0, "0 0");
	pushKeyframe(scaleKeyframes, 0, "1 1");

	for (const region of overlapping) {
		const scale = ZOOM_DEPTH_SCALES[region.depth] ?? 1;
		const positionX = (0.5 - region.focus.cx) * width * scale;
		const positionY = (0.5 - region.focus.cy) * height * scale;
		const positionValue = `${formatNumber(positionX)} ${formatNumber(positionY)}`;
		const scaleValue = `${formatNumber(scale)} ${formatNumber(scale)}`;

		const zoomInMs = Math.max(0, region.startMs - segment.startMs);
		const holdMs = zoomInMs + transitionMs;
		const zoomOutStartMs = Math.max(holdMs, region.endMs - segment.startMs - transitionMs);
		const zoomOutEndMs = Math.max(zoomOutStartMs, region.endMs - segment.startMs);

		pushKeyframe(positionKeyframes, holdMs, positionValue);
		pushKeyframe(scaleKeyframes, holdMs, scaleValue);
		pushKeyframe(positionKeyframes, zoomOutStartMs, positionValue);
		pushKeyframe(scaleKeyframes, zoomOutStartMs, scaleValue);
		pushKeyframe(positionKeyframes, zoomOutEndMs, "0 0");
		pushKeyframe(scaleKeyframes, zoomOutEndMs, "1 1");
	}

	return [
		"<adjust-transform>",
		`<param name="position"><keyframeAnimation>${positionKeyframes.join("")}</keyframeAnimation></param>`,
		`<param name="scale"><keyframeAnimation>${scaleKeyframes.join("")}</keyframeAnimation></param>`,
		"</adjust-transform>",
	].join("");
}

/** Builds an adjust-crop element from a normalized (0-1) CropRegion, or null if it's the full frame. */
export function buildCropXml(cropRegion: CropRegion): string | null {
	const isFullFrame =
		cropRegion.x === 0 &&
		cropRegion.y === 0 &&
		cropRegion.width === 1 &&
		cropRegion.height === 1;
	if (isFullFrame) {
		return null;
	}

	const left = formatNumber(cropRegion.x);
	const top = formatNumber(cropRegion.y);
	const right = formatNumber(1 - (cropRegion.x + cropRegion.width));
	const bottom = formatNumber(1 - (cropRegion.y + cropRegion.height));

	return `<adjust-crop mode="crop"><crop-rect left="${left}" top="${top}" right="${right}" bottom="${bottom}"/></adjust-crop>`;
}

/**
 * Builds a timeMap for a segment played back at a non-1x speed. Times are
 * clip-relative (0s = the clip's own start). This is a best-effort mapping
 * of a constant-speed region — verify visually after import.
 */
export function buildTimeMapXml(segment: TimedSourceSegment, frameRate: number): string | null {
	if (segment.speed === 1 || segment.speed <= 0) {
		return null;
	}
	const sourceDurationMs = segment.endMs - segment.startMs;
	const timelineDurationMs = sourceDurationMs / segment.speed;
	const startTime = msToFcpxmlTime(0, frameRate);
	const endTime = msToFcpxmlTime(timelineDurationMs, frameRate);
	const endValue = msToFcpxmlTime(sourceDurationMs, frameRate);

	return [
		"<timeMap>",
		`<timept time="${startTime}" value="${startTime}" interp="smooth2"/>`,
		`<timept time="${endTime}" value="${endValue}" interp="smooth2"/>`,
		"</timeMap>",
	].join("");
}

function segmentTimelineDurationMs(segment: TimedSourceSegment): number {
	return (segment.endMs - segment.startMs) / (segment.speed > 0 ? segment.speed : 1);
}

function buildWebcamConnectedClipXml(
	webcam: WebcamOverlaySettings,
	webcamAsset: FcpxmlWebcamAsset,
	assetId: string,
	totalTimelineDurationMs: number,
	frameRate: number,
): string {
	const offsetMs = Math.max(0, webcam.timeOffsetMs);
	const durationMs = Math.max(0, totalTimelineDurationMs - offsetMs);
	const offset = msToFcpxmlTime(offsetMs, frameRate);
	const duration = msToFcpxmlTime(durationMs, frameRate);

	// size is a percentage of frame width in VybeClip; positionX/positionY
	// are normalized 0-1 within the safe area. Position is expressed here
	// relative to sequence center, matching buildZoomTransformXml's
	// convention. Shadow/corner-radius/mirror have no FCPXML equivalent and
	// are intentionally omitted.
	const scaleFactor = webcam.size / 100;
	const positionX = (webcam.positionX - 0.5) * webcamAsset.width;
	const positionY = (webcam.positionY - 0.5) * webcamAsset.height;

	return [
		`<asset-clip ref="${assetId}" name="Webcam" lane="1" offset="${offset}" start="0s" duration="${duration}">`,
		`<adjust-transform position="${formatNumber(positionX)} ${formatNumber(positionY)}" scale="${formatNumber(scaleFactor)} ${formatNumber(scaleFactor)}"/>`,
		"</asset-clip>",
	].join("");
}

function buildCaptionTitleXml(cue: CaptionCue, frameRate: number): string {
	const offset = msToFcpxmlTime(cue.startMs, frameRate);
	const duration = msToFcpxmlTime(Math.max(0, cue.endMs - cue.startMs), frameRate);
	const styleId = `ts-${cue.id}`;

	return [
		`<title ref="r-caption-effect" name="Caption" lane="2" offset="${offset}" duration="${duration}">`,
		`<text-style-def id="${styleId}"><text-style font="Helvetica" fontSize="48" fontColor="1 1 1 1" alignment="center">${escapeXmlText(
			cue.text,
		)}</text-style></text-style-def>`,
		`<text ref="${styleId}">${escapeXmlText(cue.text)}</text>`,
		"</title>",
	].join("");
}

/**
 * Builds a complete FCPXML 1.10 document string for the given project edit
 * state and source video, for opening in DaVinci Resolve, Final Cut Pro, or
 * any other NLE that reads FCPXML.
 *
 * Faithfully mapped: trims/cuts, zoom-region keyframed pan+scale, crop,
 * speed ramps (as timeMap), a webcam overlay's position/size, and caption
 * text (as a plain title, no per-word reveal animation).
 *
 * Intentionally NOT represented (no NLE equivalent exists): cursor click
 * effects, cursor motion smoothing/spring physics, webcam drop-shadow and
 * corner-radius, animated video wallpaper backgrounds, and caption reveal
 * animation styles.
 */
export function buildFcpxml(
	editor: Partial<ProjectEditorState>,
	video: FcpxmlVideoAsset,
	webcamAsset?: FcpxmlWebcamAsset | null,
): string {
	const frameDuration = frameDurationAttribute(video.frameRate);
	const keptSegments = computeKeptSourceSegments(editor.trimRegions ?? [], video.durationMs);
	const timedSegments = splitSegmentsBySpeed(keptSegments, editor.speedRegions ?? []);
	const cropXml = buildCropXml(editor.cropRegion ?? DEFAULT_CROP_REGION);
	const transitionMs = Math.min(editor.zoomInDurationMs ?? 300, 500);
	const webcam = editor.webcam ?? DEFAULT_WEBCAM_OVERLAY;

	const videoAssetId = "r-video";
	const webcamAssetId = "r-webcam";
	const formatId = "r-format";

	let totalTimelineDurationMs = 0;
	const spineClips = timedSegments.map((segment) => {
		const clipOffset = msToFcpxmlTime(totalTimelineDurationMs, video.frameRate);
		const clipTimelineDurationMs = segmentTimelineDurationMs(segment);
		const clipDuration = msToFcpxmlTime(clipTimelineDurationMs, video.frameRate);
		const clipStart = msToFcpxmlTime(segment.startMs, video.frameRate);

		const transformXml = buildZoomTransformXml(
			editor.zoomRegions ?? [],
			segment,
			video.frameRate,
			video.width,
			video.height,
			transitionMs,
		);
		const timeMapXml = buildTimeMapXml(segment, video.frameRate);

		const xml = [
			`<asset-clip ref="${videoAssetId}" name="${escapeXmlText(video.name)}" offset="${clipOffset}" start="${clipStart}" duration="${clipDuration}" format="${formatId}">`,
			cropXml ?? "",
			transformXml ?? "",
			timeMapXml ?? "",
			"</asset-clip>",
		].join("");

		totalTimelineDurationMs += clipTimelineDurationMs;
		return xml;
	});

	const webcamXml =
		webcam.enabled && webcam.sourcePath && webcamAsset
			? buildWebcamConnectedClipXml(
					webcam,
					webcamAsset,
					webcamAssetId,
					totalTimelineDurationMs,
					video.frameRate,
				)
			: "";

	const captionsXml = (editor.autoCaptions ?? [])
		.map((cue) => buildCaptionTitleXml(cue, video.frameRate))
		.join("");

	const sequenceDuration = msToFcpxmlTime(totalTimelineDurationMs, video.frameRate);
	const assetDuration = msToFcpxmlTime(video.durationMs, video.frameRate);

	const webcamAssetXml = webcamAsset
		? `<asset id="${webcamAssetId}" name="Webcam" src="${toFileUrl(webcamAsset.path)}" start="0s" duration="${assetDuration}" hasVideo="1" format="${formatId}"/>`
		: "";

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		"<!DOCTYPE fcpxml>",
		'<fcpxml version="1.10">',
		"<resources>",
		`<format id="${formatId}" name="FFVideoFormatCustom" frameDuration="${frameDuration}" width="${video.width}" height="${video.height}"/>`,
		`<asset id="${videoAssetId}" name="${escapeXmlText(video.name)}" src="${toFileUrl(video.path)}" start="0s" duration="${assetDuration}" hasVideo="1" hasAudio="${video.hasAudio ? "1" : "0"}" format="${formatId}"/>`,
		webcamAssetXml,
		"</resources>",
		"<library>",
		'<event name="VybeClip Export">',
		`<project name="${escapeXmlText(video.name)}">`,
		`<sequence format="${formatId}" duration="${sequenceDuration}" tcStart="0s" tcFormat="NDF">`,
		"<spine>",
		spineClips.join(""),
		webcamXml,
		captionsXml,
		"</spine>",
		"</sequence>",
		"</project>",
		"</event>",
		"</library>",
		"</fcpxml>",
	].join("");
}
