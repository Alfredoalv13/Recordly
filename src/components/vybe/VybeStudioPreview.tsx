import {
	ArrowSquareOutIcon,
	CameraIcon,
	CaretDownIcon,
	ExportIcon,
	FilmSlateIcon,
	FolderOpenIcon,
	MicrophoneIcon,
	MonitorIcon,
	PlayIcon,
	PlusIcon,
	RecordIcon,
	SlidersHorizontalIcon,
	SparkleIcon,
	UploadSimpleIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { VybeClipLogo } from "../brand/VybeClipLogo";

const workspaceItems = [
	{ label: "Current Recording", meta: "Ready to capture", active: true },
	{ label: "Project Assets", meta: "Clips, overlays, audio" },
	{ label: "Brand Kit", meta: "VybeClip presets" },
];

const inspectorRows = [
	["Format", "16:9 Desktop"],
	["Canvas Style", "Clean Demo"],
	["Pointer", "Soft Highlight"],
	["Captions", "Smart Draft"],
];

export function VybeStudioPreview() {
	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#05080A] text-[#C6C6D0]">
			<header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0A1115] px-4">
				<div className="flex min-w-0 items-center gap-3">
					<VybeClipLogo className="h-8 w-8 shrink-0" title="VybeClip" />
					<div className="min-w-0">
						<h1 className="truncate text-[13px] font-semibold leading-4 text-[#F3E7DE]">
							VybeClip Studio
						</h1>
						<p className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-[#D59D80]/70">
							Capture, polish, publish
						</p>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						className="hidden h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-[#C6C6D0] transition hover:border-[#104C64]/70 hover:bg-[#104C64]/20 sm:inline-flex"
					>
						<UploadSimpleIcon size={15} />
						Import
					</button>
					<button
						type="button"
						className="hidden h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-[#C6C6D0] transition hover:border-[#D59D80]/60 hover:bg-[#D59D80]/10 sm:inline-flex"
					>
						<ExportIcon size={15} />
						Export
					</button>
					<button
						type="button"
						className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#B6410F] px-3 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(182,65,15,0.28)] transition hover:bg-[#C0754D]"
					>
						<RecordIcon size={15} weight="fill" />
						Record
					</button>
				</div>
			</header>

			<div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,240px)_minmax(0,1fr)] lg:grid-cols-[256px_minmax(0,1fr)_288px]">
				<aside className="hidden min-h-0 border-r border-white/[0.06] bg-[#0A1115] p-3 sm:block">
					<div className="mb-3 flex items-center justify-between">
						<span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C6C6D0]/45">
							Workspace
						</span>
						<button
							type="button"
							className="grid h-7 w-7 place-items-center rounded-md border border-white/[0.07] text-[#D59D80] transition hover:bg-[#D59D80]/10"
							aria-label="Add workspace item"
						>
							<PlusIcon size={14} />
						</button>
					</div>

					<nav className="space-y-1.5">
						{workspaceItems.map((item) => (
							<button
								key={item.label}
								type="button"
								className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition ${
									item.active
										? "border-[#104C64]/65 bg-[#104C64]/25 text-[#F3E7DE]"
										: "border-transparent text-[#C6C6D0]/70 hover:border-white/[0.06] hover:bg-white/[0.03]"
								}`}
							>
								<span
									className={`h-2 w-2 rounded-full ${
										item.active ? "bg-[#B6410F]" : "bg-[#104C64]"
									}`}
								/>
								<span className="min-w-0">
									<span className="block truncate text-xs font-medium">{item.label}</span>
									<span className="block truncate text-[10px] text-[#C6C6D0]/45">{item.meta}</span>
								</span>
							</button>
						))}
					</nav>

					<div className="mt-6 rounded-md border border-white/[0.06] bg-[#05080A] p-3">
						<div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#F3E7DE]">
							<SparkleIcon size={15} className="text-[#D59D80]" />
							Quick Setup
						</div>
						<div className="grid gap-2 text-[11px] text-[#C6C6D0]/70">
							<div className="flex items-center gap-2">
								<MonitorIcon size={14} className="text-[#104C64]" />
								Screen source selected
							</div>
							<div className="flex items-center gap-2">
								<MicrophoneIcon size={14} className="text-[#C0754D]" />
								Voice cleanup ready
							</div>
							<div className="flex items-center gap-2">
								<CameraIcon size={14} className="text-[#D59D80]" />
								Camera overlay optional
							</div>
						</div>
					</div>
				</aside>

				<main className="flex min-h-0 flex-col bg-[#05080A]">
					<section className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-6">
						<div className="flex aspect-video w-full max-w-5xl items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-black shadow-[0_24px_80px_rgba(0,0,0,0.38)]">
							<div className="relative flex h-full w-full items-center justify-center">
								<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(16,76,100,0.24),transparent_40%),linear-gradient(135deg,rgba(13,29,37,0.86),rgba(5,8,10,0.92)_58%,rgba(96,35,11,0.34))]" />
								<div className="relative flex flex-col items-center gap-4 text-center">
									<div className="grid h-14 w-14 place-items-center rounded-md border border-[#D59D80]/20 bg-[#0D1D25]/80 text-[#D59D80]">
										<PlayIcon size={26} weight="fill" />
									</div>
									<div>
										<p className="text-sm font-semibold text-[#F3E7DE]">Canvas Stage</p>
										<p className="mt-1 text-xs text-[#C6C6D0]/55">
											Your screen recording preview will live here.
										</p>
									</div>
								</div>
							</div>
						</div>
					</section>

					<section className="h-48 shrink-0 border-t border-white/[0.06] bg-[#0A1115]">
						<div className="flex h-10 items-center justify-between border-b border-white/[0.06] px-4">
							<div className="flex items-center gap-2 text-xs font-semibold text-[#F3E7DE]">
								<FilmSlateIcon size={15} className="text-[#D59D80]" />
								Timeline
							</div>
							<div className="flex items-center gap-2 text-[10px] text-[#C6C6D0]/50">
								<span>00:00</span>
								<span className="h-1 w-1 rounded-full bg-[#C6C6D0]/30" />
								<span>Draft clip</span>
							</div>
						</div>
						<div className="grid h-[calc(100%-2.5rem)] grid-rows-2 gap-3 p-4">
							<div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
								<div className="flex items-center gap-2 text-[11px] text-[#C6C6D0]/60">
									<FilmSlateIcon size={14} />
									Video
								</div>
								<div className="h-10 rounded-md border border-[#104C64]/50 bg-[#104C64]/30 px-3 py-2">
									<div className="h-full w-[58%] rounded bg-[#104C64]/70" />
								</div>
							</div>
							<div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
								<div className="flex items-center gap-2 text-[11px] text-[#C6C6D0]/60">
									<WaveformIcon size={14} />
									Audio
								</div>
								<div className="h-10 rounded-md border border-[#C0754D]/40 bg-[#C0754D]/20 px-3 py-2">
									<div className="h-full w-[42%] rounded bg-[#D59D80]/55" />
								</div>
							</div>
						</div>
					</section>
				</main>

				<aside className="hidden min-h-0 border-l border-white/[0.06] bg-[#0A1115] p-4 lg:block">
					<div className="mb-4 flex items-center justify-between">
						<div className="flex items-center gap-2 text-xs font-semibold text-[#F3E7DE]">
							<SlidersHorizontalIcon size={15} className="text-[#D59D80]" />
							Scene Inspector
						</div>
						<button
							type="button"
							className="grid h-7 w-7 place-items-center rounded-md border border-white/[0.07] text-[#C6C6D0]/70 transition hover:bg-white/[0.04]"
							aria-label="Open inspector options"
						>
							<ArrowSquareOutIcon size={14} />
						</button>
					</div>

					<div className="space-y-3">
						{inspectorRows.map(([label, value]) => (
							<label key={label} className="block">
								<span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C6C6D0]/42">
									{label}
								</span>
								<button
									type="button"
									className="flex h-9 w-full items-center justify-between rounded-md border border-white/[0.08] bg-[#05080A] px-3 text-left text-xs text-[#C6C6D0] transition hover:border-[#104C64]/70"
								>
									{value}
									<CaretDownIcon size={12} className="text-[#D59D80]" />
								</button>
							</label>
						))}
					</div>

					<button
						type="button"
						className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-[#D59D80]/30 bg-[#D59D80]/10 text-xs font-semibold text-[#F3E7DE] transition hover:bg-[#D59D80]/16"
					>
						<FolderOpenIcon size={15} />
						Open Existing Project
					</button>
				</aside>
			</div>
		</div>
	);
}
