import { useEffect, useMemo, useState } from "react";
import type { OutsideItem, OutsideMode, OutsideRead, OutsideRule, OutsideSource, WorldSnapshot } from "../src/world.js";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import { Select } from "./workplace-fields.js";
import { Icon } from "./workplace-icon.js";
import "./workplace-outside.css";

const SOURCES: { id: OutsideSource; label: string }[] = [
	{ id: "slack", label: "Slack" },
	{ id: "github", label: "GitHub" },
	{ id: "jira", label: "Jira" },
	{ id: "calendar", label: "Calendar" },
	{ id: "gmail", label: "Email" },
];
const MODES: { id: OutsideMode; label: string }[] = [
	{ id: "all", label: "The desk triages everything" },
	{ id: "direct", label: "The desk triages what is addressed to you" },
	{ id: "list", label: "Listed here only" },
	{ id: "off", label: "Not read" },
];
const KINDS: Record<string, string> = {
	review_requested: "Review requested",
	mention: "Mentioned you",
	team_mention: "Mentioned your team",
	group_mention: "Mentioned your group",
	channel_mention: "Channel mention",
	comment: "Comment",
	author: "On your work",
	state_change: "State changed",
	assign: "Assigned to you",
	assigned: "Assigned to you",
	status: "Status changed",
	changed: "Updated",
	reply: "Thread reply",
	reaction: "Reaction",
	bot_dm: "App message",
	dm: "Direct message",
	keyword: "Keyword",
	invite: "Invitation",
	ci_activity: "CI",
	subscribed: "Watching",
	invited: "Invitation",
	cancelled: "Cancelled",
	starting_soon: "Starting soon",
	email: "Email to you",
	cc: "Email, copied",
	notification: "Automated email",
};
const TILES: Record<OutsideSource, string> = { slack: "S", github: "G", jira: "J", calendar: "C", gmail: "E" };
const ACTIONS: Record<string, string> = {
	task: "Task",
	link: "Linked",
	draft: "Drafted",
	answer: "Answered",
	pass: "Passed",
};

