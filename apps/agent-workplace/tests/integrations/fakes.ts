// Fakes at the edges for the integration adapters: a loopback HTTP server that records every request (Jira,
// Confluence, Slack), and a fake `gh` on PATH that answers from rules and logs its arguments.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Seen {
	method: string;
	path: string;
	query: URLSearchParams;
	headers: IncomingMessage["headers"];
	body: string;
}

export type Route = (request: Seen) => { status?: number; json?: unknown } | undefined;

export interface FakeServer {
	url: string;
	seen: Seen[];
	route(handler: Route): void;
	close(): Promise<void>;
}

/** A server answering with the first route that answers; 404 otherwise. */
export async function fakeServer(): Promise<FakeServer> {
	const routes: Route[] = [];
	const seen: Seen[] = [];
	const server: Server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			const url = new URL(request.url ?? "/", "http://fake");
			const entry: Seen = {
				method: request.method ?? "GET",
				path: url.pathname,
				query: url.searchParams,
				headers: request.headers,
				body,
			};
			seen.push(entry);
			for (const route of routes) {
				const answer = route(entry);
				if (!answer) continue;
				response.writeHead(answer.status ?? 200, { "Content-Type": "application/json" });
				response.end(answer.json === undefined ? "" : JSON.stringify(answer.json));
				return;
			}
			response.writeHead(404, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ errorMessages: [`no route for ${entry.method} ${entry.path}`] }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		seen,
		route: (handler) => routes.unshift(handler),
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

export interface GhRule {
	/** Every one of these must appear, in order, in the arguments. */
	args: string[];
	/** Optional working directory the call must run in. */
	cwd?: string;
	stdout?: unknown;
	stderr?: string;
	code?: number;
}

export interface FakeGh {
	dir: string;
	/** The environment to run with: the fake first on PATH. */
	env: NodeJS.ProcessEnv;
	rules(rules: GhRule[]): void;
	/** Every call so far: its arguments and working directory. */
	calls(): { args: string[]; cwd: string }[];
}

/** A `gh` script on PATH: answers with the last matching rule's output as JSON (or text), and logs each call. */
export function fakeGh(): FakeGh {
	const dir = mkdtempSync(join(tmpdir(), "aw-fake-gh-"));
	const rulesFile = join(dir, "rules.json");
	const logFile = join(dir, "calls.jsonl");
	writeFileSync(rulesFile, "[]");
	const script = `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
const rules = JSON.parse(fs.readFileSync(${JSON.stringify(rulesFile)}, "utf8"));
const fits = (rule) => {
	if (rule.cwd && fs.realpathSync(rule.cwd) !== fs.realpathSync(process.cwd())) return false;
	let at = 0;
	for (const want of rule.args) {
		const found = args.indexOf(want, at);
		if (found < 0) return false;
		at = found + 1;
	}
	return true;
};
const rule = [...rules].reverse().find(fits);
if (!rule) { process.stderr.write("fake gh: no rule for " + args.join(" ") + "\\n"); process.exit(1); }
if (rule.stderr) process.stderr.write(rule.stderr);
if (rule.stdout !== undefined) process.stdout.write(typeof rule.stdout === "string" ? rule.stdout : JSON.stringify(rule.stdout));
process.exit(rule.code || 0);
`;
	writeFileSync(join(dir, "gh"), script);
	chmodSync(join(dir, "gh"), 0o755);
	return {
		dir,
		env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
		rules: (rules) => writeFileSync(rulesFile, JSON.stringify(rules)),
		calls: () =>
			existsSync(logFile)
				? readFileSync(logFile, "utf8")
						.split("\n")
						.filter(Boolean)
						.map((line) => JSON.parse(line))
				: [],
	};
}
