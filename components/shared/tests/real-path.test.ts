import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonical } from "../src/real-path.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-real-path-")));
	dirs.push(dir);
	return dir;
}

describe("canonical", () => {
	it("follows a symlink before applying the .. that comes after it, as the kernel does", () => {
		const [inside, outside] = [tempDir(), tempDir()];
		mkdirSync(join(outside, "child"));
		symlinkSync(join(outside, "child"), join(inside, "pivot"));
		symlinkSync("pivot/../hidden.sh", join(inside, "gate.sh"));

		expect(canonical(join(inside, "gate.sh"))).toBe(join(outside, "hidden.sh"));
		// Unnormalized, as a tool argument can arrive: the .. applies after gate.sh is followed.
		expect(canonical(`${inside}/gate.sh/../x`)).toBe(join(outside, "x"));
	});

	it("restarts from the root for an absolute target and resolves relative targets from the link's directory", () => {
		const [inside, outside] = [tempDir(), tempDir()];
		mkdirSync(join(inside, "a"));
		symlinkSync(join(outside, "new.sh"), join(inside, "a", "abs"));
		symlinkSync("../b/new.sh", join(inside, "a", "rel"));

		expect(canonical(join(inside, "a", "abs"))).toBe(join(outside, "new.sh"));
		expect(canonical(join(inside, "a", "rel"))).toBe(join(inside, "b", "new.sh"));
	});

	it("resolves the rest lexically once a component does not exist", () => {
		const dir = tempDir();
		expect(canonical(`${dir}/missing/deeper/../file`)).toBe(join(dir, "missing", "file"));
	});

	it("throws on a symlink loop instead of returning a path that looks resolved", () => {
		const dir = tempDir();
		symlinkSync("b", join(dir, "a"));
		symlinkSync("a", join(dir, "b"));
		expect(() => canonical(join(dir, "a", "x"))).toThrow(/ELOOP|too many symbolic links/i);
	});

	it("throws when a component cannot be inspected, rather than treating it as missing", () => {
		const dir = tempDir();
		mkdirSync(join(dir, "locked"));
		chmodSync(join(dir, "locked"), 0o000);
		try {
			expect(() => canonical(join(dir, "locked", "link", "x"))).toThrow(/EACCES/);
		} finally {
			chmodSync(join(dir, "locked"), 0o755);
		}
	});
});
