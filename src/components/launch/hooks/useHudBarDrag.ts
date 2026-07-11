import { type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
	mergeHudInteractiveBounds,
	shouldRestoreHudMousePassthroughAfterDrag,
} from "../hudMousePassthrough";

const DEFAULT_RECORDING_HUD_OFFSET = { x: 0, y: 0 };

export function useHudBarDrag({
	hudContentRef,
	hudBarRef,
	recordingWebcamPreviewContainerRef,
}: {
	hudContentRef: RefObject<HTMLDivElement>;
	hudBarRef: RefObject<HTMLDivElement>;
	recordingWebcamPreviewContainerRef: RefObject<HTMLDivElement>;
}) {
	const [recordingHudOffset, setRecordingHudOffset] = useState(DEFAULT_RECORDING_HUD_OFFSET);
	const [isHudDragging, setIsHudDragging] = useState(false);
	const hudBarTransformRef = useRef<HTMLDivElement | null>(null);
	const recordingHudOffsetRef = useRef(DEFAULT_RECORDING_HUD_OFFSET);
	const hudDragStartRef = useRef<{
		pointerId: number;
		// Distance (in CSS px) from the widget's rendered top-left corner to
		// the point the user grabbed it at. Unlike a client-coordinate
		// snapshot, this stays meaningful even if the HUD window itself
		// moves or resizes mid-drag (see requestHudRelocate below).
		grabOffsetX: number;
		grabOffsetY: number;
		hudWidth: number;
		hudHeight: number;
	} | null>(null);
	const isHudDraggingRef = useRef(false);
	const hudDragMoveRafRef = useRef<number | null>(null);
	const hudDragPendingPointerRef = useRef<{ screenX: number; screenY: number } | null>(null);
	const hudRelocateInFlightRef = useRef(false);

	useEffect(() => {
		recordingHudOffsetRef.current = recordingHudOffset;
		if (!isHudDraggingRef.current && hudBarTransformRef.current) {
			hudBarTransformRef.current.style.transform = `translate3d(${recordingHudOffset.x}px, ${recordingHudOffset.y}px, 0)`;
		}
	}, [recordingHudOffset]);

	const handleHudBarPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			isHudDraggingRef.current = true;
			setIsHudDragging(true);
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			if (!hudBarRef.current) {
				return;
			}
			const hudRect = hudBarRef.current.getBoundingClientRect();
			hudDragStartRef.current = {
				pointerId: event.pointerId,
				grabOffsetX: event.clientX - hudRect.left,
				grabOffsetY: event.clientY - hudRect.top,
				hudWidth: hudRect.width,
				hudHeight: hudRect.height,
			};
		},
		[hudBarRef],
	);

	// The HUD window is sized to a single display's work area, so a drag that
	// reaches its edge can't go any further on its own. This asks the main
	// process to hop the real window onto whichever display is now under the
	// cursor. It's fire-and-forget: handleHudBarPointerMove re-measures the
	// widget's actual rendered position every frame (see currentRect below),
	// so whenever the window does move, the very next frame naturally
	// reconciles against it - no manual bookkeeping of "how far did the
	// window just jump" is needed here.
	const requestHudRelocate = useCallback((screenX: number, screenY: number) => {
		if (hudRelocateInFlightRef.current || !window.electronAPI?.hudOverlayRelocateToPoint) {
			return;
		}

		hudRelocateInFlightRef.current = true;
		window.electronAPI
			.hudOverlayRelocateToPoint(screenX, screenY)
			.catch(() => {
				// Best-effort: if the round trip fails, the drag simply stays
				// clamped to the current display, same as before this feature.
			})
			.finally(() => {
				hudRelocateInFlightRef.current = false;
			});
	}, []);

	const handleHudBarPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const dragState = hudDragStartRef.current;
			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			hudDragPendingPointerRef.current = { screenX: event.screenX, screenY: event.screenY };
			if (hudDragMoveRafRef.current !== null) {
				return;
			}

			hudDragMoveRafRef.current = requestAnimationFrame(() => {
				hudDragMoveRafRef.current = null;
				const latestDragState = hudDragStartRef.current;
				const pointer = hudDragPendingPointerRef.current;
				const hudBar = hudBarRef.current;
				if (!latestDragState || !pointer || !hudBar) {
					return;
				}

				// Target position in absolute screen coordinates, derived from the
				// cursor's real screen position and the fixed grab offset. Using
				// window.screenX/screenY (which always reflects the HUD window's
				// *current* position) rather than a delta from drag start means this
				// stays correct even if the window has moved since the last frame.
				const targetClientLeft =
					event.screenX - latestDragState.grabOffsetX - window.screenX;
				const targetClientTop =
					event.screenY - latestDragState.grabOffsetY - window.screenY;
				const viewportWidth = window.innerWidth;
				const viewportHeight = window.innerHeight;
				const clampedLeft = Math.min(
					Math.max(0, targetClientLeft),
					Math.max(0, viewportWidth - latestDragState.hudWidth),
				);
				const clampedTop = Math.min(
					Math.max(0, targetClientTop),
					Math.max(0, viewportHeight - latestDragState.hudHeight),
				);

				// Re-measure the widget's actual rendered rect (rather than trusting
				// a snapshot from drag start) so a mid-drag resize/relocate of the
				// HUD window - which shifts the widget's flex-centered baseline
				// position, not just its window origin - is absorbed automatically.
				const currentRect = hudBar.getBoundingClientRect();
				const nextOffset = {
					x: recordingHudOffsetRef.current.x + (clampedLeft - currentRect.left),
					y: recordingHudOffsetRef.current.y + (clampedTop - currentRect.top),
				};
				recordingHudOffsetRef.current = nextOffset;
				if (hudBarTransformRef.current) {
					hudBarTransformRef.current.style.transform = `translate3d(${nextOffset.x}px, ${nextOffset.y}px, 0)`;
				}

				// The widget is pressed against an edge of the current display's
				// window - ask the main process to hop the real window onto
				// whichever display the cursor is now over, if any.
				if (targetClientLeft !== clampedLeft || targetClientTop !== clampedTop) {
					requestHudRelocate(pointer.screenX, pointer.screenY);
				}
			});
		},
		[requestHudRelocate, hudBarRef],
	);

	const handleHudBarPointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const dragState = hudDragStartRef.current;
			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			const hudBar = hudBarRef.current;
			if (hudBar) {
				const targetClientLeft = event.screenX - dragState.grabOffsetX - window.screenX;
				const targetClientTop = event.screenY - dragState.grabOffsetY - window.screenY;
				const viewportWidth = window.innerWidth;
				const viewportHeight = window.innerHeight;
				const clampedLeft = Math.min(
					Math.max(0, targetClientLeft),
					Math.max(0, viewportWidth - dragState.hudWidth),
				);
				const clampedTop = Math.min(
					Math.max(0, targetClientTop),
					Math.max(0, viewportHeight - dragState.hudHeight),
				);
				const currentRect = hudBar.getBoundingClientRect();
				recordingHudOffsetRef.current = {
					x: recordingHudOffsetRef.current.x + (clampedLeft - currentRect.left),
					y: recordingHudOffsetRef.current.y + (clampedTop - currentRect.top),
				};
			}

			if (hudDragMoveRafRef.current !== null) {
				cancelAnimationFrame(hudDragMoveRafRef.current);
				hudDragMoveRafRef.current = null;
			}
			hudDragPendingPointerRef.current = null;

			hudDragStartRef.current = null;
			const wasDragging = isHudDraggingRef.current;
			isHudDraggingRef.current = false;
			setRecordingHudOffset({ ...recordingHudOffsetRef.current });
			setIsHudDragging(false);
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			const hudBounds = mergeHudInteractiveBounds(
				[
					hudContentRef.current?.getBoundingClientRect(),
					hudBarRef.current?.getBoundingClientRect(),
					recordingWebcamPreviewContainerRef.current?.getBoundingClientRect(),
				].map((bounds) =>
					bounds
						? {
								left: bounds.left,
								top: bounds.top,
								right: bounds.right,
								bottom: bounds.bottom,
							}
						: null,
				),
			);
			if (
				wasDragging &&
				shouldRestoreHudMousePassthroughAfterDrag(hudBounds, event.clientX, event.clientY)
			) {
				window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
			}
		},
		[hudBarRef, hudContentRef, recordingWebcamPreviewContainerRef],
	);

	useEffect(() => {
		return () => {
			if (hudDragMoveRafRef.current !== null) {
				cancelAnimationFrame(hudDragMoveRafRef.current);
			}
			hudDragMoveRafRef.current = null;
			hudDragPendingPointerRef.current = null;
			hudDragStartRef.current = null;
		};
	}, []);

	return {
		recordingHudOffset,
		isHudDragging,
		hudBarTransformRef,
		isHudDraggingRef,
		handleHudBarPointerDown,
		handleHudBarPointerMove,
		handleHudBarPointerUp,
	};
}
