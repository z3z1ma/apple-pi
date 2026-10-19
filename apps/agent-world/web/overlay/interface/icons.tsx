// Small drawn icons for the interface's tabs, pips, and buttons: inline SVG, so they stay crisp at any zoom and sit
// exactly centred (text glyphs ride on font metrics and drift off centre).

const stroke = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.7,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

export function AgentsIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<circle cx="9" cy="8" r="3.2" {...stroke} />
			<path d="M3.5 19c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2" {...stroke} />
			<circle cx="16.5" cy="9" r="2.6" {...stroke} />
			<path d="M15.5 13.9c2.6-.3 4.4 1.3 5 4.6" {...stroke} />
		</svg>
	);
}

export function BellIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" {...stroke} />
			<path d="M10 20.2a2 2 0 0 0 4 0" {...stroke} />
		</svg>
	);
}

export function ScrollIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path d="M7 4.5h10.5a2 2 0 0 1 2 2v.5H17M7 4.5a2 2 0 0 0-2 2V17" {...stroke} />
			<path d="M17 7v11.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V17H13v1.5a2 2 0 0 0 4 0" {...stroke} />
			<path d="M9 9h5M9 12h5" {...stroke} />
		</svg>
	);
}

export function SignpostIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path d="M12 3v18M8.5 21h7" {...stroke} />
			<path d="M12 5.5h6.5l2 2-2 2H12zM12 11.5H5.5l-2 2 2 2H12z" {...stroke} />
		</svg>
	);
}

export function CogIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<circle cx="12" cy="12" r="3" {...stroke} />
			<path
				d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"
				{...stroke}
			/>
			<circle cx="12" cy="12" r="6.3" {...stroke} />
		</svg>
	);
}

export function CheckIcon() {
	return (
		<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
			<path d="M2.4 6.3 5 8.8l4.6-5.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
		</svg>
	);
}

export function QuestionIcon() {
	return (
		<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
			<path
				d="M4 4.3a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4v.3"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.7"
				strokeLinecap="round"
			/>
			<circle cx="6" cy="10" r="0.95" fill="currentColor" />
		</svg>
	);
}

export function ChevronIcon({ open }: { open: boolean }) {
	return (
		<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
			<path
				d={open ? "M3 4.5 6 7.5l3-3" : "M3 7.5 6 4.5l3 3"}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.7"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function CloseIcon() {
	return (
		<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
			<path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
		</svg>
	);
}
