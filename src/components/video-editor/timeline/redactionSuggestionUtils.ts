/**
 * Turns a raw BlurBox redaction event stream (already wall-clock-mapped to
 * video-relative elapsed ms by the main process — see
 * electron/ipc/blurbox/eventLog.ts) into suggested "cut this window" spans.
 *
 * Deliberately simple: BlurBox has no OCR, so there's no way to know exactly
 * when the redacted content first appeared — the only hard signal is
 * `overlay_created` (the moment a box is actually placed: immediately for
 * the instant-create hotkey, or on mouse-up for drag-to-create). Rather than
 * try to reconstruct a "fumbling window" from creation through settling
 * (tried first, but real-world testing showed it produced suggestions that
 * extended too far *after* creation instead of covering the exposure
 * *before* it — see PRE_CREATION_REDACTION_WINDOW_MS), each suggestion is
 * just a fixed window ending at creation. The timeline overlay lets the user
 * drag either edge if the default guess is off for a given clip.
 *
 * Mirrors zoomSuggestionUtils.ts's shape (candidate detection → clustering →
 * suggestion list) so this reads as "the same kind of code" alongside it.
 */

export type BlurBoxRedactionEventType =
	| "create_action_started"
	| "overlay_created"
	| "overlay_updated"
	| "overlay_removed";

export interface BlurBoxRedactionEvent {
	type: BlurBoxRedactionEventType;
	/** Video-relative elapsed ms, already pause-aware — see recordingClock.ts on the main-process side. */
	elapsedMs: number;
	overlayId?: string;
	action?: "instant" | "drag";
}

export interface SuggestedRedactionSpan {
	start: number;
	end: number;
	/**
	 * True when the window exceeds MAX_REDACTION_WINDOW_MS. Never dropped for
	 * being long — a false negative (missing a real cut) is worse than an
	 * oversized-but-correct suggestion for a privacy feature — just flagged
	 * for extra scrutiny in the review UI.
	 */
	isLongOutlier: boolean;
}

/** Max gap between consecutive windows before they're merged into one suggestion. */
export const REDACTION_CLUSTER_MERGE_GAP_MS = 2000;
/** Fixed suggestion length: the N ms immediately before a box is created ("release of the click"). */
export const PRE_CREATION_REDACTION_WINDOW_MS = 1_500;
/** Above this, keep the suggestion but flag it as an outlier rather than dropping it. */
export const MAX_REDACTION_WINDOW_MS = 20_000;
/** A box removed this soon after creation, with no move in between, is treated as a mis-press, not a real redaction. */
export const ACCIDENTAL_CREATE_GRACE_MS = 1_000;
/** Floor enforced when a user manually drags a suggestion's start/end handle on the timeline. */
export const MIN_MANUAL_REDACTION_ADJUST_MS = 100;

export interface RedactionEpisode {
	start: number;
	end: number;
}

/**
 * Stage A: one fixed-length window per newly-created overlay, ending at
 * `overlay_created` (the box's creation — instant for the hotkey path, or
 * the drag-release moment for drag-to-create) and starting
 * PRE_CREATION_REDACTION_WINDOW_MS earlier.
 *
 * `create_action_started` isn't used as an anchor here — it only marks when
 * the hotkey was pressed, which for instant-create is essentially
 * simultaneous with `overlay_created` anyway, and doesn't help estimate when
 * the content actually appeared.
 *
 * Only brand-new box creation produces a window — repositioning an
 * already-existing overlay (no matching `overlay_created` in this event
 * set) is out of scope, matching a deliberate v1 product decision.
 */
export function buildRedactionEpisodes(
	events: BlurBoxRedactionEvent[],
	windowMs: number = PRE_CREATION_REDACTION_WINDOW_MS,
): RedactionEpisode[] {
	const eventsByOverlayId = new Map<string, BlurBoxRedactionEvent[]>();
	for (const event of events) {
		if (!event.overlayId) {
			continue;
		}
		const existing = eventsByOverlayId.get(event.overlayId);
		if (existing) {
			existing.push(event);
		} else {
			eventsByOverlayId.set(event.overlayId, [event]);
		}
	}

	const episodes: RedactionEpisode[] = [];

	for (const overlayEvents of eventsByOverlayId.values()) {
		const created = overlayEvents.find((event) => event.type === "overlay_created");
		if (!created) {
			continue;
		}

		const updates = overlayEvents.filter((event) => event.type === "overlay_updated");
		const removed = overlayEvents.find((event) => event.type === "overlay_removed");

		if (
			removed &&
			updates.length === 0 &&
			removed.elapsedMs - created.elapsedMs <= ACCIDENTAL_CREATE_GRACE_MS
		) {
			continue;
		}

		episodes.push({ start: created.elapsedMs - windowMs, end: created.elapsedMs });
	}

	return episodes.sort((a, b) => a.start - b.start);
}

