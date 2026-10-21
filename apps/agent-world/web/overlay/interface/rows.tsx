// A character's row in any tab: its state pip, name, what it is doing, and, once chosen, every action on it. Each
// action works from anywhere; none needs the avatar to walk.
import type { Character } from "../../../src/world.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { CheckIcon, QuestionIcon } from "./icons.js";
import { type Attention, ago, attentionOf } from "./model.js";

export type CharacterAction = "talk-to" | "examine" | "go-to" | "terminal" | "rename" | "retire" | "end-session";

const PIP_LABEL: Record<Attention, string> = {
	asking: "Asking you",
	finished: "Finished, unseen",
	working: "Working",
	idle: "Idle",
};

/** The state pip: a question, a tick, three working dots, or a quiet dot, each drawn centred. */
export function Pip({ attention }: { attention: Attention }) {
	return (
		<span className={`aw-pip aw-pip-${attention}`} aria-hidden="true">
			{attention === "asking" && <QuestionIcon />}
			{attention === "finished" && <CheckIcon />}
			{attention === "working" && (
				<span className="aw-dots" aria-hidden="true">
					<i />
					<i />
					<i />
				</span>
			)}
		</span>
	);
}

export function ActionButtons({
	character,
	act,
	skip,
}: {
	character: Character;
	act: (action: CharacterAction, character: Character) => void;
	skip?: CharacterAction;
}) {
	const theme = useTheme();
	const name = character.name;
	const actions: { action: CharacterAction; text: string; label: string }[] = [
		{ action: "talk-to", text: "Talk to", label: `Talk to ${name}` },
		{ action: "examine", text: "Examine", label: `Examine ${name}` },
		{ action: "go-to", text: "Go to", label: `Go to ${name}` },
		{ action: "terminal", text: "Terminal", label: `Go to ${name}'s terminal` },
		{ action: "rename", text: "Rename", label: `Rename ${name}` },
		// Only a person hired into a role retires; the operator's own sessions have none.
		...(character.facts?.title
			? [{ action: "retire" as const, text: say(theme, "retire"), label: `Retire ${name}` }]
			: []),
		{ action: "end-session", text: "End session", label: `End ${name}'s session` },
	];
	return (
		<fieldset className="aw-actions" aria-label={`Actions on ${name}`}>
			{actions
				.filter((a) => a.action !== skip)
				.map((a) => (
					<button
						key={a.action}
						type="button"
						className={`aw-button${a.action === "end-session" ? " aw-button-end" : ""}`}
						aria-label={a.label}
						title={a.label}
						onClick={(event) => {
							event.stopPropagation();
							act(a.action, character);
						}}
					>
						{a.text}
					</button>
				))}
		</fieldset>
	);
}

export function CharacterRow({
	character,
	detail,
	work,
	since,
	selected,
	onSelect,
	act,
}: {
	character: Character;
	detail: string;
	/** What it works on (its ledger task or stated intent), on a line of its own under the detail. */
	work?: string;
	/** A time to show at the row's end, such as how long it has needed you. */
	since?: number | null;
	selected: boolean;
	onSelect: () => void;
	act: (action: CharacterAction, character: Character) => void;
}) {
	const attention = attentionOf(character);
	const time = ago(since);
	return (
		<li className={`aw-row aw-row-${attention}${selected ? " aw-row-selected" : ""}`}>
			<button
				type="button"
				className="aw-row-main"
				aria-expanded={selected}
				onClick={onSelect}
				onContextMenu={(event) => {
					event.preventDefault();
					if (!selected) onSelect();
				}}
				onDoubleClick={() => act("talk-to", character)}
			>
				<Pip attention={attention} />
				<span className="aw-row-text">
					<span className="aw-row-name">{character.name}</span>
					<span className="aw-sr">, {PIP_LABEL[attention]}: </span>
					{detail && (
						<span className="aw-row-detail" title={detail}>
							{detail}
						</span>
					)}
					{work && (
						<>
							<span className="aw-sr">; </span>
							<span className="aw-row-detail aw-row-work" title={work}>
								{work}
							</span>
						</>
					)}
				</span>
				{time && <span className="aw-row-time">{time}</span>}
			</button>
			{selected && <ActionButtons character={character} act={act} />}
		</li>
	);
}
