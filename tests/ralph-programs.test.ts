import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { runEvidenceFunction } from "../components/pi-exec/src/evidence.js";
import { guestPythonStubs } from "../components/pi-exec/src/guest-api.js";
import { createProgramSession, executeProgram } from "../components/pi-exec/src/program.js";

const source = (name: string, skill = "ralph") => readFileSync(join("skills", skill, "references", name), "utf8");
type Host = (ref: string, args: any) => Promise<any>;
/** Runs the actual packaged Python in Monty through pi_exec's real stubs, bindings, and evidence functions.
 * Model and core-tool answers are deterministic fixtures keyed by host ref; any fixture error fails the test.
 */
async function run(
	name: string,
	inputs: Record<string, string>,
	host: Host,
	cwd = process.cwd(),
	skill = "ralph",
): Promise<any> {
	const live = await createProgramSession(guestPythonStubs(cwd, []));
	let hostError: unknown;
	try {
		const execution = await executeProgram(
			live.session,
			source(name, skill),
			inputs,
			30_000,
			async (ref, args, signal) => {
				if (ref.startsWith("evidence."))
					return runEvidenceFunction(ref.slice("evidence.".length), args, { cwd, signal });
				try {
					return await host(ref, args);
				} catch (error) {
					hostError ??= error;
					throw error;
				}
			},
		);
		if (hostError) throw hostError;
		if (execution.outcome !== "succeeded") throw new Error(execution.error);
		return execution.value;
	} finally {
		await live.close();
	}
}
function fixtureBash(command: string, cwd: string): string {
	const shell = getShellConfig();
	const stdin = shell.commandTransport === "stdin";
	return execFileSync(shell.shell, stdin ? shell.args : [...shell.args, command], {
		cwd,
		encoding: "utf8",
		...(stdin ? { input: command } : {}),
	});
}
function checkout(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-review-python-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
	git("init", "-q");
	git("config", "user.email", "tests@example.invalid");
	git("config", "user.name", "Tests");
	writeFileSync(join(cwd, "feature.ts"), "export const safe = true;\n");
	git("add", ".");
	git("commit", "-qm", "initial");
	writeFileSync(join(cwd, "feature.ts"), "export const safe = false; // broken\n");
	return cwd;
}
describe("Ralph Python programs", () => {
	for (const program of ["ralph-simple.py", "ralph-ledger.py"]) {
		it(`${program} typechecks, sequences fresh peers, and stops on low mutation`, async () => {
			const cwd = checkout();
			let calls = 0;
			try {
				const result = await run(
					program,
					{
						goal: "One coherent increment",
						iterations: "4",
						task: ".ledger/task/task.md",
						stack: "README.md\n.ledger/task/task.md",
					},
					async (name, args) => {
						if (name === "pi.read") return "Status: open\n";
						expect(name).toBe("agent.run");
						expect(args.role).toBe("implementation-engineer");
						expect(args.outputSchema).toBeUndefined();
						expect(args.task).toContain("Never commit");
						expect(args.task).toContain("One coherent increment");
						if (program === "ralph-ledger.py")
							expect(args.context.stack).toEqual([".ledger/task/task.md", "README.md"]);
						calls++;
						return { status: "completed", text: "increment done" };
					},
					cwd,
				);
				expect(calls).toBe(2);
				expect(result).toMatchObject({
					status: "stopped",
					stopReason: "low-mutation",
					completedIterations: 2,
					requestedIterations: 4,
				});
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}
	it("counts changes to untracked content rather than treating a stable filename as no mutation", async () => {
		const cwd = checkout();
		let calls = 0;
		try {
			const path = join(cwd, "new ' file.txt");
			writeFileSync(path, "before");
			const result = await run(
				"ralph-simple.py",
				{ goal: "increment", iterations: "3" },
				async (name, args) => {
					if (name === "pi.bash") return { ok: true, output: fixtureBash(args.command, cwd) };
					calls++;
					writeFileSync(path, `increment ${calls}`);
					return { status: "completed", text: "increment done" };
				},
				cwd,
			);
			expect(result).toMatchObject({ status: "completed", completedIterations: 3 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects noncanonical iteration bounds, preserves failure counts, and observes terminal ledger status", async () => {
		const cwd = checkout();
		const inputs = { goal: "increment", iterations: "4", stack: "README.md", task: ".ledger/task/task.md" };
		try {
			await expect(
				run(
					"ralph-simple.py",
					{ ...inputs, iterations: "04" },
					async () => {
						throw new Error("unexpected call");
					},
					cwd,
				),
			).rejects.toThrow("canonical positive integer");
			const failed = await run(
				"ralph-simple.py",
				inputs,
				async () => ({ status: "failed", error: "peer failed" }),
				cwd,
			);
			expect(failed).toMatchObject({
				status: "failed",
				completedIterations: 0,
				failedAt: 1,
				failures: [{ iteration: 1, error: "peer failed" }],
			});
			const stopped = await run(
				"ralph-ledger.py",
				inputs,
				async (name) => {
					expect(name).toBe("pi.read");
					return "Status: blocked\n";
				},
				cwd,
			);
			expect(stopped).toMatchObject({ status: "stopped", stopReason: "task-blocked", completedIterations: 0 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
