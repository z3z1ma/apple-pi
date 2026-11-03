#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { COMMENTED_SOURCE, sourceComments } from "../components/repo-rules/src/comments.ts";

const SKIP = /(^|\/)(dist|node_modules|\.ledger)\//;

const files = execFileSync("git", ["ls-files", "-z", ...process.argv.slice(2)], { encoding: "utf8" })
	.split("\0")
	.filter((file) => file && COMMENTED_SOURCE.test(file) && !SKIP.test(file));
let count = 0;
for (const file of files)
	for (const comment of sourceComments(file, readFileSync(file, "utf8"))) {
		count++;
		console.log(`${file}:${comment.line}: ${comment.text.split("\n")[0].slice(0, 100)}`);
	}
if (count) {
	console.log(`\n${count} comments. Move the rationale to a name, a test, or .context/<path>.md (see lint/README.md).`);
	process.exit(1);
}
