interface VybeClipLogoProps {
	className?: string;
	title?: string;
}

export function VybeClipLogo({ className = "h-9 w-9", title }: VybeClipLogoProps) {
	return (
		<svg
			className={className}
			viewBox="0 0 40 40"
			fill="none"
			role={title ? "img" : "presentation"}
			aria-label={title}
		>
			<rect width="40" height="40" rx="9" fill="#0D1D25" />
			<path
				d="M12 9L20 29L28 9"
				stroke="#104C64"
				strokeWidth="6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M20 29L28 9"
				stroke="#D59D80"
				strokeWidth="6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path d="M19.6 18.4L24.4 12.6L20.1 9.4L16.9 12.6L19.6 18.4Z" fill="#C6C6D0" />
		</svg>
	);
}