/**
 * Stage B: sweep-line merge of episodes whose gap is within `mergeGapMs`.
 * True overlaps/nesting fall out for free — a negative or zero gap always
 * merges, and Math.max keeps a fully-nested episode from shrinking the
 * merged window.
 */
function mergeRedactionEpisodes(
	episodes: RedactionEpisode[],
	mergeGapMs: number,
): RedactionEpisode[] {
	if (episodes.length === 0) {
		return [];
	}

	const sorted = [...episodes].sort((a, b) => a.start - b.start);
	const merged: RedactionEpisode[] = [{ ...sorted[0] }];

	for (let i = 1; i < sorted.length; i++) {
		const current = sorted[i];
		const last = merged[merged.length - 1];
		const gap = current.start - last.end;

		if (gap <= mergeGapMs) {
			last.end = Math.max(last.end, current.end);
		} else {
			merged.push({ ...current });
		}
	}

	return merged;
}

export interface RedactionClusterOptions {
	totalMs: number;
	mergeGapMs?: number;
	windowMs?: number;
	maxWindowMs?: number;
}

/**
 * Stage B + C: merge nearby fixed-length windows into one suggestion per
 * cluster, clamp to the recording's bounds, and flag (never drop) any merged
 * window longer than maxWindowMs — a false negative (missing a real cut) is
 * worse than an oversized-but-correct suggestion for a privacy feature.
 */
export function clusterRedactionEpisodesIntoSuggestions(
	episodes: RedactionEpisode[],
	options: RedactionClusterOptions,
): SuggestedRedactionSpan[] {
	const {
		totalMs,
		mergeGapMs = REDACTION_CLUSTER_MERGE_GAP_MS,
		maxWindowMs = MAX_REDACTION_WINDOW_MS,
	} = options;

	const safeTotalMs = Math.max(0, totalMs);
	const merged = mergeRedactionEpisodes(episodes, mergeGapMs);

	const suggestions: SuggestedRedactionSpan[] = [];
	for (const episode of merged) {
		const rawDurationMs = episode.end - episode.start;
		const start = Math.max(0, episode.start);
		const end = Math.min(safeTotalMs, episode.end);
		if (end <= start) {
			continue;
		}

		suggestions.push({ start, end, isLongOutlier: rawDurationMs > maxWindowMs });
	}

	return suggestions.sort((a, b) => a.start - b.start);
}

/**
 * Clamps a proposed new position for one edge (`"start"` or `"end"`) of a
 * suggestion the user is manually dragging on the timeline. Keeps the
 * dragged edge within `[0, totalMs]` and prevents it from crossing the
 * opposite edge closer than `minWindowMs`, regardless of which edge moved —
 * the other edge is never touched by this function.
 */
export function clampAdjustedRedactionSpan(
	current: { start: number; end: number },
	handle: "start" | "end",
	proposedMs: number,
	totalMs: number,
	minWindowMs: number = MIN_MANUAL_REDACTION_ADJUST_MS,
): { start: number; end: number } {
	const boundedMs = Math.max(0, Math.min(proposedMs, totalMs));

	if (handle === "start") {
		const maxStart = current.end - minWindowMs;
		return { start: Math.min(boundedMs, maxStart), end: current.end };
	}

	const minEnd = current.start + minWindowMs;
	return { start: current.start, end: Math.max(boundedMs, minEnd) };
}

/** Full pipeline: raw events → fixed pre-creation windows (Stage A) → suggestions (Stage B/C). */
export function buildRedactionSuggestions(
	events: BlurBoxRedactionEvent[],
	options: RedactionClusterOptions,
): SuggestedRedactionSpan[] {
	const episodes = buildRedactionEpisodes(events, options.windowMs);
	return clusterRedactionEpisodesIntoSuggestions(episodes, options);
}
