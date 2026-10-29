import { Lexer } from "marked";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Character, WorldSnapshot } from "../src/world.js";
import { sleeperCharacter } from "./game/layout.js";
import { factRows } from "./overlay/interface/character-card.js";
import { OrgNameEditor } from "./workplace-org-name.js";
import { WorkHistory } from "./workplace-work-history.js";

type PeopleNavigation = {
	world: WorldSnapshot;
	openDM: (id: string) => void;
	openProfile: (id: string, name: string, trigger: HTMLElement) => void;
};

export const ChatPeople = createContext<PeopleNavigation | undefined>(undefined);

function personIn(world: WorldSnapshot, id: string) {
	const awake = world.characters.find((person) => person.id === id);
	if (awake) return awake;
	const dormant = world.dormant?.find((person) => person.id === id);
	return dormant ? sleeperCharacter(dormant) : undefined;
}

export function sessionStatus(person: Character): string {
	const facts = person.facts;
	if (facts?.status === "asking") return "Needs your input";
	return {
		idle: facts?.unseen ? "Finished" : "Idle",
		thinking: "Thinking",
		writing_reply: "Writing a reply",
		running_tool: "Working",
		compacting: "Updating context",
	}[facts?.run ?? "idle"];
}

function avatarTone(id: string) {
	let hash = 2166136261;
	for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
	return ["plum", "teal", "blue", "rose", "amber", "moss"][(hash >>> 0) % 6];
}

export function PersonAvatar({
	id,
	name,
	className = "",
	interactive = true,
}: {
	id: string;
	name: string;
	className?: string;
	interactive?: boolean;
}) {
	const people = useContext(ChatPeople);
	const content = <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
	const classes = `wp-avatar-tile ${className}`;
	if (people && interactive)
		return (
			<button
				type="button"
				className={classes}
				data-tone={avatarTone(id)}
				aria-label={`View profile: ${name}`}
				onClick={(event) => people.openProfile(id, name, event.currentTarget)}
			>
				{content}
			</button>
		);
	return (
		<span className={classes} data-tone={avatarTone(id)} aria-hidden="true">
			{content}
		</span>
	);
}

export function PersonName({ id, name, className = "" }: { id: string; name: string; className?: string }) {
	const people = useContext(ChatPeople);
	return people && id !== "operator" && personIn(people.world, id) ? (
		<button
			type="button"
			className={`wp-name-link ${className}`}
			title={`Open DM: ${name}`}
			onClick={() => people.openDM(id)}
		>
			{name}
		</button>
	) : (
		<span className={className}>{name}</span>
	);
}

const PREVIEW_CHARACTERS = 200;
const SELF_HEADINGS = new Set(["My story", "How I work", "What I hold myself to", "The people I work with"]);

function ExpandableText({ text, field }: { text: string; field: string }) {
	const [expanded, setExpanded] = useState(false);
	const contentId = useId();
	const characters = Array.from(text);
	const longer = characters.length > PREVIEW_CHARACTERS;
	return (
		<>
			<p id={contentId} className="wp-profile-text">
				{longer && !expanded ? `${characters.slice(0, PREVIEW_CHARACTERS).join("")}\u2026` : text}
			</p>
			{longer && (
				<button
					type="button"
					className="wp-see-more"
					aria-expanded={expanded}
					aria-controls={contentId}
					aria-label={`${expanded ? "See less" : "See more"} of ${field}`}
					onClick={() => setExpanded(!expanded)}
				>
					{expanded ? "See less" : "See more"}
				</button>
			)}
		</>
	);
}

