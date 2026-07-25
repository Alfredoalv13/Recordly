import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { buildSourceSidecarPathCandidates } from "./sourceAudioTracks";

export type SilenceAudioTrackId = "mic" | "system" | "mixed";

export interface SilenceAudioTrackOption {
	id: SilenceAudioTrackId;
	label: string;
	/** The first candidate path/URL that actually resolved. */
	resourcePath: string;
}

async function resolveFirstAvailableResource(candidates: string[]): Promise<string | null> {
	for (const candidate of candidates) {
		try {
			const url = await resolveMediaResourceUrl(candidate);
			const response = await fetch(url, { method: "HEAD" });
			if (response.ok) {
				return candidate;
			}
		} catch {
			// try the next candidate
		}
	}
	return null;
}

/**
 * Finds which audio sources actually exist for a recording: separate mic /
 * system-audio sidecar files if present, plus the embedded/mixed track in
 * the main video itself. Used to populate the track picker for "Remove
 * Silence" - the user chooses which one to base detection on.
 */
export async function resolveSilenceAudioTrackOptions(
	videoSourcePath: string,
): Promise<SilenceAudioTrackOption[]> {
	const micCandidates = buildSourceSidecarPathCandidates(videoSourcePath, "mic");
	const systemCandidates = buildSourceSidecarPathCandidates(videoSourcePath, "system");

	const [micPath, systemPath] = await Promise.all([
		resolveFirstAvailableResource(micCandidates),
		resolveFirstAvailableResource(systemCandidates),
	]);

	const options: SilenceAudioTrackOption[] = [];
	if (micPath) {
		options.push({ id: "mic", label: "Microphone", resourcePath: micPath });
	}
	if (systemPath) {
		options.push({ id: "system", label: "System Audio", resourcePath: systemPath });
	}
	options.push({ id: "mixed", label: "Full Recording", resourcePath: videoSourcePath });

	return options;
}

export interface DecodedAudioChannels {
	channelData: Float32Array[];
	sampleRate: number;
}

/**
 * Decodes a media resource to raw PCM channel data for silence analysis.
 * Not unit-tested - depends on fetch + the browser's Web Audio decoder,
 * which jsdom doesn't provide. Kept deliberately thin so the actual
 * detection logic (silenceDetection.ts) can be tested without it.
 */
export async function decodeAudioChannelsFromResource(
	resource: string,
): Promise<DecodedAudioChannels> {
	const url = await resolveMediaResourceUrl(resource);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to load audio: ${response.status}`);
	}
	const arrayBuffer = await response.arrayBuffer();
	const AudioContextCtor =
		window.AudioContext ||
		(window as typeof window & { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;
	const audioContext = new AudioContextCtor();
	try {
		const decoded = await audioContext.decodeAudioData(arrayBuffer);
		const channelData: Float32Array[] = [];
		for (let i = 0; i < decoded.numberOfChannels; i++) {
			channelData.push(decoded.getChannelData(i));
		}
		return { channelData, sampleRate: decoded.sampleRate };
	} finally {
		void audioContext.close();
	}
}
