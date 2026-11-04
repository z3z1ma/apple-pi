import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { managesPeople } from "../../organization/src/install.js";
import { loadRoles } from "../../organization/src/roles.js";
import { resolvePerson } from "../../session-state/src/addresses.js";
import { statePaths } from "../../session-state/src/paths.js";
import { openPeerProgram, type PeerProgram } from "../../session-state/src/program-client.js";
import { normalizeOutputSchema } from "../../shared/src/structured-output.js";

const turn = {
	task: Type.String({ minLength: 1, description: "What the person should do, with what done looks like." }),
	context: Type.Optional(
		Type.Unknown({ description: "JSON the person reads from a file beside their task, instead of in the task text." }),
	),
	outputSchema: Type.Optional(
		Type.Unknown({ description: "JSON Schema of the value the person returns; their answer is validated against it." }),
	),
};

const result = Type.Object({
	status: Type.String(),
	text: Type.String(),
	value: Type.Optional(Type.Unknown()),
	error: Type.Optional(Type.String()),
	toolCalls: Type.Integer(),
});

interface TurnArgs {
	task: string;
	context?: unknown;
	outputSchema?: unknown;
}

function writeContext(person: string, value: unknown): string {
	const db = new DatabaseSync(statePaths().db, { readOnly: true });
	let bundle: string | undefined;
	try {
		bundle = (
			db
				.prepare("select t.bundle from work_tasks t join work_focus f on f.task_id = t.id where f.person = ?")
				.get(person) as { bundle: string } | undefined
		)?.bundle;
	} finally {
		db.close();
	}
	if (!bundle) throw new Error("The person has no focused task to hold the context");
	const path = join(bundle, `context-${randomUUID()}.json`);
	writeFileSync(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
	return path;
}

async function runTurn(program: PeerProgram, person: string, args: TurnArgs, signal?: AbortSignal) {
	const outputSchema = args.outputSchema === undefined ? undefined : normalizeOutputSchema(args.outputSchema);
	const contextFile = args.context === undefined ? undefined : writeContext(person, args.context);
	const receipt = await program.command(
		person,
		{
			kind: "run_turn",
			task: args.task,
			...(outputSchema ? { outputSchema } : {}),
			...(contextFile ? { contextFile } : {}),
		},
		{ signal },
	);
	if (!receipt.result) throw new Error(receipt.reason ?? "The person returned no result");
	const { operations, changes: _changes, stopReason: _stop, usage: _usage, ...answer } = receipt.result;
	const structuredContent = JSON.parse(JSON.stringify({ ...answer, toolCalls: operations.length }));
	return {
		content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
		structuredContent,
		details: structuredContent,
	};
}

type PeerContext = Pick<ExtensionToolContext, "cwd" | "sessionManager">;

function caller(ctx: PeerContext): string {
	if (!managesPeople(ctx as ExtensionToolContext))
		throw new Error("Peer turns need a managing role or an unroled organization root");
	return ctx.sessionManager.getSessionId();
}

export async function runAgent(ctx: PeerContext, args: TurnArgs & { role: string }, signal?: AbortSignal) {
	const self = caller(ctx);
	if (!loadRoles(ctx.cwd).roles.has(args.role)) throw new Error(`Unknown role: ${args.role}`);
	const person = randomUUID();
	const program = await openPeerProgram(self, signal);
	try {
		const started = await program.command(
			person,
			{ kind: "start", role: args.role, goal: { by: self, text: args.task } },
			{ signal },
		);
		if (started.stage !== "applied") throw new Error(started.reason ?? "The peer could not start");
		return await runTurn(program, person, args, signal);
	} finally {
		await program.close();
	}
}

export async function runColleague(ctx: PeerContext, args: TurnArgs & { person: string }, signal?: AbortSignal) {
	const self = caller(ctx);
	const person = resolvePerson(self, args.person);
	if (person === self) throw new Error("Ask another colleague; a session cannot give itself a turn");
	const program = await openPeerProgram(self, signal);
	try {
		return await runTurn(program, person, args, signal);
	} finally {
		await program.close();
	}
}

export function installPeerTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "temporary_peer",
		label: "temporary peer",
		exposure: "codemode",
		description:
			"Give one task to a temporary peer in a catalog role, wait for its answer, and discard the peer (its transcript stays). Managing roles and unroled organization roots only.",
		parameters: Type.Object({ role: Type.String({ minLength: 1, description: "Catalog role name." }), ...turn }),
		outputSchema: result,
		execute: (_id, args, signal, _update, ctx) => runAgent(ctx, args, signal),
	});
	pi.registerTool({
		name: "colleague",
		label: "colleague",
		exposure: "codemode",
		description:
			"Give one task to an awake colleague as a turn in their own session, and wait for their answer. The colleague stays as they are. Managing roles and unroled organization roots only.",
		parameters: Type.Object({ person: Type.String({ minLength: 1, description: "A name or session id." }), ...turn }),
		outputSchema: result,
		execute: (_id, args, signal, _update, ctx) => runColleague(ctx, args, signal),
	});
}
