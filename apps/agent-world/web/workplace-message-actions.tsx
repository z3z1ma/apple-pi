import {
	createContext,
	type HTMLAttributes,
	type MouseEvent,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { WorldSnapshot } from "../src/world.js";
import { conversationPanel } from "./overlay/conversation/panel-state.js";
import { type QuotedMessage, quote } from "./overlay/conversation/quote.js";
import { Markdown } from "./overlay/conversation/transcript.js";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import { Icon } from "./workplace-icon.js";
import { destinations, type Item, Picker, type SwitchTarget } from "./workplace-switcher.js";
import "./workplace-message-actions.css";

export type { QuotedMessage };
export type MessageAction = { label: string; onSelect: () => void };

/** The text selected inside `element`, when the selection lies wholly within it. */
function selectionIn(element: HTMLElement | null): string | undefined {
	const selection = window.getSelection();
	if (!element || !selection || selection.isCollapsed) return undefined;
	if (!element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return undefined;
	return selection.toString().trim() || undefined;
}

const ForwardContext = createContext<{
	forward: (message: QuotedMessage) => void;
	/** Hand the message to the front desk to deal with, when there is a desk. */
	handOff?: (message: QuotedMessage) => void;
} | null>(null);

/**
 * A message with Slack's actions: a toolbar on hover or focus and the same items on right-click. Reply and Forward
 * act on the selected part of the message when the operator selected some, and on the whole message otherwise.
 */
export function ActionableMessage({
	message,
	onReply,
	extra = [],
	className,
	children,
	...rest
}: {
	message: QuotedMessage;
	onReply?: (message: QuotedMessage) => void;
	extra?: MessageAction[];
	className: string;
	children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
	const openMenu = useWorkplaceMenu();
	const sending = useContext(ForwardContext);
	const forward = sending?.forward;
	const handOff = sending?.handOff;
	const element = useRef<HTMLElement>(null);
	const chosen = () => {
		const part = selectionIn(element.current);
		return part ? { ...message, text: part } : message;
	};
	const items = (): MessageAction[] => {
		const target = chosen();
		return [
			...(onReply ? [{ label: "Reply", onSelect: () => onReply(target) }] : []),
			...(forward ? [{ label: "Forward\u2026", onSelect: () => forward(target) }] : []),
			...(handOff ? [{ label: "Ask the front desk to handle", onSelect: () => handOff(target) }] : []),
			{
				label: target === message ? "Copy text" : "Copy selection",
				onSelect: () => void navigator.clipboard.writeText(target.text),
			},
			...extra,
		];
	};
	const menu = (event: MouseEvent<HTMLElement>) => {
		if ((event.target as HTMLElement).closest("a[href], input, textarea")) return;
		openMenu(event, items());
	};
	return (
		<article {...rest} ref={element} className={`${className} wp-actionable`} onContextMenu={menu}>
			{children}
			<div
				className="wp-message-actions"
				role="toolbar"
				aria-label="Message actions"
				onMouseDown={(event) => event.preventDefault()}
			>
				{onReply && (
					<button type="button" aria-label="Reply" title="Reply" onClick={() => onReply(chosen())}>
						<Icon name="reply" />
					</button>
				)}
				{forward && (
					<button type="button" aria-label="Forward" title="Forward" onClick={() => forward(chosen())}>
						<Icon name="forward" />
					</button>
				)}
				<button
					type="button"
					aria-label="Copy text"
					title="Copy text"
					onClick={() => void navigator.clipboard.writeText(chosen().text)}
				>
					<Icon name="copy" />
				</button>
				<button
					type="button"
					aria-label="More message actions"
					title="More"
					onClick={(event) => openMenu(event, items())}
				>
					<Icon name="more" />
				</button>
			</div>
		</article>
	);
}

type Delivery = { ok: true } | { ok: false; reason: string };

/** Send words to a destination as the operator: a person's conversation (or mail while away), or a thread. */
async function deliver(
	world: WorldSnapshot,
	target: SwitchTarget,
	body: string,
	notify: string[] = [],
): Promise<Delivery> {
	const api = window.agentWorld;
	if (target.kind === "dm") {
		const awake = world.characters.find((person) => person.id === target.id);
		if (awake) {
			const busy = (awake.facts?.run ?? "idle") !== "idle";
			const ok = await conversationPanel.instruct(awake, { kind: busy ? "follow_up" : "talk", text: body });
			return ok ? { ok: true } : { ok: false, reason: "The message was not taken." };
		}
		const receipt = await api.sendMail(target.id, body);
		return receipt.ok ? { ok: true } : { ok: false, reason: receipt.reason };
	}
	if (target.kind === "view") return { ok: false, reason: "Choose a person, channel or thread." };
	const result = await api.communications.post({
		attempt: crypto.randomUUID(),
		thread: target.id,
		body,
		...(notify.length ? { notify } : {}),
	});
	if ("outcome" in result && result.outcome === "applied") return { ok: true };
	return {
		ok: false,
		reason: "reason" in result && result.reason ? String(result.reason) : "The post was not recorded.",
	};
}

/** Forwarding for every message inside: a destination picker with an optional note, and a toast with the outcome. */
export function ForwardProvider({
	world,
	go,
	children,
}: {
	world: WorldSnapshot;
	go: (target: SwitchTarget) => void;
	children: ReactNode;
}) {
	const [message, setMessage] = useState<QuotedMessage>();
	const [toast, setToast] = useState<{ text: string; target?: SwitchTarget; failed?: boolean }>();
	const returnFocus = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(undefined), 6000);
		return () => clearTimeout(timer);
	}, [toast]);
	const send = (target: SwitchTarget, label: string, body: string, notify?: string[]) =>
		void deliver(world, target, body, notify).then(
			(result) =>
				setToast(
					result.ok
						? { text: `Sent to ${label}`, target }
						: { text: `Not sent to ${label}: ${result.reason}`, failed: true },
				),
			(failure: unknown) => setToast({ text: `Not sent: ${String(failure)}`, failed: true }),
		);
	const deskThread = world.desk?.thread;
	const deskPerson = world.desk?.person;
	const latestSend = useRef(send);
	latestSend.current = send;
	const value = useMemo(
		() => ({
			forward: (next: QuotedMessage) => {
				returnFocus.current = document.activeElement as HTMLElement | null;
				setMessage(next);
			},
			...(deskThread && deskPerson
				? {
						handOff: (next: QuotedMessage) =>
							latestSend.current(
								{ kind: "channel", id: deskThread },
								"the front desk",
								`Please handle this.\n\n${quote(next)}`,
								[deskPerson],
							),
					}
				: {}),
		}),
		[deskThread, deskPerson],
	);
	const close = () => {
		setMessage(undefined);
		if (returnFocus.current?.isConnected) returnFocus.current.focus();
	};
	return (
		<ForwardContext.Provider value={value}>
			{children}
			{message && (
				<ForwardDialog
					world={world}
					message={message}
					close={close}
					send={(chosen, note) => {
						close();
						const body = [note.trim(), quote(message)].filter(Boolean).join("\n\n");
						if (chosen.length === 1) send(chosen[0]!.target, chosen[0]!.label, body);
						else
							void Promise.all(chosen.map((item) => deliver(world, item.target, body))).then((results) => {
								const failed = chosen.filter((_, index) => !results[index]!.ok).map((item) => item.label);
								setToast(
									failed.length
										? { text: `Not sent to ${failed.join(", ")}`, failed: true }
										: { text: `Sent to ${chosen.length} conversations` },
								);
							});
					}}
				/>
			)}
			{toast && (
				<div className={`wp-toast${toast.failed ? " is-failed" : ""}`} role="status">
					<span>{toast.text}</span>
					{toast.target && (
						<button
							type="button"
							onClick={() => {
								go(toast.target!);
								setToast(undefined);
							}}
						>
							Open
						</button>
					)}
					<button type="button" aria-label="Dismiss" onClick={() => setToast(undefined)}>
						<Icon name="close" />
					</button>
				</div>
			)}
		</ForwardContext.Provider>
	);
}

