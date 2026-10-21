// Examining a character: a small card of its observed facts (decision 06): status and time in it, the role it was
// hired into with its soul and the headings of its self, its ledger tasks, where it works, who it reports to, its
// tool, model, context, cost, and tmux pane. Nothing here is inferred.
import type { Character, WorldSnapshot } from "../../../src/world.js";
import { CloseIcon } from "./icons.js";
import { activity, ago, attentionOf, placeName } from "./model.js";
import { ActionButtons, type CharacterAction, Pip } from "./rows.js";

const STATUS = { asking: "Asking you", finished: "Finished, unseen", working: "Working", idle: "Idle" };

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** The card's facts, as term and value rows, in reading order. */
function factRows(character: Character, world: WorldSnapshot | undefined): [string, string][] {
	const facts = character.facts;
	if (!facts) return [];
	const attention = attentionOf(character);
	const boss = facts.reportsTo ? world?.characters.find((c) => c.id === facts.reportsTo)?.name : undefined;
	const rows: [string, string][] = [];
	const doing = activity(character);
	if (doing && doing !== STATUS[attention]) rows.push(["Doing", doing]);
	if (facts.title) rows.push(["Role", facts.title]);
	if (facts.soul) rows.push(["Soul", facts.soul]);
	if (facts.selfHeadings?.length) rows.push(["Self", facts.selfHeadings.join(" \u00b7 ")]);
	if (facts.task)
		rows.push(["Ledger task", facts.task.status ? `${facts.task.title} (${facts.task.status})` : facts.task.title]);
	else if (facts.intent) rows.push(["Working on", facts.intent]);
	const record = (facts.tasks ?? []).filter((id) => id !== facts.task?.bundle.split("/").pop());
	if (record.length) rows.push(["Record", record.join(", ")]);
	if (facts.git) {
		rows.push(["Repository", base(facts.git.repository)]);
		if (facts.git.branch) rows.push(["Branch", facts.git.branch]);
		if (facts.git.worktree && facts.git.worktree !== facts.git.repository) rows.push(["Worktree", facts.git.worktree]);
	}
	rows.push(["Directory", facts.cwd]);
	if (facts.reportsTo) rows.push(["Reports to", boss ?? facts.reportsTo]);
	if (facts.model) rows.push(["Model", facts.model]);
	if (facts.contextTokens !== null)
		rows.push([
			"Context",
			facts.contextWindow
				? `${tokens(facts.contextTokens)} of ${tokens(facts.contextWindow)} (${Math.round((100 * facts.contextTokens) / facts.contextWindow)}%)`
				: tokens(facts.contextTokens),
		]);
	rows.push(["Cost", `$${facts.cost.toFixed(2)}`]);
	if (facts.tmux)
		rows.push([
			"Terminal",
			facts.tmux.session !== null && facts.tmux.window !== null
				? `${facts.tmux.session}:${facts.tmux.window} (${facts.tmux.pane})`
				: facts.tmux.pane,
		]);
	return rows;
}

export function CharacterCard({
	character,
	world,
	labels,
	act,
	onClose,
}: {
	character: Character;
	world: WorldSnapshot | undefined;
	labels: Record<string, string> | undefined;
	act: (action: CharacterAction, character: Character) => void;
	onClose: () => void;
}) {
	const facts = character.facts;
	const attention = attentionOf(character);
	const since =
		attention === "asking" || attention === "finished"
			? facts?.needsYouSince
			: attention === "working"
				? facts?.tool?.since
				: facts?.settledAt;
	const rows = factRows(character, world);
	const time = ago(since);
	return (
		<div className="aw-frame aw-card" role="dialog" aria-label={`Examine ${character.name}`}>
			<header className="aw-card-head">
				<div>
					<h2>{character.name}</h2>
					<p>
						{labels?.[character.role] ?? character.role} &middot; {placeName(character.place, world, labels)}
					</p>
				</div>
				<button type="button" className="aw-fold" aria-label="Close" onClick={onClose}>
					<CloseIcon />
				</button>
			</header>
			<div className="aw-card-body aw-surface">
				<p className={`aw-card-status aw-row-${attention}`}>
					<Pip attention={attention} />
					<span>{STATUS[attention]}</span>
					{time && <span className="aw-row-time">{time === "now" ? "just now" : `for ${time}`}</span>}
				</p>
				{facts?.asking?.text && <blockquote>{facts.asking.text}</blockquote>}
				<dl>
					{rows.map(([term, value]) => (
						<div key={term}>
							<dt>{term}</dt>
							<dd title={value}>{value}</dd>
						</div>
					))}
				</dl>
				<ActionButtons character={character} act={act} skip="examine" />
			</div>
		</div>
	);
}
