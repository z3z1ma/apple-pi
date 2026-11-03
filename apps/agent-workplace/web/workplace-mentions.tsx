import { type KeyboardEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { WorldSnapshot } from "../src/world.js";
import { PersonAvatar } from "./workplace-people.js";
import "./workplace-mentions.css";

type Person = { id: string; name: string; detail: string };

function typedMention(text: string, caret: number): { start: number; query: string } | undefined {
	const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
	return match ? { start: caret - match[1]!.length - 1, query: match[1]!.toLowerCase() } : undefined;
}

function people(world: WorldSnapshot | undefined): Person[] {
	if (!world) return [];
	return [
		...world.characters
			.filter((person) => !person.facts?.temporary)
			.map((person) => ({ id: person.id, name: person.name, detail: person.facts?.title ?? "" })),
		...(world.dormant ?? [])
			.filter((person) => !person.retiredAt && !person.temporary)
			.map((person) => ({ id: person.id, name: person.name, detail: "Away" })),
	];
}

export function useMentions(
	world: WorldSnapshot | undefined,
	box: RefObject<HTMLTextAreaElement | null>,
	text: string,
	setText: (text: string) => void,
) {
	const [open, setOpen] = useState<{ start: number; query: string }>();
	const [index, setIndex] = useState(0);
	const [chosen, setChosen] = useState<Person[]>([]);
	const caretAfterInsert = useRef<number | undefined>(undefined);
	useLayoutEffect(() => {
		if (caretAfterInsert.current === undefined) return;
		box.current?.setSelectionRange(caretAfterInsert.current, caretAfterInsert.current);
		caretAfterInsert.current = undefined;
	});
	const everyone = people(world);
	const shown = open
		? everyone.filter((person) =>
				person.name
					.toLowerCase()
					.split(/\s+/)
					.some((part) => part.startsWith(open.query)),
			)
		: [];
	const track = (value: string, caret: number) => {
		const next = typedMention(value, caret);
		setOpen(next);
		if (next?.query !== open?.query) setIndex(0);
	};
	const insert = (person: Person) => {
		if (!open) return;
		const caret = box.current?.selectionStart ?? text.length;
		const value = `${text.slice(0, open.start)}@${person.name} ${text.slice(caret)}`;
		const at = open.start + person.name.length + 2;
		setText(value);
		setChosen((previous) => [...previous.filter((item) => item.id !== person.id), person]);
		setOpen(undefined);
		caretAfterInsert.current = at;
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (!open || !shown.length) return false;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setIndex((current) => (current + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
			return true;
		}
		if ((event.key === "Enter" || event.key === "Tab") && !event.nativeEvent.isComposing) {
			event.preventDefault();
			insert(shown[Math.min(index, shown.length - 1)]!);
			return true;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			setOpen(undefined);
			return true;
		}
		return false;
	};
	const list =
		open && shown.length ? (
			<ul className="wp-mentions" aria-label="People to mention">
				{shown.map((person, position) => (
					<li key={person.id}>
						<button
							type="button"
							tabIndex={-1}
							aria-current={position === index}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => setIndex(position)}
							onClick={() => insert(person)}
							ref={(node) => {
								if (position === index) node?.scrollIntoView({ block: "nearest" });
							}}
						>
							<PersonAvatar id={person.id} name={person.name} interactive={false} />
							<strong>{person.name}</strong>
							<small>{person.detail}</small>
						</button>
					</li>
				))}
			</ul>
		) : null;
	return {
		list,
		track,
		onKeyDown,
		mentioned: (value: string) =>
			chosen.filter((person) => value.includes(`@${person.name}`)).map((person) => person.id),

		withIds: (value: string) =>
			chosen.reduce(
				(out, person) =>
					out.includes(`@${person.name} (${person.id})`)
						? out
						: out.replace(`@${person.name}`, `@${person.name} (${person.id})`),
				value,
			),
		reset: () => setChosen([]),
	};
}
