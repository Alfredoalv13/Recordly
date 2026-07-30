/**
 * Turns a raw BlurBox redaction event stream (already wall-clock-mapped to
 * video-relative elapsed ms by the main process — see
 * electron/ipc/blurbox/eventLog.ts) into suggested "cut this window" spans:
 * the time between a new BlurBox box being created and it settling into its
 * final position, i.e. the moment a user fumbles to cover something
 * sensitive that just appeared on screen.
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

/** Max gap between consecutive episodes before they're merged into one suggestion. */
export const REDACTION_CLUSTER_MERGE_GAP_MS = 2000;
/** Padding before the episode start — small, since start is already anchored to the reaction moment. */
export const REDACTION_LEAD_PAD_MS = 100;
/** Padding after the episode end — larger, biased toward not leaving an exposed frame at the boundary. */
export const REDACTION_TRAIL_PAD_MS = 350;
/** Below this, treat it as a quick single click-to-place with no real fumbling. */
export const MIN_REDACTION_WINDOW_MS = 400;
/** Above this, keep the suggestion but flag it as an outlier rather than dropping it. */
export const MAX_REDACTION_WINDOW_MS = 20_000;
/** A box removed this soon after creation, with no move in between, is treated as a mis-press, not a real redaction. */
export const ACCIDENTAL_CREATE_GRACE_MS = 1_000;
/** How far back from an overlay_created a create_action_started may be and still count as its start. */
export const CREATE_ACTION_MATCH_WINDOW_MS = 60_000;

export interface RedactionEpisode {
	start: number;
	end: number;
}

/**
 * Stage A: one episode per newly-created overlay.
 *
 * `start` = the nearest preceding `create_action_started` within
 * CREATE_ACTION_MATCH_WINDOW_MS (covers both BlurBox creation paths — the
 * instant-create hotkey spawns a box at a fixed default position, so the
 * real fumbling is the drag/resize that follows; drag-to-create's start is
 * the drag-selector opening, before any box exists yet), falling back to the
 * creation event's own time if no match is found (e.g. an older BlurBox
 * version, or a missed/unpaired start event).
 *
 * `end` = the last `overlay_updated` for that overlay, falling back to the
 * creation time if the box was never subsequently moved.
 *
 * Only brand-new box creation produces an episode — repositioning an
 * already-existing overlay (no matching `overlay_created` in this event
 * set) is out of scope, matching a deliberate v1 product decision.
 */
export function buildRedactionEpisodes(events: BlurBoxRedactionEvent[]): RedactionEpisode[] {
	const createActionStartTimes = events
		.filter((event) => event.type === "create_action_started")
		.map((event) => event.elapsedMs)
		.sort((a, b) => a - b);

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

		let episodeStart = created.elapsedMs;
		for (let i = createActionStartTimes.length - 1; i >= 0; i--) {
			const candidate = createActionStartTimes[i];
			if (candidate <= created.elapsedMs) {
				if (created.elapsedMs - candidate <= CREATE_ACTION_MATCH_WINDOW_MS) {
					episodeStart = candidate;
				}
				break;
			}
		}

		const episodeEnd =
			updates.length > 0
				? Math.max(...updates.map((event) => event.elapsedMs))
				: created.elapsedMs;

		episodes.push({
			start: Math.min(episodeStart, episodeEnd),
			end: Math.max(episodeStart, episodeEnd),
		});
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
	leadPadMs?: number;
	trailPadMs?: number;
	minWindowMs?: number;
	maxWindowMs?: number;
}

/**
 * Stage B + C: merge episodes, then filter/flag by *raw* (pre-padding)
 * duration before padding is applied to the surviving windows.
 *
 * Filtering must happen before padding, not after: leadPadMs + trailPadMs
 * alone is 450ms by default, which already exceeds MIN_REDACTION_WINDOW_MS
 * (400ms) — filtering on the padded span would mean the "drop a quick
 * click-to-place" check could never fire, since padding alone would always
 * clear the threshold regardless of how short the real episode was.
 */
export function clusterRedactionEpisodesIntoSuggestions(
	episodes: RedactionEpisode[],
	options: RedactionClusterOptions,
): SuggestedRedactionSpan[] {
	const {
		totalMs,
		mergeGapMs = REDACTION_CLUSTER_MERGE_GAP_MS,
		leadPadMs = REDACTION_LEAD_PAD_MS,
		trailPadMs = REDACTION_TRAIL_PAD_MS,
		minWindowMs = MIN_REDACTION_WINDOW_MS,
		maxWindowMs = MAX_REDACTION_WINDOW_MS,
	} = options;

	const safeTotalMs = Math.max(0, totalMs);
	const merged = mergeRedactionEpisodes(episodes, mergeGapMs);

	const suggestions: SuggestedRedactionSpan[] = [];
	for (const episode of merged) {
		const rawDurationMs = episode.end - episode.start;
		if (rawDurationMs < minWindowMs) {
			continue;
		}

		const start = Math.max(0, episode.start - leadPadMs);
		const end = Math.min(safeTotalMs, episode.end + trailPadMs);
		if (end <= start) {
			continue;
		}

		suggestions.push({ start, end, isLongOutlier: rawDurationMs > maxWindowMs });
	}

	return suggestions.sort((a, b) => a.start - b.start);
}

/** Full pipeline: raw events → episodes (Stage A) → suggestions (Stage B/C). */
export function buildRedactionSuggestions(
	events: BlurBoxRedactionEvent[],
	options: RedactionClusterOptions,
): SuggestedRedactionSpan[] {
	const episodes = buildRedactionEpisodes(events);
	return clusterRedactionEpisodesIntoSuggestions(episodes, options);
}