function ForwardDialog({
	world,
	message,
	close,
	send,
}: {
	world: WorldSnapshot;
	message: QuotedMessage;
	close: () => void;
	send: (chosen: Item[], note: string) => void;
}) {
	const [note, setNote] = useState("");
	const [chosen, setChosen] = useState<Item[]>([]);
	const items = useMemo(() => destinations(world), [world]);
	const finish = () => {
		if (chosen.length) send(chosen, note);
	};
	return (
		<Picker
			label="Forward message"
			placeholder="Forward to a person, channel or thread"
			items={items.filter((item) => !chosen.some((picked) => picked.key === item.key))}
			close={close}
			choose={(item) => setChosen((previous) => [...previous, item])}
			finish={finish}
			unchip={() => setChosen((previous) => previous.slice(0, -1))}
			chips={chosen.map((item) => (
				<span key={item.key} className="wp-forward-chip">
					{item.label}
					<button
						type="button"
						aria-label={`Remove ${item.label}`}
						onClick={() => setChosen((previous) => previous.filter((picked) => picked.key !== item.key))}
					>
						{"\u00d7"}
					</button>
				</span>
			))}
			footer={
				<footer className="wp-forward-foot">
					<span>
						<kbd>Enter</kbd> adds &middot; <kbd>Enter</kbd> again forwards
					</span>
					<button type="button" className="wp-primary" disabled={!chosen.length} onClick={finish}>
						Forward
					</button>
				</footer>
			}
		>
			<div className="wp-forward-head">
				<strong>Forward message</strong>
				<blockquote>
					<span>
						{message.author}
						{message.where ? ` \u00b7 ${message.where}` : ""}
					</span>
					<div className="wp-forward-text">
						<Markdown text={message.text} />
					</div>
				</blockquote>
				<textarea
					aria-label="Add a note"
					placeholder="Add a note (optional)"
					rows={2}
					value={note}
					onChange={(event) => setNote(event.target.value)}
				/>
			</div>
		</Picker>
	);
}
