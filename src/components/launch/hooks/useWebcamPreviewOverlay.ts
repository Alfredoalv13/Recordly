import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { canShowFloatingWebcamPreview } from "../floatingWebcamPreview";

const WEBCAM_PREVIEW_DRAG_THRESHOLD = 6;
const DEFAULT_WEBCAM_PREVIEW_OFFSET = { x: 0, y: 0 };

export function useWebcamPreviewOverlay({
	webcamEnabled,
	webcamDeviceId,
	showWebcamControls,
	webcamPopoverOpen,
	hudOverlayMousePassthroughSupported,
}: {
	webcamEnabled: boolean;
	webcamDeviceId?: string;
	showWebcamControls: boolean;
	webcamPopoverOpen: boolean;
	hudOverlayMousePassthroughSupported: boolean | null;
}) {
	const [showFloatingWebcamPreview, setShowFloatingWebcamPreview] = useState(true);
	const [webcamPreviewOffset, setWebcamPreviewOffset] = useState(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewOffsetRef = useRef(DEFAULT_WEBCAM_PREVIEW_OFFSET);
	const webcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewRef = useRef<HTMLVideoElement | null>(null);
	const recordingWebcamPreviewContainerRef = useRef<HTMLDivElement | null>(null);
	const previewStreamRef = useRef<MediaStream | null>(null);
	const previewDragMoveRafRef = useRef<number | null>(null);
	const previewDragPendingPointerRef = useRef<{ screenX: number; screenY: number } | null>(null);
	const webcamPreviewDragStartRef = useRef<{
		pointerId: number;
		startScreenX: number;
		startScreenY: number;
		// Distance (in CSS px) from the bubble's rendered top-left corner to the
		// point the user grabbed it at. Unlike a client-coordinate snapshot,
		// this stays meaningful even if the HUD window itself moves or resizes
		// mid-drag (see requestWebcamPreviewRelocate below).
		grabOffsetX: number;
		grabOffsetY: number;
		previewWidth: number;
		previewHeight: number;
		dragging: boolean;
	} | null>(null);
	const isWebcamPreviewDraggingRef = useRef(false);
	const webcamPreviewRelocateInFlightRef = useRef(false);
	const showRecordingWebcamPreview =
		webcamEnabled &&
		canShowFloatingWebcamPreview(
			showFloatingWebcamPreview,
			hudOverlayMousePassthroughSupported,
		);
	const shouldStreamWebcamPreview =
		webcamEnabled && (showRecordingWebcamPreview || (showWebcamControls && webcamPopoverOpen));

	useEffect(() => {
		if (!webcamEnabled) {
			webcamPreviewOffsetRef.current = DEFAULT_WEBCAM_PREVIEW_OFFSET;
			setWebcamPreviewOffset(DEFAULT_WEBCAM_PREVIEW_OFFSET);
			if (recordingWebcamPreviewContainerRef.current) {
				recordingWebcamPreviewContainerRef.current.style.transform = "translate(0px, 0px)";
			}
			webcamPreviewDragStartRef.current = null;
			isWebcamPreviewDraggingRef.current = false;
			setShowFloatingWebcamPreview(true);
		}
	}, [webcamEnabled]);

	const handleWebcamPreviewPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			const previewRect = event.currentTarget.getBoundingClientRect();

			event.preventDefault();
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(false);
			webcamPreviewDragStartRef.current = {
				pointerId: event.pointerId,
				startScreenX: event.screenX,
				startScreenY: event.screenY,
				grabOffsetX: event.clientX - previewRect.left,
				grabOffsetY: event.clientY - previewRect.top,
				previewWidth: previewRect.width,
				previewHeight: previewRect.height,
				dragging: false,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[],
	);

	// The HUD window (which the floating preview bubble renders inside) is
	// sized to a single display's work area, so a drag that reaches its edge
	// can't go any further on its own. This asks the main process to hop the
	// real window onto whichever display is now under the cursor - the same
	// mechanism the HUD control bar uses. It's fire-and-forget:
	// handleWebcamPreviewPointerMove re-measures the bubble's actual rendered
	// position every frame (see currentRect below), so whenever the window
	// does move, the very next frame naturally reconciles against it.
	const requestWebcamPreviewRelocate = useCallback((screenX: number, screenY: number) => {
		if (
			webcamPreviewRelocateInFlightRef.current ||
			!window.electronAPI?.hudOverlayRelocateToPoint
		) {
			return;
		}

		webcamPreviewRelocateInFlightRef.current = true;
		window.electronAPI
			.hudOverlayRelocateToPoint(screenX, screenY)
			.catch(() => {
				// Best-effort: if the round trip fails, the drag simply stays
				// clamped to the current display, same as before this feature.
			})
			.finally(() => {
				webcamPreviewRelocateInFlightRef.current = false;
			});
	}, []);

	const handleWebcamPreviewPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const dragState = webcamPreviewDragStartRef.current;
			if (!dragState || dragState.pointerId !== event.pointerId) {
				return;
			}

			if (!dragState.dragging) {
				const distance = Math.hypot(
					event.screenX - dragState.startScreenX,
					event.screenY - dragState.startScreenY,
				);
				if (distance < WEBCAM_PREVIEW_DRAG_THRESHOLD) {
					return;
				}
				dragState.dragging = true;
				isWebcamPreviewDraggingRef.current = true;
			}

			previewDragPendingPointerRef.current = { screenX: event.screenX, screenY: event.screenY };
			if (previewDragMoveRafRef.current !== null) {
				return;
			}

			previewDragMoveRafRef.current = requestAnimationFrame(() => {
				previewDragMoveRafRef.current = null;
				const latestDragState = webcamPreviewDragStartRef.current;
				const pointer = previewDragPendingPointerRef.current;
				const previewContainer = recordingWebcamPreviewContainerRef.current;
				if (!latestDragState || !pointer || !previewContainer) {
					return;
				}

				// Target position in absolute screen coordinates, derived from the
				// cursor's real screen position and the fixed grab offset. Using
				// window.screenX/screenY (which always reflects the HUD window's
				// *current* position) rather than a delta from drag start means this
				// stays correct even if the window has moved since the last frame.
				const targetClientLeft =
					pointer.screenX - latestDragState.grabOffsetX - window.screenX;
				const targetClientTop =
					pointer.screenY - latestDragState.grabOffsetY - window.screenY;
				const viewportWidth = window.innerWidth;
				const viewportHeight = window.innerHeight;
				const clampedLeft = Math.min(
					Math.max(0, targetClientLeft),
					Math.max(0, viewportWidth - latestDragState.previewWidth),
				);
				const clampedTop = Math.min(
					Math.max(0, targetClientTop),
					Math.max(0, viewportHeight - latestDragState.previewHeight),
				);

				// Re-measure the bubble's actual rendered rect (rather than trusting
				// a snapshot from drag start) so a mid-drag resize/relocate of the
				// HUD window is absorbed automatically.
				const currentRect = previewContainer.getBoundingClientRect();
				const nextOffset = {
					x: webcamPreviewOffsetRef.current.x + (clampedLeft - currentRect.left),
					y: webcamPreviewOffsetRef.current.y + (clampedTop - currentRect.top),
				};
				webcamPreviewOffsetRef.current = nextOffset;
				previewContainer.style.transform = `translate(${nextOffset.x}px, ${nextOffset.y}px)`;

				// The bubble is pressed against an edge of the current display's
				// window - ask the main process to hop the real window onto
				// whichever display the cursor is now over, if any.
				if (targetClientLeft !== clampedLeft || targetClientTop !== clampedTop) {
					requestWebcamPreviewRelocate(pointer.screenX, pointer.screenY);
				}
			});
		},
		[requestWebcamPreviewRelocate],
	);

	const handleWebcamPreviewPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
		const dragState = webcamPreviewDragStartRef.current;
		if (!dragState || dragState.pointerId !== event.pointerId) {
			return;
		}

		const previewContainer = recordingWebcamPreviewContainerRef.current;
		if (previewContainer) {
			const targetClientLeft = event.screenX - dragState.grabOffsetX - window.screenX;
			const targetClientTop = event.screenY - dragState.grabOffsetY - window.screenY;
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const clampedLeft = Math.min(
				Math.max(0, targetClientLeft),
				Math.max(0, viewportWidth - dragState.previewWidth),
			);
			const clampedTop = Math.min(
				Math.max(0, targetClientTop),
				Math.max(0, viewportHeight - dragState.previewHeight),
			);
			const currentRect = previewContainer.getBoundingClientRect();
			webcamPreviewOffsetRef.current = {
				x: webcamPreviewOffsetRef.current.x + (clampedLeft - currentRect.left),
				y: webcamPreviewOffsetRef.current.y + (clampedTop - currentRect.top),
			};
		}

		if (previewDragMoveRafRef.current !== null) {
			cancelAnimationFrame(previewDragMoveRafRef.current);
			previewDragMoveRafRef.current = null;
		}
		previewDragPendingPointerRef.current = null;

		const wasDragging = dragState.dragging;
		webcamPreviewDragStartRef.current = null;
		isWebcamPreviewDraggingRef.current = false;
		setWebcamPreviewOffset({ ...webcamPreviewOffsetRef.current });
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (wasDragging) {
			window.electronAPI?.hudOverlaySetIgnoreMouse?.(true);
		}
	}, []);

	const attachPreviewStreamToNode = useCallback((videoElement: HTMLVideoElement | null) => {
		const previewStream = previewStreamRef.current;
		if (!videoElement || !previewStream || videoElement.srcObject === previewStream) {
			return;
		}

		videoElement.srcObject = previewStream;
		const playPromise = videoElement.play();
		if (playPromise) {
			playPromise.catch(() => {
				// Ignore autoplay interruptions while the preview element mounts.
			});
		}
	}, []);

	const setWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			webcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	const setRecordingWebcamPreviewNode = useCallback(
		(node: HTMLVideoElement | null) => {
			recordingWebcamPreviewRef.current = node;
			attachPreviewStreamToNode(node);
		},
		[attachPreviewStreamToNode],
	);

	useEffect(() => {
		return () => {
			if (previewDragMoveRafRef.current !== null) {
				cancelAnimationFrame(previewDragMoveRafRef.current);
			}
			previewDragMoveRafRef.current = null;
			previewDragPendingPointerRef.current = null;
		};
	}, []);

	useEffect(() => {
		let mounted = true;

		const startPreview = async () => {
			if (!shouldStreamWebcamPreview) {
				return;
			}

			try {
				const previewStream = await navigator.mediaDevices.getUserMedia({
					video: webcamDeviceId
						? {
								deviceId: { exact: webcamDeviceId },
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
						  }
						: {
								width: { ideal: 320 },
								height: { ideal: 320 },
								frameRate: { ideal: 24, max: 30 },
						  },
					audio: false,
				});

				if (!mounted) {
					previewStream.getTracks().forEach((track) => track.stop());
					return;
				}

				previewStreamRef.current = previewStream;
				attachPreviewStreamToNode(webcamPreviewRef.current);
				attachPreviewStreamToNode(recordingWebcamPreviewRef.current);
			} catch (error) {
				console.warn("Failed to start live webcam preview:", error);
			}
		};

		void startPreview();

		return () => {
			mounted = false;
			const previewNode = webcamPreviewRef.current;
			const recordingPreviewNode = recordingWebcamPreviewRef.current;
			const previewStream = previewStreamRef.current;

			[previewNode, recordingPreviewNode]
				.filter((node): node is HTMLVideoElement => Boolean(node))
				.forEach((videoElement) => {
					videoElement.pause();
					videoElement.srcObject = null;
				});
			previewStream?.getTracks().forEach((track) => track.stop());
			if (previewStreamRef.current === previewStream) {
				previewStreamRef.current = null;
			}
		};
	}, [attachPreviewStreamToNode, shouldStreamWebcamPreview, webcamDeviceId]);

	return {
		showFloatingWebcamPreview,
		setShowFloatingWebcamPreview,
		webcamPreviewOffset,
		recordingWebcamPreviewContainerRef,
		isWebcamPreviewDraggingRef,
		webcamPreviewDragStartRef,
		handleWebcamPreviewPointerDown,
		handleWebcamPreviewPointerMove,
		handleWebcamPreviewPointerUp,
		setWebcamPreviewNode,
		setRecordingWebcamPreviewNode,
		showRecordingWebcamPreview,
	};
}
