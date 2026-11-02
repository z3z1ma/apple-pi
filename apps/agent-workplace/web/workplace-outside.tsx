import { useEffect, useMemo, useState } from "react";
import type { OutsideItem, OutsideMode, OutsideRead, OutsideSource, WorldSnapshot } from "../src/world.js";
import { Icon } from "./workplace-icon.js";
import "./workplace-outside.css";

const SOURCES: { id: OutsideSource; label: string }[] = [
	{ id: "slack", label: "Slack" },
	{ id: "github", label: "GitHub" },
	{ id: "jira", label: "Jira" },
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
};
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

/** Items about the same PR, issue or Slack thread, newest first, shown once with how many more there are. */
function conversations(items: OutsideItem[]) {
	const groups = new Map<string, OutsideItem[]>();
	for (const item of items) groups.set(item.conversation, [...(groups.get(item.conversation) ?? []), item]);
	return [...groups.values()];
}

/**
 * The operator's outside activity: Slack, GitHub and Jira as the runtime reads them, each conversation's newest item
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
						<label key={item.source}>
							<strong>{SOURCES.find((known) => known.id === item.source)?.label}</strong>
							<select
								aria-label={`${item.source} mode`}
								value={item.mode}
								onChange={(event) => void choose(item.source, event.target.value as OutsideMode)}
							>
								{MODES.map((mode) => (
									<option key={mode.id} value={mode.id}>
										{mode.label}
									</option>
								))}
							</select>
							<span data-error={Boolean(item.error)}>
								{item.error ??
									(item.mode === "off" ? "" : item.polledAt ? `Read ${ago(item.polledAt)} ago` : "Reading\u2026")}
							</span>
						</label>
					))}
				</fieldset>
			)}
			{read?.ok && !followed.length && !choosing ? (
				<p className="wp-outside-note">
					Slack, GitHub and Jira are not followed yet.{" "}
					<button type="button" onClick={() => setChoosing(true)}>
						Choose sources
					</button>
				</p>
			) : (
				<ul className="wp-outside-list">
					{groups.map(([item, ...more]) => (
						<OutsideRow key={item!.conversation} item={item!} more={more.length} />
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

function OutsideRow({ item, more }: { item: OutsideItem; more: number }) {
	return (
		<li data-direct={item.direct} data-source={item.source}>
			<button type="button" disabled={!item.url} onClick={() => item.url && void api.openLink(item.url)}>
				<span className="wp-outside-tile" aria-hidden="true">
					{item.source === "slack" ? "S" : item.source === "github" ? "G" : "J"}
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
