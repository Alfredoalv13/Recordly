import { MicrophoneIcon, MicrophoneSlashIcon, MinusIcon, PauseIcon, PlayIcon, SquareIcon, XIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import styles from "./LaunchWindow.module.css";

interface RecordingControlsProps {
	paused: boolean;
	microphoneEnabled: boolean;
	elapsed: number;
	onToggleMicrophone: () => void;
	onPauseResume: () => void;
	onStopRecording: () => void;
	onHideHud: () => void;
	onCancelRecording: () => void;
	formatTime: (seconds: number) => string;
}

export const RecordingControls = ({
	paused,
	microphoneEnabled,
	elapsed,
	onToggleMicrophone,
	onPauseResume,
	onStopRecording,
	onHideHud,
	onCancelRecording,
	formatTime,
}: RecordingControlsProps) => {
	const t = useScopedT("launch");

	const memoizedControls = useMemo(() => {
		return (
			<>
				<div className="flex items-center gap-1">
					<div
						className={`w-[6px] h-[6px] rounded-full ${
							paused ? "bg-[#D59D80]" : `bg-[#B6410F] ${styles.recDotBlink}`
						}`}
					/>
					<span
						className={`text-[9px] font-bold tracking-[0.06em] ${
							paused ? "text-[#D59D80]" : "text-[#B6410F]"
						}`}
					>
						{paused ? t("recording.paused") : t("recording.rec")}
					</span>
				</div>

				<span
					className={`font-mono text-[11px] font-semibold min-w-[42px] text-center tracking-[0.02em] ${
						paused ? "text-[#D59D80]" : "text-[var(--launch-text)]"
					}`}
				>
					{formatTime(elapsed)}
				</span>

				<Separator orientation="vertical" className="mx-1 h-5" />

				<span title={t("recording.micToggleDisabledTip")}>
					<Button
						variant="ghost"
						size="icon"
						iconSize="sm"
						className={`h-7 w-7 ${microphoneEnabled ? styles.ibActive : ""}`}
						aria-label={t("recording.micToggleDisabledTip")}
						disabled
						onClick={onToggleMicrophone}
					>
						{microphoneEnabled ? (
							<MicrophoneIcon size={15} />
						) : (
							<MicrophoneSlashIcon size={15} />
						)}
					</Button>
				</span>

				<Separator orientation="vertical" className="mx-1 h-5" />

				<Button
					variant={paused ? "default" : "ghost"}
					size="icon"
					iconSize="sm"
					onClick={onPauseResume}
					title={paused ? t("recording.resume") : t("recording.pause")}
					aria-label={paused ? t("recording.resume") : t("recording.pause")}
					className={`h-7 w-7 ${paused ? styles.ibGreen : ""}`}
				>
					{paused ? (
						<PlayIcon size={15} fill="currentColor" strokeWidth={0} />
					) : (
						<PauseIcon size={15} />
					)}
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="sm"
					onClick={onStopRecording}
					title={t("recording.stop")}
					aria-label={t("recording.stop")}
					className={`h-7 w-7 ${styles.ibRed}`}
				>
					<SquareIcon size={13} fill="currentColor" strokeWidth={0} />
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="sm"
					onClick={onHideHud}
					title={t("recording.hideHud")}
					aria-label={t("recording.hideHud")}
					className="h-7 w-7"
				>
					<MinusIcon size={13} />
				</Button>

				<Button
					variant="ghost"
					size="icon"
					iconSize="sm"
					onClick={onCancelRecording}
					title={t("recording.cancel")}
					aria-label={t("recording.cancel")}
					className="h-7 w-7"
				>
					<XIcon size={15} />
				</Button>
			</>
		);
	}, [
		paused,
		microphoneEnabled,
		elapsed,
		onToggleMicrophone,
		onPauseResume,
		onStopRecording,
		onHideHud,
		onCancelRecording,
		formatTime,
		t,
	]);

	return memoizedControls;
};
