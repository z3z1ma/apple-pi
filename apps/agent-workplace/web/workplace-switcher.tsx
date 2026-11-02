import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage } from "../src/communications.js";
import type { ConversationHit, WorldSnapshot } from "../src/world.js";
import { Icon } from "./workplace-icon.js";
import { channelName } from "./workplace-names.js";
import { PersonAvatar } from "./workplace-people.js";

export type SwitchTarget =
	| { kind: "view"; view: "desk" | "threads" | "activity" | "later" | "notes" | "canvases" }
	/** `entry`: a message in the DM to scroll to. */
	| { kind: "dm"; id: string; entry?: string }
	| { kind: "channel"; id: string }
	| { kind: "thread"; id: string; title: string };

export type Item = {
	key: string;
	label: string;
	detail: string;
	target: SwitchTarget;
	person?: string;
	icon?: "desk" | "threads" | "bell" | "bookmark" | "file" | "compose";
	/** Already matched by a search, so the typed words need not appear in its label. */
	found?: boolean;
};

function items(world: WorldSnapshot): Item[] {
	const views: Item[] = [
		{
			key: "v:desk",
			label: "Desk",
			detail: "Talk to the organization",
			target: { kind: "view", view: "desk" },
			icon: "desk",
		},
		{
			key: "v:threads",
			label: "Threads",
			detail: "Every task conversation",
			target: { kind: "view", view: "threads" },
			icon: "threads",
		},
		{
			key: "v:activity",
			label: "Activity",
			detail: "What needs you",
			target: { kind: "view", view: "activity" },
			icon: "bell",
		},
		{
			key: "v:later",
			label: "Later",
			detail: "Messages you saved",
			target: { kind: "view", view: "later" },
			icon: "bookmark",
		},
		{
			key: "v:canvases",
			label: "Canvases",
			detail: "Your own pages",
			target: { kind: "view", view: "canvases" },
			icon: "compose",
		},
		{
			key: "v:notes",
			label: "Notes",
			detail: "What the organization learned",
			target: { kind: "view", view: "notes" },
			icon: "file",
		},
	];
	const people: Item[] = [
		...world.characters
			.filter((person) => !person.facts?.temporary)
			.map((person) => ({
				key: `p:${person.id}`,
				label: person.name,
				detail: person.facts?.task?.title ?? person.facts?.title ?? "Direct message",
				target: { kind: "dm" as const, id: person.id },
				person: person.id,
			})),
		...(world.dormant ?? [])
			.filter((person) => !person.retiredAt && !person.temporary)
			.map((person) => ({
				key: `p:${person.id}`,
				label: person.name,
				detail: `Away${person.title ? ` \u00b7 ${person.title}` : ""}`,
				target: { kind: "dm" as const, id: person.id },
				person: person.id,
			})),
	];
	const channels: Item[] = (world.workplace?.threads ?? [])
		.filter((thread) => thread.kind === "channel" && thread.id !== world.desk?.thread)
		.map((thread) => ({
			key: `c:${thread.id}`,
			label: `# ${channelName(thread.id, thread.subject, world)}`,
			detail: "Channel",
			target: { kind: "channel" as const, id: thread.id },
		}));
	const threads: Item[] = (world.workplace?.tasks ?? [])
		.filter((task) => task.thread)
		.map((task) => ({
			key: `t:${task.thread}`,
			label: task.title,
			detail: task.assignees.length ? "Thread \u00b7 in flight" : "Thread",
			target: { kind: "thread" as const, id: task.thread!, title: task.title },
			icon: "threads" as const,
		}));
	return [...views, ...people, ...channels, ...threads];
}

/** Where a message can be sent: people, the desk, channels and task threads. */
export function destinations(world: WorldSnapshot): Item[] {
	const desk = world.desk?.thread;
	return [
		...(desk
			? [
					{
						key: `c:${desk}`,
						label: "Desk",
						detail: "The organization",
						target: { kind: "channel" as const, id: desk },
						icon: "desk" as const,
					},
				]
			: []),
		...items(world).filter((item) => item.target.kind !== "view"),
	];
}

/** Slack's quick switcher: Command or Control + K jumps to any person, channel, thread or view. */
export function QuickSwitcher({
	world,
	active,
	go,
}: {
	world: WorldSnapshot;
	active: boolean;
	go: (target: SwitchTarget) => void;
}) {
	const [open, setOpen] = useState(false);
	const returnFocus = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!active) return;
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
				event.preventDefault();
				returnFocus.current = document.activeElement as HTMLElement | null;
				setOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active]);
	useEffect(() => {
		const onOpen = () => {
			returnFocus.current = document.activeElement as HTMLElement | null;
			setOpen(true);
		};
		window.addEventListener("workplace-switcher", onOpen);
		return () => window.removeEventListener("workplace-switcher", onOpen);
	}, []);
	if (!open || !active) return null;
	return (
		<JumpPicker
			world={world}
			close={() => {
				setOpen(false);
				if (returnFocus.current?.isConnected) returnFocus.current.focus();
			}}
			choose={(target) => {
				setOpen(false);
				go(target);
			}}
		/>
	);
}

