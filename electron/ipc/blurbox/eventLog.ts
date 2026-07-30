import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mapWallClockToElapsedMs, type RecordingClockParams } from "../recordingClock";

/**
 * The event log written by BlurBox (a sibling macOS privacy-overlay app,
 * separate codebase) when its "help VybeClip auto-cut redaction fumbles"
 * preference is on. This is the entire integration surface between the two
 * apps — a local, versioned, append-only JSON Lines file. See BlurBox's
 * `BlurBox_Foundational_Documents/26_VybeClip_Integration_Contract.md` for
 * the authoritative schema this must stay in sync with.
 */

const SUPPORTED_SCHEMA_VERSION = 1;

export type BlurBoxEventType =
	| "create_action_started"
	| "overlay_created"
	| "overlay_updated"
	| "overlay_removed";

export type BlurBoxCreateAction = "instant" | "drag";

export interface BlurBoxRawFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BlurBoxRawEvent {
	v: number;
	type: BlurBoxEventType;
	ts: number;
	overlayId?: string;
	frame?: BlurBoxRawFrame;
	action?: BlurBoxCreateAction;
}

export interface NormalizedBlurBoxEvent {
	type: BlurBoxEventType;
	/** Video-relative elapsed ms, pause-aware (see recordingClock.ts). */
	elapsedMs: number;
	overlayId?: string;
	action?: BlurBoxCreateAction;
}

/**
 * BlurBox is macOS-only (Carbon global hotkeys, Accessibility APIs) —
 * returns null on every other platform so callers can no-op cleanly rather
 * than attempting a read that could never succeed.
 *
 * Honors RECORDLY_BLURBOX_EVENT_LOG_PATH_OVERRIDE (same naming convention as
 * RECORDLY_UPDATER_LOG_PATH in electron/updater.ts) so a developer can point
 * this at a hand-written fixture — see
 * _documentation/BLURBOX_INTEGRATION_TESTING.md — and exercise the full
 * read → normalize → cluster → review-UI pipeline without BlurBox installed.
 * The override still only applies on darwin: this feature is unreachable on
 * other platforms regardless of the env var, matching production behavior.
 */
export function getBlurBoxEventLogPath(): string | null {
	if (process.platform !== "darwin") {
		return null;
	}
	const override = process.env.RECORDLY_BLURBOX_EVENT_LOG_PATH_OVERRIDE?.trim();
	if (override) {
		return override;
	}
	return path.join(
		os.homedir(),
		"Library",
		"Application Support",
		"BlurBox",
		"redaction-events.jsonl",
	);
}

const BLURBOX_EVENT_TYPES: ReadonlySet<string> = new Set<BlurBoxEventType>([
	"create_action_started",
	"overlay_created",
	"overlay_updated",
	"overlay_removed",
]);

const BLURBOX_CREATE_ACTIONS: ReadonlySet<string> = new Set<BlurBoxCreateAction>([
	"instant",
	"drag",
]);

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseFrame(value: unknown): BlurBoxRawFrame | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	if (
		isFiniteNumber(candidate.x) &&
		isFiniteNumber(candidate.y) &&
		isFiniteNumber(candidate.width) &&
		isFiniteNumber(candidate.height)
	) {
		return { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height };
	}
	return undefined;
}

/**
 * Parses a single JSON-Lines line into a `BlurBoxRawEvent`, or `null` if the
 * line is blank, malformed JSON, an unrecognized schema version, or missing
 * a required field — any of which should drop just that one line, never the
 * whole file (a torn last line from a crash mid-write is expected).
 */
function parseBlurBoxEventLine(line: string): BlurBoxRawEvent | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}
	const candidate = parsed as Record<string, unknown>;

	if (candidate.v !== SUPPORTED_SCHEMA_VERSION) {
		return null;
	}
	if (typeof candidate.type !== "string" || !BLURBOX_EVENT_TYPES.has(candidate.type)) {
		return null;
	}
	if (!isFiniteNumber(candidate.ts)) {
		return null;
	}

	const event: BlurBoxRawEvent = {
		v: candidate.v,
		type: candidate.type as BlurBoxEventType,
		ts: candidate.ts,
	};

	if (typeof candidate.overlayId === "string") {
		event.overlayId = candidate.overlayId;
	}
	if (typeof candidate.action === "string" && BLURBOX_CREATE_ACTIONS.has(candidate.action)) {
		event.action = candidate.action as BlurBoxCreateAction;
	}
	const frame = parseFrame(candidate.frame);
	if (frame) {
		event.frame = frame;
	}

	return event;
}

/**
 * Whether the log file exists at all — the simplest available signal that
 * BlurBox has been installed and its logging preference enabled at some
 * point. Distinguishes "not installed / never enabled" from "installed, but
 * nothing relevant to this recording" for UI copy — both cases otherwise
 * return an empty events array from readBlurBoxEvents/normalizeBlurBoxEvents.
 */
export async function blurBoxEventLogExists(): Promise<boolean> {
	const logPath = getBlurBoxEventLogPath();
	if (!logPath) {
		return false;
	}
	try {
		await fs.access(logPath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reads and defensively parses BlurBox's event log. Returns an empty array
 * (never throws) when the file doesn't exist — BlurBox not installed, or the
 * user has never enabled the logging preference, are both indistinguishable
 * "nothing here" cases at this layer.
 */
export async function readBlurBoxEvents(): Promise<BlurBoxRawEvent[]> {
	const logPath = getBlurBoxEventLogPath();
	if (!logPath) {
		return [];
	}

	let content: string;
	try {
		content = await fs.readFile(logPath, "utf-8");
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === "ENOENT") {
			return [];
		}
		throw error;
	}

	return content
		.split("\n")
		.map((line) => parseBlurBoxEventLine(line))
		.filter((event): event is BlurBoxRawEvent => event !== null);
}

/**
 * Maps raw BlurBox events into video-relative, pause-aware elapsed times for
 * the given recording, dropping anything outside the recording's window or
 * inside a completed pause (see mapWallClockToElapsedMs).
 */
export function normalizeBlurBoxEvents(
	rawEvents: BlurBoxRawEvent[],
	clockParams: RecordingClockParams,
): NormalizedBlurBoxEvent[] {
	const normalized: NormalizedBlurBoxEvent[] = [];

	for (const raw of rawEvents) {
		const elapsedMs = mapWallClockToElapsedMs(raw.ts, clockParams);
		if (elapsedMs === null) {
			continue;
		}

		const event: NormalizedBlurBoxEvent = { type: raw.type, elapsedMs };
		if (raw.overlayId !== undefined) {
			event.overlayId = raw.overlayId;
		}
		if (raw.action !== undefined) {
			event.action = raw.action;
		}
		normalized.push(event);
	}

	return normalized;
}
