import { Check, Clock, EyeSlash, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "../../../contexts/I18nContext";
import type { SuggestedRedactionSpan } from "./redactionSuggestionUtils";

export interface RedactionSuggestionItem extends SuggestedRedactionSpan {
	id: string;
}

interface RedactionSuggestionsPanelProps {
	suggestions: RedactionSuggestionItem[];
	onPreview: (suggestion: RedactionSuggestionItem) => void;
	onAccept: (suggestion: RedactionSuggestionItem) => void;
	onAcceptAll: () => void;
	onReject: (suggestion: RedactionSuggestionItem) => void;
	onDismiss: () => void;
}

function formatDuration(startMs: number, endMs: number) {
	const seconds = Math.max(0, (endMs - startMs) / 1000);
	return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function formatTimestamp(ms: number) {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The seconds immediately before each BlurBox overlay was created — the
 * likely "sensitive content was exposed and not yet covered" window —
 * surfaced as reviewable suggested cuts. Unlike auto-zoom/remove-silence
 * (which apply immediately and rely on undo), these require an explicit
 * Accept before anything touches the timeline: a false positive here (boxes
 * placed before anything sensitive was ever shown) should never silently
 * remove footage. The timeline overlay lets the user drag either edge before
 * accepting, since the fixed window is a guess, not a detected boundary.
 */
export function RedactionSuggestionsPanel({
	suggestions,
	onPreview,
	onAccept,
	onAcceptAll,
	onReject,
	onDismiss,
}: RedactionSuggestionsPanelProps) {
	const t = useScopedT("editor");

	if (suggestions.length === 0) {
		return null;
	}

	return (
		<div
			className="fixed bottom-6 right-6 z-50 w-80 rounded-xl border border-foreground/10 bg-editor-panel shadow-2xl"
			role="region"
			aria-label={t("timeline.redactionSuggestions.title", "Redaction cuts detected")}
		>
			<div className="flex items-center justify-between gap-2 border-b border-foreground/10 px-4 py-3">
				<div className="flex items-center gap-2 min-w-0">
					<EyeSlash className="h-4 w-4 shrink-0 text-primary" />
					<span className="truncate text-sm font-semibold text-foreground">
						{t("timeline.redactionSuggestions.title", "Redaction cuts detected")}
					</span>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={onDismiss}
					title={t("timeline.redactionSuggestions.dismiss", "Dismiss")}
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			<p className="px-4 pt-3 text-xs text-muted-foreground">
				{t(
					"timeline.redactionSuggestions.description",
					"BlurBox detected {{count}} moment(s) where you were covering something sensitive. Review each before cutting.",
					{ count: suggestions.length },
				)}
			</p>

			<ul className="max-h-56 space-y-1 overflow-y-auto px-2 py-2">
				{suggestions.map((suggestion) => (
					<li key={suggestion.id}>
						{/* A native <button> can't contain the Accept/Reject <Button>s
						    below — nested interactive elements are invalid HTML and
						    unreliable for assistive tech. role="button" + explicit
						    key handling gets the same click/keyboard behavior without
						    nesting a real button inside a real button. */}
						<div
							role="button"
							tabIndex={0}
							onClick={() => onPreview(suggestion)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									onPreview(suggestion);
								}
							}}
							className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.06]"
						>
							<div className="flex min-w-0 flex-1 items-center gap-2">
								<span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
									{formatTimestamp(suggestion.start)}
								</span>
								<span className="truncate text-xs text-foreground">
									{formatDuration(suggestion.start, suggestion.end)}
								</span>
								{suggestion.isLongOutlier ? (
									<span
										className="flex shrink-0 items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
										title={t(
											"timeline.redactionSuggestions.longOutlierHint",
											"Longer than usual — worth a closer look before accepting.",
										)}
									>
										<Clock className="h-3 w-3" />
										{t(
											"timeline.redactionSuggestions.longOutlierBadge",
											"Long",
										)}
									</span>
								) : null}
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 text-muted-foreground hover:bg-primary/10 hover:text-primary"
									onClick={(event) => {
										event.stopPropagation();
										onAccept(suggestion);
									}}
									title={t("timeline.redactionSuggestions.accept", "Accept")}
								>
									<Check className="h-3.5 w-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6 text-muted-foreground hover:text-foreground"
									onClick={(event) => {
										event.stopPropagation();
										onReject(suggestion);
									}}
									title={t("timeline.redactionSuggestions.reject", "Reject")}
								>
									<X className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					</li>
				))}
			</ul>

			<div className="border-t border-foreground/10 p-3">
				<Button
					size="sm"
					className="w-full bg-primary text-white hover:bg-primary/90"
					onClick={onAcceptAll}
				>
					{t("timeline.redactionSuggestions.acceptAll", "Accept All ({{count}})", {
						count: suggestions.length,
					})}
				</Button>
			</div>
		</div>
	);
}
