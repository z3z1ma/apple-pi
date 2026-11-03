const paths = {
	terminal: "M3 4h18v16H3V4Z M7 8l4 4-4 4 M13 16h4",
	plus: "M12 5v14 M5 12h14",
	trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
	refresh: "M3 12a9 9 0 0 1 15.36-6.36L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.36 6.36L3 16 M8 16H3v5",
	"chevron-right": "m9 5 7 7-7 7",
	"chevron-down": "m5 9 7 7 7-7",
	check: "m5 12.5 4.5 4.5L19 7.5",
	folder: "M3 7V4h6l2 3h10v13H3V7Z",
	"folder-open": "M3 12V4h6l2 3h10v5 M3 12h19l-4 8H3v-8Z",
	file: "M14 3H4v18h16V9l-6-6Z M14 3v6h6",
	close: "m6 6 12 12 M18 6 6 18",
	save: "M5 3h12l4 4v14H3V3h2Z M7 3v6h10V3 M7 21v-8h10v8",
	code: "m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
	issues: "M7 3h10v4H7V3Z M7 5H4v16h16V5h-3 M8 11h8 M8 16h5",
	org: "M9 3h6v5H9V3Z M3 16h6v5H3v-5Z M15 16h6v5h-6v-5Z M12 8v4 M6 16v-4h12v4",
	sent: "m3 4 18 8-18 8 4-8-4-8Z M7 12h14",
	activity: "M3 12h4l3-8 4 16 3-8h4",
	moon: "M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z",
	sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
	chat: "M5 4h14v12H9l-4 4V4Z M9 8h6 M9 12h4",
	mail: "M3 5h18v14H3V5Z M3 6l9 7 9-7",
	world: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
	search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z M15 15l5 5",
	compose: "m5 16-1 4 4-1L20 7l-3-3L5 16Z M14 7l3 3",
	tools: "m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
	inbox: "m3 14 3-9h12l3 9v5H3v-5Z M3 14h5l2 3h4l2-3h5",
	desk: "M3 11 12 4l9 7 M5 10v10h14V10 M10 20v-6h4v6",
	threads: "M4 4h12v9H8l-4 3V4Z M8 16v1h8l4 3V8h-4",
	bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z M10 21h4",
	reply: "M9 15 4 10l5-5 M4 10h10a6 6 0 0 1 6 6v3",
	forward: "m15 15 5-5-5-5 M20 10H10a6 6 0 0 0-6 6v3",
	copy: "M9 9h11v11H9V9Z M15 9V4H4v11h5",
	more: "M7 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M13 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z M19 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z",
	thread: "M4 5h16v10H9l-5 4V5Z",
	bookmark: "M6 3h12v18l-6-4-6 4V3Z",
	settings:
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
	smile: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z M8 14c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2 M9 9.5h.01 M15 9.5h.01",
};

export function Icon({ name }: { name: keyof typeof paths }) {
	return (
		<svg
			className="wp-icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d={paths[name]} />
		</svg>
	);
}