/** Names first, then messages that mention the words, from every channel and thread the operator can read. */
function JumpPicker({
	world,
	close,
	choose,
}: {
	world: WorldSnapshot;
	close: () => void;
	choose: (target: SwitchTarget) => void;
}) {
	const all = useMemo(() => items(world), [world]);
	const [query, setQuery] = useState("");
	const [found, setFound] = useState<Item[]>([]);
	useEffect(() => {
		const words = query.trim();
		if (words.length < 3) {
			setFound([]);
			return;
		}
		let current = true;
		const timer = setTimeout(() => {
			const api = window.agentWorkplace;
			void Promise.all([
				api.communications
					.searchMessages({ query: words, limit: 20 })
					.then((result) =>
						result.ok
							? result.value.messages.map((message) => ({ at: message.at, item: messageItem(world, message) }))
							: [],
					)
					.catch(() => []),
				api
					.searchConversations(words)
					.then((result) => (result.ok ? result.hits.map((hit) => ({ at: hit.at, item: dmItem(world, hit) })) : []))
					.catch(() => []),
			]).then(([messages, dms]) => {
				if (current) setFound([...messages, ...dms].sort((a, b) => b.at - a.at).map((hit) => hit.item));
			});
		}, 250);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [query, world]);
	return (
		<Picker
			label="Jump to"
			placeholder="Jump to a person, channel, thread or view, or search messages"
			items={[...all, ...found]}
			close={close}
			choose={(item) => choose(item.target)}
			onQuery={setQuery}
		/>
	);
}

/** A message found by search, opening its conversation. */
const when = (at: number) =>
	new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function dmItem(world: WorldSnapshot, hit: ConversationHit): Item {
	const nameOf = (id: string) =>
		world.characters.find((person) => person.id === id)?.name ??
		world.dormant?.find((person) => person.id === id)?.name ??
		id;
	return {
		key: `d:${hit.session}:${hit.entry}`,
		label: `${hit.speaker === "operator" ? "You" : nameOf(hit.speaker)}: ${hit.text}`,
		detail: `Message \u00b7 DM with ${nameOf(hit.session)} \u00b7 ${when(hit.at)}`,
		target: { kind: "dm", id: hit.session, entry: hit.entry },
		person: hit.speaker === "operator" ? undefined : hit.speaker,
		found: true,
	};
}

function messageItem(world: WorldSnapshot, message: ConversationMessage): Item {
	const thread = world.workplace?.threads.find((item) => item.id === message.thread);
	const task =
		world.workplace?.tasks.find((item) => item.thread === message.thread) ??
		world.workplace?.workHistory?.find((item) => item.thread === message.thread);
	const place =
		message.thread === world.desk?.thread
			? "Desk"
			: thread
				? `# ${channelName(thread.id, thread.subject, world)}`
				: (task?.title ?? "Conversation");
	return {
		key: `m:${message.id}`,
		label: `${message.fromName}: ${message.body.replace(/\s+/g, " ").trim()}`,
		detail: `Message \u00b7 ${place} \u00b7 ${when(message.at)}`,
		target: thread
			? { kind: "channel", id: thread.id }
			: { kind: "thread", id: message.thread, title: task?.title ?? "Conversation" },
		person: message.from === "operator" || message.from === "harness" ? undefined : message.from,
		icon: "threads",
		found: true,
	};
}

/** A modal list filtered as the operator types; arrows move, Enter chooses, Escape closes. */
export function Picker({
	label,
	placeholder,
	items: all,
	close,
	choose,
	children,
	chips,
	finish,
	unchip,
	footer,
	onQuery,
}: {
	label: string;
	placeholder: string;
	items: Item[];
	close: () => void;
	choose: (item: Item) => void;
	children?: ReactNode;
	/** Destinations already chosen, shown in the field before the query. */
	chips?: ReactNode;
	/** Enter with nothing typed. */
	finish?: () => void;
	/** Backspace with nothing typed. */
	unchip?: () => void;
	footer?: ReactNode;
	/** Told each change of the typed words. */
	onQuery?: (query: string) => void;
}) {
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (!dialog.current?.open) dialog.current?.showModal();
		input.current?.focus();
	}, []);
	const needle = query.trim().toLowerCase();
	const shown = needle
		? all.filter((item) => item.found || `${item.label} ${item.detail}`.toLowerCase().includes(needle))
		: all;
	const pick = (item: Item | undefined) => {
		if (item) choose(item);
	};
	return (
		<dialog
			ref={dialog}
			className="wp-switcher"
			aria-label={label}
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
		>
			{children}
			<label className="wp-switcher-input">
				<Icon name="search" />
				{chips}
				<input
					ref={input}
					aria-label={placeholder}
					placeholder={placeholder}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setIndex(0);
						onQuery?.(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown") {
							event.preventDefault();
							setIndex((current) => Math.min(current + 1, shown.length - 1));
						} else if (event.key === "ArrowUp") {
							event.preventDefault();
							setIndex((current) => Math.max(current - 1, 0));
						} else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
							event.preventDefault();
							if (finish && (event.metaKey || event.ctrlKey || !query.trim())) finish();
							else {
								pick(shown[index]);
								if (finish) setQuery("");
							}
						} else if (event.key === "Backspace" && !query && unchip) {
							event.preventDefault();
							unchip();
						}
					}}
				/>
				<kbd>esc</kbd>
			</label>
			<ul aria-label="Destinations">
				{shown.map((item, position) => (
					<li key={item.key} data-active={position === index}>
						<button
							type="button"
							tabIndex={-1}
							aria-current={position === index}
							ref={(node) => {
								if (position === index) node?.scrollIntoView({ block: "nearest" });
							}}
							onMouseEnter={() => setIndex(position)}
							onClick={() => {
								pick(item);
								if (finish) {
									setQuery("");
									input.current?.focus();
								}
							}}
						>
							{item.person ? (
								<PersonAvatar id={item.person} name={item.label} interactive={false} />
							) : (
								<span className="wp-switcher-glyph">{item.icon ? <Icon name={item.icon} /> : "#"}</span>
							)}
							<span>
								<strong>{item.label}</strong>
								<small>{item.detail}</small>
							</span>
						</button>
					</li>
				))}
				{!shown.length && <li className="wp-switcher-empty">Nothing matches.</li>}
			</ul>
			{footer}
		</dialog>
	);
}
