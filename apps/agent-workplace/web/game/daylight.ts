export type DaylightPhase = "morning" | "afternoon" | "golden" | "evening" | "night";

export interface Daylight {
	phase: DaylightPhase;
	hour: number;
	tint: number;
	lamps: number;
	windows: number;
}

const KEYS: [number, number, number, number][] = [
	[0, 0x56619c, 1.8, 1],
	[4.5, 0x56619c, 1.8, 1],
	[5.75, 0x9c8fb6, 1.3, 0.7],
	[7, 0xe2e2ee, 0.65, 0.15],
	[9, 0xf0f2fa, 0.45, 0],
	[15, 0xf4f4f8, 0.45, 0],
	[16.5, 0xffffff, 0.8, 0.2],
	[18.25, 0xffffff, 0.9, 0.3],
	[19.5, 0xb59cc2, 1.35, 0.75],
	[20.5, 0x6d74aa, 1.7, 1],
	[21.5, 0x56619c, 1.8, 1],
	[24, 0x56619c, 1.8, 1],
];

const PHASES: [until: number, phase: DaylightPhase][] = [
	[5, "night"],
	[11, "morning"],
	[16, "afternoon"],
	[18.5, "golden"],
	[21, "evening"],
	[24, "night"],
];

function mix(a: number, b: number, t: number): number {
	const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
	return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function daylightAt(date: Date): Daylight {
	const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
	const next = KEYS.findIndex(([h]) => h > hour);
	const [h0, tint0, lamps0, windows0] = KEYS[Math.max(0, next - 1)];
	const [h1, tint1, lamps1, windows1] = KEYS[next < 0 ? KEYS.length - 1 : next];
	const t = h1 > h0 ? (hour - h0) / (h1 - h0) : 0;
	const eased = t * t * (3 - 2 * t);
	return {
		phase: PHASES.find(([until]) => hour < until)?.[1] ?? "night",
		hour,
		tint: mix(tint0, tint1, eased),
		lamps: lamps0 + (lamps1 - lamps0) * eased,
		windows: windows0 + (windows1 - windows0) * eased,
	};
}

export function hex(tint: number): string {
	return `#${tint.toString(16).padStart(6, "0")}`;
}
