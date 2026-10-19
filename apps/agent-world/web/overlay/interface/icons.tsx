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

/** Work, by default: a checklist (a pack may draw its own, `--aw-icon-work`). */
export function ChecklistIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<rect x="4" y="3.5" width="16" height="17" rx="2" {...stroke} />
			<path d="M7.5 8.5l1.3 1.3 2.2-2.4M7.5 14.5l1.3 1.3 2.2-2.4M13.5 9h3.5M13.5 15h3.5" {...stroke} />
		</svg>
	);
}

export function LetterIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<rect x="3.5" y="6" width="17" height="12" rx="1.6" {...stroke} />
			<path d="M4 6.8l8 6.2 8-6.2" {...stroke} />
			<circle cx="12" cy="14.6" r="1.6" fill="currentColor" />
		</svg>
	);
}

/** Places, by default: a folded map (a pack may draw its own, `--aw-icon-places`). */
export function MapIcon() {
	return (
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z" {...stroke} />
			<path d="M9 4.5v13M15 6.5v13" {...stroke} />
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

/** Two arrows apart (show more) or together (show less). */
export function GrowIcon({ grown }: { grown: boolean }) {
	return (
		<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
			<path
				d={grown ? "M3.5 1.5 6 4l2.5-2.5M3.5 10.5 6 8l2.5 2.5" : "M3.5 4 6 1.5 8.5 4M3.5 8 6 10.5 8.5 8"}
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
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
