import { describe, expect, it } from "vitest";
import { daylightAt } from "../web/game/daylight.js";

// The aliveness pass (ticket 11 of the alive pass): out of doors the light follows the local time of day. The
// paintings are painted at golden hour, so golden hour leaves them as painted; the day is a little cooler, the evening
// dims to violet, and the night to deep blue, with windows lit and lamps glowing brighter.
const at = (hours: number, minutes = 0) => new Date(2026, 9, 19, hours, minutes);
const channels = (tint: number) => [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
const brightness = (tint: number) => channels(tint).reduce((a, b) => a + b, 0) / 3;

describe("daylight", () => {
	it.each([
		[7, "morning"],
		[10, "morning"],
		[13, "afternoon"],
		[17, "golden"],
		[19, "evening"],
		[20, "evening"],
		[22, "night"],
		[2, "night"],
	] as const)("at %i:00 is %s", (hour, phase) => {
		expect(daylightAt(at(hour)).phase).toBe(phase);
	});

	it("leaves the painting as painted at golden hour and darkens it most at night", () => {
		expect(daylightAt(at(17)).tint).toBe(0xffffff);
		const night = daylightAt(at(1));
		expect(brightness(night.tint)).toBeLessThan(140);
		// Night is blue: the blue channel stays highest.
		const [r, g, b] = channels(night.tint);
		expect(b).toBeGreaterThan(r);
		expect(b).toBeGreaterThan(g);
		expect(brightness(daylightAt(at(13)).tint)).toBeGreaterThan(235);
	});

	it("lights windows and turns lamps up after dark, and down by day", () => {
		const night = daylightAt(at(23));
		const noon = daylightAt(at(12));
		const evening = daylightAt(at(19, 30));
		expect(night.windows).toBe(1);
		expect(noon.windows).toBe(0);
		expect(evening.windows).toBeGreaterThan(0.5);
		expect(night.lamps).toBeGreaterThan(1.5);
		expect(noon.lamps).toBeLessThan(0.6);
		expect(night.lamps).toBeGreaterThan(evening.lamps);
	});

	it("changes smoothly: never more than a small step from one minute to the next", () => {
		let before = daylightAt(at(0));
		for (let minute = 1; minute <= 24 * 60; minute++) {
			const now = daylightAt(at(0, minute));
			const step = Math.max(...channels(now.tint).map((c, i) => Math.abs(c - channels(before.tint)[i])));
			expect(step, `tint at minute ${minute}`).toBeLessThanOrEqual(2);
			expect(Math.abs(now.lamps - before.lamps)).toBeLessThan(0.02);
			expect(Math.abs(now.windows - before.windows)).toBeLessThan(0.02);
			before = now;
		}
	});

	it("passes through the evening on the way from golden hour to night", () => {
		const tints = [17, 18, 19, 20, 21, 22].map((h) => brightness(daylightAt(at(h)).tint));
		for (let i = 1; i < tints.length; i++) expect(tints[i]).toBeLessThanOrEqual(tints[i - 1]);
		expect(tints[0]).toBeGreaterThan(tints.at(-1)! + 80);
	});
});
