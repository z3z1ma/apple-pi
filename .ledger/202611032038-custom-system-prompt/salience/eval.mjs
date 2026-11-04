import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const here = dirname(fileURLToPath(import.meta.url));
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["openai/gpt-6.1-sol"];
const variants = ["baseline", "frame"];

const cases = [
	[
		"remind_me",
		"Nothing to do until the deploy finishes in about 20 minutes. Make sure you come back to check it then.",
	],
	["monitor", "Keep the dev server running and react to every new error line it logs, as each one appears."],
	[
		"explore",
		"How are session titles generated across this repository? I want the answer without the reading filling up your context.",
	],
	[
		["research", "google_search"],
		"What changed about ESM loader hooks in the latest stable Node release? Use official sources.",
	],
	[
		"pi_exec",
		"Run the same three git commands in each of the 40 repositories under ~/code and tell me only which ones have uncommitted changes.",
	],
	[
		"search_branches",
		"There are three plausible ways to speed up the config parser. Try all three and keep whichever is fastest on the benchmark while the tests still pass.",
	],
	["review_code", "Before this merges, I want independent reviewers to look over the commit you just made."],
	[
		["tlc_check", "tla_symbolic_check"],
		"Two workers can claim the same job under some interleaving. Show that the new locking protocol is correct for every ordering of events, not just the ones our tests hit.",
	],
	[
		"update_notebook",
		"That test passed on the old code too, which surprised you. Make sure what it taught you is not lost.",
	],
	[
		"search_session",
		"What did we decide about the cache key format earlier in this session, before the context was compacted?",
	],
	["notes", "Before you dig into the billing service, check what the organization already knows about it."],
	[
		"link",
		"Record that commit 3f9a2c1 verified the fix for the flaky-upload task, so the relationship outlives this conversation.",
	],
	["take_task", "New goal from me: migrate the config loader to the new schema."],
	[
		["ledger_add", "promote_task"],
		"This migration will take several days, and someone else may need to resume it. Give it a durable home.",
	],
	[
		["send_mail", "directory"],
		"Ask Fiona, who owns the recall index, whether changing the tokenizer breaks her contracts.",
	],
	["post", "Share the release notes in the team channel and make sure Deniz in particular sees them."],
	["escalate", "This change needs a spending decision that is beyond your authority."],
	[
		["experience", "hire"],
		"Nobody on the team has a security perspective, and we need one on this new trust boundary.",
	],
	[["call_in", "assign"], "Hye-jin is at home but has the context for this migration. Get her working on it."],
	[["bottlenecks", "progress"], "Work seems stalled across the team. Find out what everything is waiting on."],
	[
		"ask_user_question",
		"You cannot continue until I choose between Postgres and SQLite for the cache. Get my decision.",
	],
	[
		["sign_off_document", "sign_off_task"],
		"The specification you just wrote needs my approval, with my comments on specific passages, before you build anything.",
	],
	["explain_change", "Walk me through the change you just made so I understand it well enough to build on it."],
	[
		"schedule_mail",
		"Every Monday at 9am, remind the team to update their task files, even if this session restarts in between.",
	],
	[
		["activity", "triage"],
		"Go through what happened around me today on Slack and GitHub, and record what you did with each item.",
	],
	[
		"follow_external",
		"You are now responsible for pull request #123. Make sure its new comments and CI failures reach you.",
	],
	[
		"channel_charter",
		"Set it up so that someone always reproduces bugs posted in the bugs channel and replies only with confirmed fixes.",
	],
	["communication_status", "Your last message to Fiona timed out, and you do not know whether it was delivered."],
	["canvas", "Make me a meeting brief for tomorrow that I can keep editing myself."],
	[
		"context_lint",
		"You just renamed components/foo/src/bar.ts, which has a context file. Check that nothing is now broken.",
	],
];

const goals = [
	[
		"Fix the flaky upload test in components/upload; it fails about one run in ten.",
		["take_task", ["notes", "wiki_references", "search_session", "explore"], "review_code", "link", "finish_task"],
	],
	[
		"Add retry with exponential backoff to the webhook sender. Two other teams' services depend on its timing.",
		[
			"take_task",
			["notes", "wiki_references", "explore"],
			["send_mail", "post", "directory"],
			"review_code",
			"finish_task",
		],
	],
	[
		"Design how we would move the job queue from Redis to Postgres. I will make the decision.",
		["take_task", ["research", "explore", "notes"], ["sign_off_document", "sign_off_task"], "finish_task"],
	],
	[
		"CI got about 40% slower this week across our 12 repositories. Find out why.",
		["take_task", "pi_exec", ["notes", "search_messages"], ["note", "update_notebook"], "finish_task"],
	],
	[
		"Rename the `retire` concept to `let_go` across the code and the docs.",
		["take_task", "explore", "context_lint", "review_code", "finish_task"],
	],
	[
		"Two consumers of the outbox can both deliver the same message after a crash. Fix it.",
		["take_task", ["tlc_check", "tla_symbolic_check"], "review_code", "link", "finish_task"],
	],
	[
		"This quarter's migration spans four teams and keeps failing at the hand-offs. Get it delivered.",
		[
			"take_task",
			["experience", "directory"],
			["assign", "hire", "call_in"],
			["bottlenecks", "progress"],
			["post", "send_mail", "create_channel"],
		],
	],
	[
		"Speed up the search index build; it takes 9 minutes and blocks every release.",
		["take_task", ["search_branches", "pi_exec"], "review_code", ["update_notebook", "note"], "finish_task"],
	],
];

