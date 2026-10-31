import {
	createContext,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { AgentWorldApi, CommandReceipt, WorldSnapshot } from "../src/world.js";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import "./workplace-person-actions.css";

type Action = "home" | "call" | "retire";
type Person = { id: string; name: string; awake: boolean; busy: boolean };
type CallResult = Awaited<ReturnType<AgentWorldApi["callIn"]>>;
type Operation = {
	id: string;
	action: Action;
	person: Person;
	trigger: HTMLElement;
	affected: { id: string; name: string }[];
	expected: string[];
	problem?: string;
};
type MenuEvent = MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>;
type Actions = { world: WorldSnapshot; menu: (event: MenuEvent, id: string) => void };
const ActionsContext = createContext<Actions | null>(null);

function personIn(world: WorldSnapshot, id: string): Person | undefined {
	const awake = world.characters.find((person) => person.id === id);
	const asleep = world.dormant?.find((person) => person.id === id);
	if (
		id === "operator" ||
		(!awake && !asleep) ||
		asleep?.retiredAt != null ||
		awake?.facts?.temporary ||
		asleep?.temporary
	)
		return;
	return {
		id,
		name: awake?.name ?? asleep!.name,
		awake: !!awake,
		busy: !!awake && (awake.facts?.run !== "idle" || awake.facts?.status === "asking"),
	};
}

function callPlan(world: WorldSnapshot, id: string) {
	const affected: { id: string; name: string }[] = [];
	const seen = new Set<string>();
	let current: string | null = id;
	while (current !== null) {
		const person = personIn(world, current);
		if (!person || seen.has(current))
			return {
				affected,
				expected: [],
				problem: "The recorded manager chain is missing, ineligible or cyclic. Refresh before calling in.",
			};
		seen.add(current);
		if (!person.awake) affected.push({ id: current, name: person.name });
		const awake = world.characters.find((candidate) => candidate.id === current);
		const parent = awake
			? awake.facts?.reportsTo
			: world.dormant?.find((candidate) => candidate.id === current)?.reportsTo;
		if (parent === undefined)
			return {
				affected,
				expected: [],
				problem: `The reporting line for ${person.name} is not available. Refresh before calling in.`,
			};
		current = parent;
	}
	return { expected: affected.map((person) => person.id), affected: affected.reverse(), problem: undefined };
}

function useActions() {
	const context = useContext(ActionsContext);
	if (!context) throw new Error("Person actions require WorkplacePersonActions.");
	return context;
}

export function usePersonMenu() {
	return useActions().menu;
}

export function PersonActionsButton({ id }: { id: string }) {
	const { world, menu } = useActions();
	const person = personIn(world, id);
	if (!person) return null;
	return (
		<button
			type="button"
			className="wp-person-menu"
			aria-label={`Person actions: ${person.name}`}
			title={`Person actions: ${person.name}`}
			aria-haspopup="menu"
			onClick={(event) => menu(event, id)}
			onContextMenu={(event) => menu(event, id)}
			onKeyDown={(event) => menu(event, id)}
		>
			<span aria-hidden="true">&#8943;</span>
		</button>
	);
}

export function WorkplacePersonActions({ world, children }: { world: WorldSnapshot; children: ReactNode }) {
	const openMenu = useWorkplaceMenu();
	const current = useRef(world);
	current.current = world;
	const [operation, setOperation] = useState<Operation>();
	const begin = (action: Action, id: string, trigger: HTMLElement) => {
		const person = personIn(current.current, id);
		if (!person || (action === "home" && !person.awake) || (action === "call" && person.awake)) return;
		const plan = action === "call" ? callPlan(current.current, id) : { affected: [], expected: [] };
		setOperation({ id: crypto.randomUUID(), person, action, trigger, ...plan });
	};
	const menu = (event: MenuEvent, id: string) => {
		const person = personIn(current.current, id);
		if (!person) return;
		const trigger = event.currentTarget;
		openMenu(event, [
			person.awake
				? { label: "Send home", onSelect: () => begin("home", id, trigger) }
				: { label: "Call in", onSelect: () => begin("call", id, trigger) },
			{ label: "Let go", onSelect: () => begin("retire", id, trigger) },
		]);
	};
	return (
		<ActionsContext.Provider value={{ world, menu }}>
			{children}
			{operation && (
				<PersonActionDialog
					key={operation.id}
					operation={operation}
					world={world}
					onClose={() => setOperation(undefined)}
				/>
			)}
		</ActionsContext.Provider>
	);
}

function PersonActionDialog({
	operation,
	world,
	onClose,
}: {
	operation: Operation;
	world: WorldSnapshot;
	onClose: () => void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const lock = useRef(false);
	const autoStarted = useRef(false);
	const titleId = useId();
	const [pending, setPending] = useState(false);
	const [reason, setReason] = useState("");
	const [permanent, setPermanent] = useState(false);
	const [handoff, setHandoff] = useState(true);
	const [busyWarning, setBusyWarning] = useState(operation.person.busy);
	const [receipt, setReceipt] = useState<CommandReceipt>();
	const [callResult, setCallResult] = useState<CallResult>();
	const [uncertain, setUncertain] = useState<string>();
	const { action, person } = operation;
	const current = personIn(world, person.id);
	const busy = busyWarning || !!current?.busy;
	const finished = !!receipt?.ok;
	const blocked =
		!!operation.problem ||
		!world.connected ||
		(action !== "call" && (!current || (action === "home" && !current.awake)));
	const title =
		action === "home"
			? `Send ${person.name} home`
			: action === "call"
				? `Call in ${person.name}`
				: `Let ${person.name} go`;
	const submit = async (automatic = false) => {
		if (lock.current || blocked || finished || (uncertain && action !== "call")) return;
		if (action === "retire" && (!reason.trim() || !permanent)) return;
		lock.current = true;
		setPending(true);
		setUncertain(undefined);
		try {
			if (action === "call") {
				setCallResult(
					await window.agentWorld.callIn({ id: operation.id, person: person.id, expected: operation.expected }),
				);
			} else {
				const result =
					action === "home"
						? await window.agentWorld.endSession(person.id, automatic ? false : busy)
						: await window.agentWorld.retire(person.id, reason.trim(), handoff);
				setReceipt(result);
				if (!result.ok && result.confirm) setBusyWarning(true);
			}
		} catch (error) {
			setUncertain(
				`Outcome unknown: ${String(error)}. ${action === "call" ? "Retry checks this same operation before continuing." : "Check the person's current state before issuing another request."}`,
			);
		} finally {
			lock.current = false;
			setPending(false);
		}
	};
	const submitRef = useRef(submit);
	submitRef.current = submit;
	useEffect(() => {
		const element = dialog.current!;
		element.showModal();
		cancel.current?.focus();
		return () => {
			element.close();
			if (operation.trigger.isConnected) operation.trigger.focus({ preventScroll: true });
		};
	}, [operation]);
	useEffect(() => {
		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (!lock.current) onClose();
		};
		window.addEventListener("keydown", onEscape, true);
		return () => window.removeEventListener("keydown", onEscape, true);
	}, [onClose]);
	useEffect(() => {
		const immediate =
			(action === "call" && operation.expected.length === 1) || (action === "home" && !operation.person.busy);
		if (immediate && !operation.problem && !autoStarted.current) {
			autoStarted.current = true;
			void submitRef.current(true);
		}
	}, [action, operation]);
	const attempted = !!receipt || !!callResult || !!uncertain;
	return (
		<dialog
			ref={dialog}
			className="wp-person-dialog"
			aria-labelledby={titleId}
			aria-busy={pending}
			onCancel={(event) => {
				event.preventDefault();
				if (!lock.current) onClose();
			}}
		>
			<h2 id={titleId}>{title}</h2>
			{action === "home" && (
				<p>Close only {person.name}'s session. Their work and history remain available for a later call-in.</p>
			)}
			{action === "home" && busy && (
				<p className="wp-person-warning">
					This person is busy or awaiting input. Sending home stops their current turn.
				</p>
			)}
			{action === "retire" && (
				<p>
					This person and their private resources are permanently removed. Choose whether to request a final handoff
					first. Acceptance starts that work; later runtime mail reports the outcome. Reports are not included.
				</p>
			)}
			{action === "call" && (
				<>
					<p>
						Resume existing work for these people, highest absent manager first. Reports are not included; normal
						terminal placement still applies.
					</p>
					<ol aria-label="People to call in">
						{operation.affected.map((item) => (
							<li key={item.id}>{item.name}</li>
						))}
					</ol>
				</>
			)}
			{operation.problem && <p role="alert">{operation.problem}</p>}
			{blocked && !operation.problem && !finished && (
				<p role="alert">This action is no longer available in the current connected snapshot.</p>
			)}
			{action === "retire" && !finished && (
				<>
					<label>
						Reason for leaving
						<textarea
							aria-label="Reason for leaving"
							rows={3}
							value={reason}
							disabled={pending || !!uncertain}
							onChange={(event) => setReason(event.target.value)}
						/>
					</label>
					<label className="wp-person-permanent">
						<input
							type="checkbox"
							checked={handoff}
							disabled={pending || !!uncertain}
							onChange={(event) => setHandoff(event.target.checked)}
						/>
						Request a final handoff
					</label>
					{!handoff && (
						<p>
							No final model turn or handoff file. A sleeping person stays asleep until removal.{" "}
							{busy && "Their current turn will be stopped."}
						</p>
					)}
					<label className="wp-person-permanent">
						<input
							type="checkbox"
							checked={permanent}
							disabled={pending || !!uncertain}
							onChange={(event) => setPermanent(event.target.checked)}
						/>
						Permanently remove {person.name}
					</label>
				</>
			)}
			{receipt &&
				(receipt.ok ? (
					<div role="status">
						<p>
							Receipt: {receipt.stage}. {receipt.stage === "applied" ? "Applied." : "Completion is not yet confirmed."}
						</p>
						{receipt.note && <p>{receipt.note}</p>}
					</div>
				) : (
					<p role="alert">{receipt.reason}</p>
				))}
			{callResult && (
				<section aria-label="Call-in outcomes">
					<ul>
						{callResult.people.map((result) => (
							<li key={result.person}>
								<strong>{operation.affected.find((item) => item.id === result.person)?.name ?? result.person}</strong>:{" "}
								{result.state}
								{result.stage && ` (${result.stage})`}
								{result.reason && ` - ${result.reason}`}
							</li>
						))}
					</ul>
					{callResult.reason && <p role="alert">{callResult.reason}</p>}
				</section>
			)}
			{uncertain && <p role="alert">{uncertain}</p>}
			{pending && <p role="status">Waiting for the runtime...</p>}
			<footer>
				<button
					ref={cancel}
					type="button"
					disabled={pending}
					onClick={() => {
						if (!lock.current) onClose();
					}}
				>
					{attempted ? "Close" : "Cancel"}
				</button>
				{!finished && !callResult?.ok && !(uncertain && action !== "call") && (
					<button
						type="button"
						className="wp-person-confirm"
						disabled={pending || blocked || (action === "retire" && (!reason.trim() || !permanent))}
						onClick={() => void submit()}
					>
						{action === "home" ? "Send home" : action === "retire" ? "Let go" : attempted ? "Retry call in" : "Call in"}
					</button>
				)}
			</footer>
		</dialog>
	);
}
