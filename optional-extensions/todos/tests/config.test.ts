import { describe, it, expect } from "vitest";
import { sanitizeTodosConfig } from "../src/config.js";
describe("todos config", () =>
	it("accepts data-only bounded settings", () => {
		expect(sanitizeTodosConfig({ storage: "project", maxVisible: 10, evil: true })).toEqual({
			storage: "project",
			maxVisible: 10,
		});
		expect(sanitizeTodosConfig({ maxVisible: 999 })).toEqual({});
	}));
