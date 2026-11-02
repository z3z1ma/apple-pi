import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { WorldSnapshot } from "../src/world.js";
import { Icon } from "./workplace-icon.js";
import { channelName } from "./workplace-names.js";
import { PersonAvatar } from "./workplace-people.js";

export type SwitchTarget =
	| { kind: "view"; view: "desk" | "threads" | "activity" }
	| { kind: "dm"; id: string }
	| { kind: "channel"; id: string }
	| { kind: "thread"; id: string; title: string };

export type Item = {
	key: string;
	label: string;
	detail: string;
	target: SwitchTarget;
	person?: string;
	icon?: "desk" | "threads" | "bell";
};

function items(world: WorldSnapshot): Item[] {
	const views: Item[] = [
		{
			key: "v:desk",
			label: "Front desk",
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

/** Where a message can be sent: people, the front desk, channels and task threads. */
export function destinations(world: WorldSnapshot): Item[] {
	const desk = world.desk?.thread;
	return [
		...(desk
			? [
					{
						key: `c:${desk}`,
						label: "Front desk",
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
	const all = useMemo(() => items(world), [world]);
	if (!open || !active) return null;
	return (
		<Picker
			label="Jump to"
			placeholder="Jump to a person, channel, thread or view"
			items={all}
			close={() => {
				setOpen(false);
				if (returnFocus.current?.isConnected) returnFocus.current.focus();
			}}
			choose={(item) => {
				setOpen(false);
				go(item.target);
			}}
		/>
	);
}

/** A modal list filtered as the operator types; arrows move, Enter chooses, Escape closes. */
export function Picker({
	label,
	placeholder,
	items: all,
	close,
	choose,
	children,
}: {
	label: string;
	placeholder: string;
	items: Item[];
	close: () => void;
	choose: (item: Item) => void;
	children?: ReactNode;
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
	const shown = needle ? all.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(needle)) : all;
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
				<input
					ref={input}
					aria-label={placeholder}
					placeholder={placeholder}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setIndex(0);
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
							pick(shown[index]);
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
							onClick={() => pick(item)}
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
		</dialog>
	);
}
