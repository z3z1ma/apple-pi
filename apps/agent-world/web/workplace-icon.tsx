const paths = {
	refresh: "M3 12a9 9 0 0 1 15.36-6.36L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.36 6.36L3 16 M8 16H3v5",
	"chevron-right": "m9 5 7 7-7 7",
	"chevron-down": "m5 9 7 7 7-7",
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