function SelfDetails({ id }: { id: string }) {
	const [text, setText] = useState<string | null>();
	const [error, setError] = useState<string>();
	useEffect(() => {
		let current = true;
		void (async () => {
			try {
				const result = await window.agentWorld.profile(id);
				if (!current) return;
				if (result.ok) setText(result.self);
				else setError(result.reason);
			} catch (failure) {
				if (current) setError(String(failure));
			}
		})();
		return () => {
			current = false;
		};
	}, [id]);
	const sections = useMemo(() => {
		const parts: { heading: string; text: string; offset: number }[] = [];
		let offset = 0;
		for (const token of Lexer.lex(text ?? "")) {
			if (token.type === "heading" && token.depth === 2 && SELF_HEADINGS.has(token.text))
				parts.push({ heading: token.text, text: "", offset });
			else {
				if (!parts.length && token.raw.trim()) parts.push({ heading: "Notes", text: "", offset });
				if (parts.length) parts[parts.length - 1].text += token.raw;
			}
			offset += token.raw.length;
		}
		return parts.map((part) => ({ ...part, text: part.text.trim() })).filter((part) => part.text);
	}, [text]);
	if (error) return <p role="alert">Could not load Self: {error}</p>;
	if (text === undefined) return <p className="wp-muted">Loading Self...</p>;
	if (!sections.length) return <p className="wp-muted">Not written yet.</p>;
	return sections.map((section) => (
		<section className="wp-self-field" aria-label={`Self: ${section.heading}`} key={section.offset}>
			<h4>{section.heading}</h4>
			<ExpandableText text={section.text} field={`Self: ${section.heading}`} />
		</section>
	));
}

export function PersonProfile({ id, name: fallbackName, onClose }: { id: string; name: string; onClose: () => void }) {
	const people = useContext(ChatPeople)!;
	const person = personIn(people.world, id);
	const dormant = people.world.dormant?.find((candidate) => candidate.id === id);
	const name = person?.name ?? fallbackName;
	const close = useRef<HTMLButtonElement>(null);
	const since = person ? (person.hiredAt ?? person.startedAt) : 0;
	const hasRecordedWork = people.world.workplace?.workHistory?.some((task) =>
		task.participants.some((participant) => participant.person === id),
	);
	useEffect(() => {
		close.current?.focus();
	}, []);
	useEffect(() => {
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, [onClose]);
	return (
		<aside className="wp-profile" aria-label={`Profile: ${name}`}>
			<header>
				<h2>Profile</h2>
				<button type="button" ref={close} className="wp-profile-close" aria-label="Close profile" onClick={onClose}>
					Close
				</button>
			</header>
			<div className="wp-profile-body">
				<PersonAvatar id={id} name={name} className="wp-profile-avatar" interactive={false} />
				<h3>{name}</h3>
				<p className="wp-profile-status">
					{id === "operator"
						? "Operator"
						: dormant?.retiredAt
							? "Former member · History only"
							: dormant
								? "Asleep · History only"
								: person
									? sessionStatus(person)
									: "Unavailable"}
				</p>
				{person ? (
					<>
						<button type="button" className="wp-primary wp-profile-message" onClick={() => people.openDM(id)}>
							{dormant ? "View conversation" : "Message"} {name}
						</button>
						{!person.facts?.temporary &&
							!dormant?.retiredAt &&
							(person.role === "coordinator" || person.facts?.reportsTo === null) && (
								<OrgNameEditor key={id} id={id} name={name} />
							)}
						<WorkHistory world={people.world} people={[id]} />
						<dl>
							{person.specialization && (
								<div>
									<dt>Specialization</dt>
									<dd>
										<ExpandableText text={person.specialization} field="Specialization" />
									</dd>
								</div>
							)}
							<div>
								<dt>{person.hiredAt != null ? "Hired" : "First seen"}</dt>
								<dd>
									{since > 0 ? (
										<time dateTime={new Date(since).toISOString()} title={new Date(since).toLocaleString()}>
											{new Date(since).toLocaleDateString(undefined, {
												year: "numeric",
												month: "short",
												day: "numeric",
											})}
										</time>
									) : (
										"Unknown"
									)}
								</dd>
							</div>
							{factRows(person, people.world)
								.filter(
									([term]) =>
										term !== "Doing" &&
										term !== "Self" &&
										(term !== "Cost" || !dormant) &&
										(term !== "Record" || !hasRecordedWork),
								)
								.map(([term, value]) => (
									<div key={term}>
										<dt>{term}</dt>
										<dd>
											{term === "Record" ? (
												<ExpandableText text={person.facts?.tasks?.join("\n") ?? value} field="Record" />
											) : (
												value
											)}
										</dd>
									</div>
								))}
							<div>
								<dt>Self</dt>
								<dd>
									<SelfDetails id={id} />
								</dd>
							</div>
						</dl>
					</>
				) : (
					<p className="wp-empty-note">
						{id === "operator"
							? "You send messages as the operator. This identity is not a Pi session."
							: "This person is not available in the current organization."}
					</p>
				)}
			</div>
		</aside>
	);
}
