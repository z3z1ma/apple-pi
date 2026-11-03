// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { initialTheme } from "../web/initial-theme.js";

afterEach(() => window.history.replaceState(null, "", "/"));

test("a page opened with ?theme= starts in that theme, whatever the system prefers", () => {
	window.history.replaceState(null, "", "/?t=token&theme=dark");
	expect(initialTheme()).toBe("dark");
	window.history.replaceState(null, "", "/?t=token&theme=light");
	expect(initialTheme()).toBe("light");
});