const pickInstruction =
	"\n\n(Evaluation: do not start the work. Reply with JSON only, no tool calls: " +
	'{"tools": [the tool names you would call, in order, up to five], "why": "one sentence"}.)';
const planInstruction =
	"\n\n(Evaluation: do not start the work. Reply with JSON only, no tool calls: " +
	'{"tools": [every tool you would call from start to finish, in order, repeats allowed], "why": "one sentence"}.)';

const scratch = mkdtempSync(join(tmpdir(), "salience-"));
const runtime = await ModelRuntime.create({
	authPath: join(homedir(), ".pi/agent/auth.json"),
	modelsPath: join(homedir(), ".pi/agent/models.json"),
	modelsStorePath: join(scratch, "models.json"),
});

function surface(variant) {
	const payload = JSON.parse(readFileSync(join(here, `${variant}-anthropic.json`), "utf8"));
	return {
		systemPrompt: payload.system.at(-1).text,
		tools: payload.tools
			.filter((tool) => !tool.defer_loading)
			.map((tool) => ({
				name: ["Read", "Bash", "Edit", "Write", "Task"].includes(tool.name) ? tool.name.toLowerCase() : tool.name,
				description: tool.description,
				parameters: tool.input_schema,
			})),
	};
}

const bare = (name) =>
	String(name)
		.replace(/^functions\./, "")
		.replace(/^(Read|Bash|Edit|Write|Task)$/, (core) => core.toLowerCase());

function plannedTools(message) {
	return rawTools(message).map(bare);
}

function rawTools(message) {
	const calls = message.content.filter((part) => part.type === "toolCall").map((part) => part.name);
	if (calls.length) return calls;
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	try {
		return JSON.parse(json).tools ?? [];
	} catch {
		return [];
	}
}

const resultsFile = join(here, "results.json");
const results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : {};
for (const id of models) {
	const [provider, modelId] = id.split("/");
	const model = runtime.getModel(provider, modelId);
	if (!model) throw new Error(`Model ${id} is not available`);
	for (const variant of variants) {
		const { systemPrompt, tools } = surface(variant);
		const key = `${id} ${variant}`;
		const ask = (content) =>
			runtime.completeSimple(
				model,
				{ systemPrompt, tools, messages: [{ role: "user", content, timestamp: Date.now() }] },
				{ reasoning: "low" },
			);
		const rows = [];
		let cost = 0;
		for (const [expected, request] of cases) {
			const accepted = [expected].flat();
			const message = await ask(request + pickInstruction);
			const planned = plannedTools(message);
			const hit = planned.some((name) => accepted.includes(name));
			const first = accepted.includes(planned[0]);
			cost += message.usage?.cost?.total ?? 0;
			rows.push({ expected: accepted, planned, hit, first, error: message.errorMessage });
			console.log(`${key} ${hit ? "HIT " : "MISS"} ${accepted.join("|")} <- ${planned.join(", ")}`);
		}
		const plans = [];
		for (const [goal, practices] of goals) {
			const message = await ask(goal + planInstruction);
			const planned = plannedTools(message);
			const met = practices.filter((practice) => [practice].flat().some((name) => planned.includes(name)));
			cost += message.usage?.cost?.total ?? 0;
			plans.push({ goal, planned, met: met.length, of: practices.length, error: message.errorMessage });
			console.log(`${key} PLAN ${met.length}/${practices.length} <- ${planned.join(", ")}`);
		}
		results[key] = {
			hits: rows.filter((row) => row.hit).length,
			first: rows.filter((row) => row.first).length,
			cases: rows.length,
			practices: plans.reduce((sum, plan) => sum + plan.met, 0),
			of: plans.reduce((sum, plan) => sum + plan.of, 0),
			cost,
			rows,
			plans,
		};
		writeFileSync(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
	}
}
for (const [key, value] of Object.entries(results))
	console.log(
		`${key}: picks ${value.hits}/${value.cases}, first ${value.first}/${value.cases}, plan practices ${value.practices}/${value.of}, $${value.cost.toFixed(2)}`,
	);
rmSync(scratch, { force: true, recursive: true });
