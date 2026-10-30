import type { DatabaseSync } from "node:sqlite";
import {
	type DetailPage,
	type InspectionContext,
	type Interval,
	intervalUnion,
	pageRows,
} from "./inspection-context.js";
import type { RunObservation, RunSnapshot } from "./run-observation.js";

type Association = "mailInitiated" | "mailTail" | "noTypedMail" | "unknown";
interface Recorded {
	seq: number;
	at: number;
	session_id: string;
	generation: number | null;
	source: string;
	type: string;
	data: string | null;
}
interface Span extends Interval {
	emitter: string;
	generation: number | null;
	run: string | null;
	association: Association;
	state: string;
	prompt: boolean;
	evidence: string;
}
interface ObservedState {
	at: number;
	confirmed: number;
	generation: number | null;
	active: boolean;
	connected: boolean;
	instrumented: boolean;
	run: string | null;
	association: Association;
	state: string;
	prompt: boolean;
	evidence: string;
}

function association(snapshot: RunSnapshot): Association {
	if (snapshot.input.kind === "mail") return "mailInitiated";
	if (snapshot.input.kind === "unknown") return "unknown";
	return snapshot.mailReceived ? "mailTail" : "noTypedMail";
}

function withoutGaps(span: Span, gaps: Interval[]): Span[] {
	let pieces = [span];
	for (const gap of gaps)
		pieces = pieces.flatMap((piece) => {
			if (gap.to <= piece.from || gap.from >= piece.to) return [piece];
			return [
				...(piece.from < gap.from ? [{ ...piece, to: gap.from }] : []),
				...(piece.to > gap.to ? [{ ...piece, from: gap.to }] : []),
			];
		});
	return pieces;
}

function transition(state: ObservedState, row: Recorded, data: Record<string, unknown>): RunObservation | undefined {
	if (row.type === "incarnation_started") {
		state.instrumented = false;
		state.generation = row.generation;
		state.run = null;
		state.association = "unknown";
		state.active = false;
		state.connected = true;
	}
	if (row.type === "incarnation_ended") {
		state.active = false;
		state.connected = false;
	}
	if (row.type === "process_state") {
		if (data.to === "alive" && !state.connected) {
			state.connected = true;
			state.association = "unknown";
		}
		if (data.to !== "alive") state.connected = false;
		if (data.to === "exited" || data.to === "lost") state.active = false;
	}
	if (row.type === "run_state") {
		state.state = typeof data.to === "string" ? data.to : "unknown";
		if (!state.instrumented) state.active = data.to !== "idle";
	}
	if (row.type === "prompt_opened") state.prompt = true;
	if (row.type === "prompt_closed") state.prompt = false;
	if (row.type !== "execution") return;
	const observation = data as unknown as RunObservation;
	if (observation.phase === "prepare" || observation.phase === "start" || observation.phase === "resume") {
		state.instrumented = true;
		state.run = observation.id;
		state.active = observation.active;
		state.connected = true;
		state.association = association(observation);
	} else if (observation.phase === "break") state.connected = false;
	else if (observation.id === state.run && observation.phase === "settle") state.active = false;
	else if (
		observation.id === state.run &&
		observation.phase === "input" &&
		observation.input.kind === "mail" &&
		state.association === "noTypedMail"
	)
		state.association = "mailTail";
	return observation;
}

/** Read endpoint evidence after a cutoff too, without allowing a later input to reclassify its prefix. */
function executionSpans(db: DatabaseSync, cutoff: number) {
	const rows = db
		.prepare(`select seq, at, session_id, generation, source, type,
		case when type in ('execution', 'run_state', 'process_state', 'gap') then data else null end as data
		from events where session_id is not null and (source = 'bridge' or type in ('execution', 'process_state', 'gap')) order by seq`)
		.all() as unknown as Recorded[];
	const states = new Map<string, ObservedState>();
	const spans: Span[] = [];
	const gaps = new Map<string, Interval[]>();
	const facts: { emitter: string; at: number; event: string; observation: RunObservation }[] = [];
	const gap = (person: string, from: number, to: number) => {
		const list = gaps.get(person) ?? [];
		list.push({ from, to });
		gaps.set(person, list);
	};
	for (const row of rows) {
		let state = states.get(row.session_id);
		if (state && row.generation !== null && state.generation !== null && row.generation < state.generation) continue;
		state ??= {
			at: row.at,
			confirmed: row.at,
			generation: row.generation,
			active: false,
			connected: true,
			instrumented: false,
			run: null,
			association: "unknown",
			state: "unknown",
			prompt: false,
			evidence: `event:${row.seq}`,
		};
		states.set(row.session_id, state);
		const data = row.data ? JSON.parse(row.data) : {};
		if (row.type === "gap") {
			if (typeof data.since === "number" && typeof data.until === "number") gap(row.session_id, data.since, data.until);
			continue;
		}
		if (row.source === "bridge") state.confirmed = Math.max(state.confirmed, row.at);
		const boundary = [
			"execution",
			"run_state",
			"process_state",
			"prompt_opened",
			"prompt_closed",
			"incarnation_started",
			"incarnation_ended",
		].includes(row.type);
		if (!boundary) continue;
		const at = Math.max(row.at, state.at);
		const observedEnd =
			row.source !== "bridge" && row.type === "process_state" && data.to !== "alive"
				? Math.min(at, state.confirmed)
				: at;
		if (observedEnd < at) gap(row.session_id, observedEnd, at);
		if (state.active && state.connected && observedEnd > state.at)
			spans.push({
				emitter: row.session_id,
				generation: state.generation,
				from: state.at,
				to: observedEnd,
				run: state.run,
				association: state.association,
				state: state.state,
				prompt: state.prompt,
				evidence: state.evidence,
			});
		else if (!state.connected) gap(row.session_id, state.at, at);
		state.at = at;
		state.evidence = `event:${row.seq}`;
		const observation = transition(state, row, data);
		if (observation) facts.push({ emitter: row.session_id, at: row.at, event: `event:${row.seq}`, observation });
	}
	for (const [emitter, state] of states) {
		if (!state.active) continue;
		if (state.connected && state.confirmed > state.at)
			spans.push({
				emitter,
				generation: state.generation,
				from: state.at,
				to: state.confirmed,
				run: state.run,
				association: state.association,
				state: state.state,
				prompt: state.prompt,
				evidence: state.evidence,
			});
		if (state.confirmed < cutoff) gap(emitter, state.confirmed, cutoff);
	}
	return { spans: spans.flatMap((span) => withoutGaps(span, gaps.get(span.emitter) ?? [])), gaps, facts };
}

