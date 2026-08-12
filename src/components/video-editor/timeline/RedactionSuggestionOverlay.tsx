import { useTimelineContext } from "dnd-timeline";
import { type RefObject, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { RedactionSuggestionItem } from "./RedactionSuggestionsPanel";
import { clampAdjustedRedactionSpan } from "./redactionSuggestionUtils";

interface DragState {
	suggestionId: string;
	edge: "start" | "end";
}

interface RedactionSuggestionOverlayProps {
	suggestions: RedactionSuggestionItem[];
	onSpanChange: (id: string, span: { start: number; end: number }) => void;
	videoDurationMs: number;
	timelineRef: RefObject<HTMLDivElement>;
}

/**
 * Draws each pending redaction suggestion as a band directly on the
 * timeline, with draggable start/end handles — mirrors KeyframeMarkers.tsx's
 * manual mousedown + window-listener drag pattern rather than joining
 * dnd-timeline's Item/Row system, since these spans aren't real committed
 * regions yet. Lets the user correct the algorithm's guess (it has no way to
 * know exactly when the redacted content first appeared — see
 * redactionSuggestionUtils.ts) before accepting.
 */
export default function RedactionSuggestionOverlay({
	suggestions,
	onSpanChange,
	videoDurationMs,
	timelineRef,
}: RedactionSuggestionOverlayProps) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [drag, setDrag] = useState<DragState | null>(null);

	useEffect(() => {
		if (!drag) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current) return;
			const suggestion = suggestions.find((item) => item.id === drag.suggestionId);
			if (!suggestion) return;

			const rect = timelineRef.current.getBoundingClientRect();
			const clickX = e.clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			const proposedMs = range.start + relativeMs;

			onSpanChange(
				suggestion.id,
				clampAdjustedRedactionSpan(suggestion, drag.edge, proposedMs, videoDurationMs),
			);
		};

		const handleMouseUp = () => {
			setDrag(null);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		drag,
		suggestions,
		onSpanChange,
		timelineRef,
		sidebarWidth,
		range.start,
		videoDurationMs,
		pixelsToValue,
	]);

	if (videoDurationMs <= 0) return null;

	return (
		<>
			{suggestions.map((suggestion) => {
				const visibleStart = Math.max(suggestion.start, range.start);
				const visibleEnd = Math.min(suggestion.end, range.end);
				if (visibleEnd <= visibleStart) return null;

				const startOffsetPx = valueToPixels(visibleStart - range.start);
				const widthPx = valueToPixels(visibleEnd - visibleStart);
				const isDraggingThis = drag?.suggestionId === suggestion.id;

				return (
					<div
						key={suggestion.id}
						className="absolute top-0 bottom-0 pointer-events-none"
						style={{
							[sideProperty]: `${sidebarWidth + startOffsetPx}px`,
							width: `${widthPx}px`,
							// Matches KeyframeMarkers.tsx's z-index exactly so neither
							// overlay's idle handle can block the other's mousedown when
							// they coincide at the same timeline position.
							zIndex: isDraggingThis ? 50 : 40,
						}}
					>
						<div
							className={cn(
								"absolute inset-0 border-y-0 border-dashed",
								suggestion.isLongOutlier
									? "bg-destructive/15 border-destructive/70"
									: "bg-destructive/10 border-destructive/50",
							)}
						/>
						{(["start", "end"] as const).map((edge) => (
							<div
								key={edge}
								className="group/handle absolute top-0 bottom-0 w-3 cursor-ew-resize pointer-events-auto"
								style={edge === "start" ? { left: "-6px" } : { right: "-6px" }}
								onMouseDown={(e) => {
									e.stopPropagation();
									if (e.button !== 0) return;
									setDrag({ suggestionId: suggestion.id, edge });
								}}
								title={
									edge === "start"
										? "Drag to adjust when the suggested cut starts"
										: "Drag to adjust when the suggested cut ends"
								}
							>
								<div className="absolute top-1/2 left-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive shadow-sm group-hover/handle:bg-destructive/80" />
							</div>
						))}
					</div>
				);
			})}
		</>
	);
}