const ago = (at: number) => {
	const minutes = Math.round((Date.now() - at) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

const api = window.agentWorkplace;

const EFFECTS: Record<OutsideRule["effect"], string> = {
	hide: "Hidden",
	quiet: "Not triaged",
	triage: "Always triaged",
	route: "Sent to",
};

/** Where a conversation lives, as the runtime's rules name it (`activity.ts` `placeOf`). */
function placeOf(conversation: string): string {
	const github = /^github:([^#:]+)/.exec(conversation);
	if (github) return `github:${github[1]}`;
	const jira = /^jira:([A-Z][A-Z0-9_]*)-/.exec(conversation);
	if (jira) return `jira:${jira[1]}`;
	const slack = /^slack:([^:]+)/.exec(conversation);
	return slack ? `slack:${slack[1]}` : conversation;
}

const placeLabel = (item: OutsideItem) => {
	const place = placeOf(item.conversation);
	if (place.startsWith("github:")) return place.slice(7);
	if (place.startsWith("jira:")) return `Jira ${place.slice(5)}`;
	return item.title.split(":")[0]!;
};

const ruleText = (rule: OutsideRule) =>
	[
		rule.match.source && SOURCES.find((source) => source.id === rule.match.source)?.label,
		rule.match.kind && (KINDS[rule.match.kind] ?? rule.match.kind),
		rule.match.place,
		rule.match.actor && `from ${rule.match.actor}`,
		rule.match.words && `"${rule.match.words}"`,
	]
		.filter(Boolean)
		.join(" \u00b7 ");

/** Items about the same PR, issue or Slack thread, newest first, shown once with how many more there are. */
function conversations(items: OutsideItem[]) {
	const groups = new Map<string, OutsideItem[]>();
	for (const item of items) groups.set(item.conversation, [...(groups.get(item.conversation) ?? []), item]);
	return [...groups.values()];
}

/**
 * The operator's outside activity: Slack, GitHub, Jira, calendar and email as the runtime reads them, each conversation's newest item
 * with the desk's decision, and how each source is followed.
 */
export function OutsideActivity({ world }: { world: WorldSnapshot }) {
	const [source, setSource] = useState<OutsideSource>();
	const [undecided, setUndecided] = useState(false);
	const [read, setRead] = useState<OutsideRead>();
	const [choosing, setChoosing] = useState(false);
	const [changed, setChanged] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: every snapshot and mode change can bring new items or decisions; reading again is one indexed query.
	useEffect(() => {
		let current = true;
		void api.readOutside({ source, untriaged: undecided, limit: 200 }).then((next) => current && setRead(next));
		return () => {
			current = false;
		};
	}, [source, undecided, world, changed]);
	const groups = useMemo(() => (read?.ok ? conversations(read.items) : []), [read]);
	const choose = async (id: OutsideSource, mode: OutsideMode) => {
		await api.setOutsideModes({ [id]: mode });
		setChanged((count) => count + 1);
	};
	if (read && !read.ok) return <p className="wp-outside-note">{read.reason}</p>;
	const followed = read?.ok ? read.sources.filter((item) => item.mode !== "off") : [];
	return (
		<section className="wp-outside" aria-label="Outside activity">
			<header className="wp-outside-head">
				<h2>Outside</h2>
				<fieldset className="wp-outside-filters" aria-label="Source">
					<button type="button" aria-pressed={!source} onClick={() => setSource(undefined)}>
						All
					</button>
					{SOURCES.map((item) => (
						<button
							key={item.id}
							type="button"
							aria-pressed={source === item.id}
							onClick={() => setSource(source === item.id ? undefined : item.id)}
						>
							{item.label}
						</button>
					))}
				</fieldset>
				<label className="wp-outside-undecided">
					<input type="checkbox" checked={undecided} onChange={(event) => setUndecided(event.target.checked)} />
					Undecided only
				</label>
				<button
					type="button"
					className="wp-outside-sources-open"
					aria-expanded={choosing}
					onClick={() => setChoosing(!choosing)}
				>
					Sources
				</button>
			</header>
			{choosing && read?.ok && (
				<fieldset className="wp-outside-sources" aria-label="How each source is followed">
					{read.sources.map((item) => (
						<div key={item.source} className="wp-outside-source">
							<strong>{SOURCES.find((known) => known.id === item.source)?.label}</strong>
							<Select
								label={`${item.source} mode`}
								value={item.mode}
								options={MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
								onChange={(mode) => void choose(item.source, mode)}
							/>
							<span data-error={Boolean(item.error)}>
								{item.error ??
									(item.mode === "off" ? "" : item.polledAt ? `Read ${ago(item.polledAt)} ago` : "Reading\u2026")}
							</span>
						</div>
					))}
					{read.rules.length > 0 && (
						<ul className="wp-outside-rules" aria-label="Rules">
							{read.rules.map((rule) => (
								<li key={rule.id}>
									<strong>
										{EFFECTS[rule.effect]}
										{rule.effect === "route" && rule.person ? ` ${nameOf(world, rule.person)}` : ""}
									</strong>
									<span>{ruleText(rule)}</span>
									<small>
										{rule.note} &middot; {rule.by === "operator" ? "you" : nameOf(world, rule.by)}
									</small>
									<button
										type="button"
										aria-label={`Remove rule: ${rule.note}`}
										onClick={() =>
											void api.setOutsideRule({ remove: rule.id }).then(() => setChanged((count) => count + 1))
										}
									>
										Remove
									</button>
								</li>
							))}
						</ul>
					)}
				</fieldset>
			)}
			{read?.ok && !followed.length && !choosing ? (
				<p className="wp-outside-note">
					No outside source is followed yet.{" "}
					<button type="button" onClick={() => setChoosing(true)}>
						Choose sources
					</button>
				</p>
			) : (
				<ul className="wp-outside-list">
					{groups.map(([item, ...more]) => (
						<OutsideRow
							key={item!.conversation}
							item={item!}
							more={more.length}
							connections={[item!, ...more].flatMap((entry) => (read?.ok ? (read.connections[entry.id] ?? []) : []))}
							changed={() => setChanged((count) => count + 1)}
						/>
					))}
				</ul>
			)}
			{read?.ok && followed.some((item) => item.error) && !choosing && (
				<p className="wp-outside-note" data-error="true">
					{followed
						.filter((item) => item.error)
						.map((item) => item.error)
						.join(" ")}
				</p>
			)}
		</section>
	);
}

function nameOf(world: WorldSnapshot, id: string) {
	return (
		world.characters.find((person) => person.id === id)?.name ??
		world.dormant?.find((person) => person.id === id)?.name ??
		id
	);
}

function OutsideRow({
	item,
	more,
	changed,
	connections,
}: {
	item: OutsideItem;
	more: number;
	changed: () => void;
	connections: { id: string; title: string }[];
}) {
	const openMenu = useWorkplaceMenu();
	const place = placeOf(item.conversation);
	const rule = (match: OutsideRule["match"], effect: OutsideRule["effect"], note: string) => () =>
		void api.setOutsideRule({ match, effect, note }).then(changed);
	const menu = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) =>
		openMenu(event, [
			...(item.url ? [{ label: "Open", onSelect: () => void api.openLink(item.url!) }] : []),
			...(item.actor
				? [
						{
							label: `Hide everything from ${item.actor}`,
							onSelect: rule({ source: item.source, actor: item.actor }, "hide", `You hid ${item.actor}`),
						},
					]
				: []),
			{ label: `Hide ${placeLabel(item)}`, onSelect: rule({ place }, "hide", `You hid ${placeLabel(item)}`) },
			{
				label: `Stop triaging ${(KINDS[item.kind] ?? item.kind).toLowerCase()} in ${placeLabel(item)}`,
				onSelect: rule({ place, kind: item.kind }, "quiet", "You keep these listed only"),
			},
			{
				label: `Always triage ${placeLabel(item)}`,
				onSelect: rule({ place }, "triage", `You want the desk on ${placeLabel(item)}`),
			},
			...(item.rule
				? [
						{
							label: `Remove rule: ${item.rule.note}`,
							onSelect: () => void api.setOutsideRule({ remove: item.rule!.id }).then(changed),
						},
					]
				: []),
		]);
	return (
		<li data-direct={item.direct} data-source={item.source}>
			<button
				type="button"
				aria-haspopup="menu"
				disabled={!item.url}
				onClick={() => item.url && void api.openLink(item.url)}
				onContextMenu={menu}
				onKeyDown={menu}
			>
				<span className="wp-outside-tile" aria-hidden="true">
					{TILES[item.source]}
				</span>
				<span className="wp-activity-body">
					<span className="wp-activity-kind">
						{KINDS[item.kind] ?? item.kind.replace(/_/g, " ")}
						{more > 0 && <span className="wp-outside-more"> &middot; {more} more</span>}
					</span>
					<strong>{item.title}</strong>
					{(item.actor || item.excerpt) && (
						<span className="wp-activity-text">
							{item.actor && <b>{item.actor}</b>}
							{item.actor && item.excerpt ? ": " : ""}
							{item.excerpt}
						</span>
					)}
					{item.rule && item.rule.effect !== "route" && (
						<span className="wp-outside-triage" data-action="rule">
							<b>{EFFECTS[item.rule.effect as OutsideRule["effect"]] ?? item.rule.effect}</b> {item.rule.note}
						</span>
					)}
					{connections.length > 0 && (
						<span className="wp-outside-triage" data-action="connection">
							<Icon name="threads" />
							<b>Connected</b> {[...new Set(connections.map((connection) => connection.title))].join("; ")}
						</span>
					)}
					{item.triage ? (
						<span className="wp-outside-triage" data-action={item.triage.action}>
							<Icon name="desk" />
							<b>{ACTIONS[item.triage.action] ?? item.triage.action}</b> {item.triage.note}
						</span>
					) : (
						item.deliveredAt && (
							<span className="wp-outside-triage" data-action="pending">
								<Icon name="desk" />
								With the desk
							</span>
						)
					)}
				</span>
				<time>{ago(item.at)}</time>
			</button>
		</li>
	);
}