export function executionIn(db: DatabaseSync, context: InspectionContext, page: DetailPage = {}) {
	if (context.from === undefined || context.scope.task)
		return {
			available: false as const,
			reason: context.scope.task
				? "Run observations do not establish which task received the effort; inspect a person or subtree separately."
				: "Give since to inspect execution intervals.",
		};
	const raw = executionSpans(db, context.to);
	const ownedPieces = (emitter: string, span: Interval) => {
		const person = context.history.accountingPerson(emitter);
		if (!person) return [];
		const from = Math.max(context.from!, span.from),
			to = Math.min(context.to, span.to);
		if (to <= from) return [];
		const cuts = [from, ...context.changes.filter((at) => at > from && at < to), to];
		return cuts
			.slice(0, -1)
			.flatMap((at, i) =>
				context.people(person, at) ? [{ from: at, to: cuts[i + 1], accountedTo: `person:${person}` }] : [],
			);
	};
	const intervals = raw.spans.flatMap((span) =>
		ownedPieces(span.emitter, span).map((piece) => ({
			...span,
			...piece,
			emitter: `person:${span.emitter}`,
			durationMs: piece.to - piece.from,
		})),
	);
	const uncovered = [...raw.gaps].flatMap(([emitter, spans]) =>
		spans.flatMap((span) => ownedPieces(emitter, span).map((piece) => ({ ...piece, emitter: `person:${emitter}` }))),
	);
	const people = [...new Set([...intervals, ...uncovered].map((span) => span.emitter))].sort().map((emitter) => {
		const mine = intervals.filter((span) => span.emitter === emitter);
		const sum = (kind: Association) =>
			mine.filter((span) => span.association === kind).reduce((total, span) => total + span.durationMs, 0);
		return {
			emitter,
			accountedTo: mine[0]?.accountedTo ?? uncovered.find((span) => span.emitter === emitter)!.accountedTo,
			observedMs: mine.reduce((total, span) => total + span.durationMs, 0),
			mailInitiatedMs: sum("mailInitiated"),
			mailTailMs: sum("mailTail"),
			noTypedMailMs: sum("noTypedMail"),
			unknownMs: sum("unknown"),
			unobservedMs: intervalUnion(uncovered.filter((span) => span.emitter === emitter)),
			compactingMs: mine
				.filter((span) => span.state === "compacting")
				.reduce((total, span) => total + span.durationMs, 0),
			operatorPromptMs: mine.filter((span) => span.prompt).reduce((total, span) => total + span.durationMs, 0),
		};
	});
	const sum = (
		field:
			| "observedMs"
			| "mailInitiatedMs"
			| "mailTailMs"
			| "noTypedMailMs"
			| "unknownMs"
			| "unobservedMs"
			| "compactingMs"
			| "operatorPromptMs",
	) => people.reduce((total, person) => total + person[field], 0);
	const facts = raw.facts.filter((fact) => {
		const person = context.history.accountingPerson(fact.emitter);
		return person && fact.at >= context.from! && fact.at < context.to && context.people(person, fact.at);
	});
	return {
		available: true as const,
		summary: {
			observedMs: sum("observedMs"),
			mailInitiatedMs: sum("mailInitiatedMs"),
			mailTailMs: sum("mailTailMs"),
			noTypedMailMs: sum("noTypedMailMs"),
			unknownMs: sum("unknownMs"),
			unobservedMs: sum("unobservedMs"),
			compactingMs: sum("compactingMs"),
			operatorPromptMs: sum("operatorPromptMs"),
			incomingMailAssociatedShare: sum("observedMs")
				? (sum("mailInitiatedMs") + sum("mailTailMs")) / sum("observedMs")
				: null,
			delegatedObservedMs: people
				.filter((person) => person.emitter !== person.accountedTo)
				.reduce((total, person) => total + person.observedMs, 0),
			preparedRuns: facts.filter((fact) => fact.observation.phase === "prepare").length,
			startedRuns: facts.filter((fact) => fact.observation.phase === "start").length,
			abortedRuns: facts.filter((fact) => fact.observation.phase === "settle" && fact.observation.aborted).length,
		},
		emitters: pageRows(people, page),
		intervals: pageRows(intervals, page),
		observations: pageRows(facts, page),
		coverage: [
			"Incoming-mail-associated run time includes provider/tool waits and mixed work, not exclusive communication effort or waste.",
			"No-typed-mail prefixes can contain outgoing correspondence and pull reads. Unknown identity and unobserved gaps are separate.",
			"Endpoint evidence bounds intervals; an unfinished run is counted only through its latest bridge observation. Pre-tracking absence is not zero execution.",
			"Temporary emitters are accounted once through immutable creation ancestry. Delegated time overlaps caller waiting and is included, not additional effort.",
			"Retained typed observations contain identifiers only; private departure cleanup and missing legacy correlation remain authoritative.",
		],
	};
}
