import { useEffect, useRef, useState } from "react";
import type { OrgStartProgress } from "../src/org.js";
import type { Character, RoleChoice, WorldSnapshot } from "../src/world.js";
import { sleeperCharacter } from "./game/layout.js";
import { AddPerson } from "./workplace-add-person.js";
import { OrgChart } from "./workplace-org-chart.js";
import { OrgMoveConfirm } from "./workplace-org-confirm.js";
import { OrgNameEditor } from "./workplace-org-name.js";
import { OrgSearch } from "./workplace-org-search.js";
import { ChatPeople, PersonProfile } from "./workplace-people.js";
import "./workplace-org.css";

type Position = {
	id: string;
	role: string;
	name: string;
	manager: string | null;
	goal: string;
	specialization?: string;
	existing?: boolean;
	person?: string;
};
type Draft = { id: string; cwd: string; goal: string; positions: Position[] };
type Person = { character: Character; parent: string | null; home: boolean };
type Move = { person: string; manager: string | null; branch: string[] };
const api = window.agentWorld;

function descendants(id: string, parents: Map<string, string | null>): string[] {
	const found = new Set([id]);
	for (const current of found) for (const [child, parent] of parents) if (parent === current) found.add(child);
	return [...found];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Owns the retained plan, profile and recruitment panels across navigation and startup receipts.
export function Org({
	world,
	active,
	openDM,
	openChannel,
	onPlanChange,
}: {
	world: WorldSnapshot;
	active: boolean;
	openDM: (id: string) => void;
	openChannel?: (id: string) => void;
	onPlanChange?: (plan: { dirty: boolean; started: boolean }) => void;
}) {
	const [roles, setRoles] = useState<RoleChoice[]>([]);
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [selected, setSelected] = useState<string>();
	const [parent, setParent] = useState("");
	const [team, setTeam] = useState<string>();
	const [addingTo, setAddingTo] = useState<string>();
	const [recruiting, setRecruiting] = useState(false);
	const [draft, setDraft] = useState<Draft>();
	const [planHidden, setPlanHidden] = useState(false);
	const [position, setPosition] = useState<string>();
	const [roleToAdd, setRoleToAdd] = useState("");
	const [existingToAdd, setExistingToAdd] = useState("");
	const [move, setMove] = useState<Move>();
	const [busy, setBusy] = useState(false);
	const [started, setStarted] = useState(false);
	const [result, setResult] = useState<OrgStartProgress>();
	const trigger = useRef<HTMLElement | null>(null);
	const people: Person[] = [
		...world.characters
			.filter((character) => !character.facts?.temporary)
			.map((character) => ({ character, parent: character.facts?.reportsTo ?? null, home: false })),
		...(world.dormant ?? [])
			.filter(
				(person) => !person.temporary && !person.retiredAt && !world.characters.some((awake) => awake.id === person.id),
			)
			.map((person) => ({ character: sleeperCharacter(person), parent: person.reportsTo, home: true })),
	];
	const parents = new Map(people.map((person) => [person.character.id, person.parent]));
	const person = people.find((candidate) => candidate.character.id === selected);
	const currentPosition = draft?.positions.find((candidate) => candidate.id === position);
	const recordedSpecialization = currentPosition?.existing
		? people.find((candidate) => candidate.character.id === currentPosition.id)?.character.specialization
		: undefined;
	const role = (name: string) => roles.find((candidate) => candidate.name === name);
	const manages = (candidate: Person) => {
		const title = candidate.character.facts?.title;
		return (!title && candidate.parent === null) || roles.some((choice) => choice.title === title && choice.manages);
	};
	useEffect(() => {
		let current = true;
		void api
			.roles()
			.then((choices) => {
				if (current) {
					setRoles(choices);
					setRoleToAdd(choices.find((choice) => !choice.manages)?.name ?? choices[0]?.name ?? "");
				}
			})
			.catch((reason) => {
				if (current) setError(String(reason));
			});
		return () => {
			current = false;
		};
	}, []);
	useEffect(() => {
		if (!active) setSelected(undefined);
	}, [active]);
	const draftId = draft?.id;
	const hasPlan = draft !== undefined;
	useEffect(() => {
		onPlanChange?.({ dirty: hasPlan, started });
	}, [hasPlan, started, onPlanChange]);
	useEffect(() => {
		if (!api.onOrgStart || !draftId) return;
		return api.onOrgStart((progress) => {
			if (progress.id !== draftId) return;
			setResult(progress);
			if (progress.editable === true) setStarted(false);
			setDraft((value) =>
				value?.id === progress.id
					? {
							...value,
							positions: value.positions.map((item) => ({
								...item,
								person: progress.people.find((member) => member.id === item.id)?.person ?? item.person,
							})),
						}
					: value,
			);
		});
	}, [draftId]);
	const closeProfile = () => {
		setSelected(undefined);
		trigger.current?.isConnected && trigger.current.focus();
	};
	const select = (id: string, element?: HTMLElement) => {
		if (recruiting) return;
		trigger.current = element ?? null;
		setSelected(id);
		setAddingTo(undefined);
		setParent(parents.get(id) ?? "");
	};
	const propose = (id: string, manager: string | null) => {
		const branch = descendants(id, parents);
		if (manager && branch.includes(manager)) {
			setError("A person cannot report to their own branch.");
			return;
		}
		setError(undefined);
		setMove({ person: id, manager, branch });
	};
	async function applyMove() {
		if (!move) return;
		setBusy(true);
		setError(undefined);
		try {
			const response = await api.orgMove(move);
			if (!response.ok) setError(response.reason ?? "The reporting change was refused.");
			else {
				setNotice("Reporting change applied.");
				setMove(undefined);
				setSelected(undefined);
			}
		} catch (reason) {
			setError(String(reason));
		} finally {
			setBusy(false);
		}
	}
	function newTeam() {
		if (recruiting || busy) return;
		if (
			draft &&
			!window.confirm(
				started
					? "Replace this setup plan? Created people and their work remain. This removes the retained retry plan."
					: "Replace this team plan? The unsaved plan will be discarded.",
			)
		)
			return;
		setPlanHidden(false);
		setAddingTo(undefined);
		const head = roles.find((choice) => choice.manages);
		if (!head) {
			setError("No managing role is available in the role catalog.");
			return;
		}
		const id = crypto.randomUUID();
		setDraft({
			id: crypto.randomUUID(),
			cwd: people.find((candidate) => candidate.character.facts?.cwd)?.character.facts?.cwd ?? "",
			goal: "",
			positions: [{ id, role: head.name, name: "", manager: null, goal: "" }],
		});
		setPosition(id);
		setStarted(false);
		setResult(undefined);
		setSelected(undefined);
		setError(undefined);
	}
	function updatePosition(change: Partial<Position>) {
		setDraft((value) =>
			value
				? {
						...value,
						positions: value.positions.map((candidate) =>
							candidate.id === position ? { ...candidate, ...change } : candidate,
						),
					}
				: value,
		);
	}
	function addRole() {
		if (!draft || !roleToAdd) return;
		const id = crypto.randomUUID();
		const manager = draft.positions.find((candidate) => role(candidate.role)?.manages)?.id ?? null;
		setDraft({ ...draft, positions: [...draft.positions, { id, role: roleToAdd, name: "", manager, goal: "" }] });
		setPosition(id);
	}
	function addExisting() {
		if (!draft || !existingToAdd) return;
		const ids = descendants(existingToAdd, parents);
		const additions = people
			.filter(
				(candidate) =>
					ids.includes(candidate.character.id) && !draft.positions.some((item) => item.id === candidate.character.id),
			)
			.map((candidate) => ({
				id: candidate.character.id,
				name: candidate.character.name,
				role: roles.find((choice) => choice.title === candidate.character.facts?.title)?.name ?? "",
				manager: candidate.character.id === existingToAdd ? (draft.positions[0]?.id ?? null) : candidate.parent,
				goal: "",
				existing: true,
			}));
		setDraft({ ...draft, positions: [...draft.positions, ...additions] });
		setPosition(existingToAdd);
	}
	async function startTeam(withReady = false) {
		if (!draft) return;
		setBusy(true);
		setError(undefined);
		setStarted(true);
		try {
			const response = await api.orgStart({
				id: draft.id,
				cwd: draft.cwd,
				...(draft.goal.trim() ? { goal: draft.goal.trim() } : {}),
				withReady,
				positions: draft.positions.map((item) => ({
					id: item.id,
					role: item.role || undefined,
					name: item.name || undefined,
					person: item.existing ? item.id : item.person,
					manager: item.manager,
					...(!item.existing && item.specialization?.trim() ? { specialization: item.specialization.trim() } : {}),
					...(!item.existing && item.goal.trim() ? { goal: item.goal.trim() } : {}),
				})),
			});
			setResult(response);
			if (response.editable === true) {
				setStarted(false);
				setError(response.note ?? "Review the team plan and try again.");
			}
			setDraft((value) =>
				value
					? {
							...value,
							positions: value.positions.map((item) => ({
								...item,
								person: response.people.find((member) => member.id === item.id)?.person ?? item.person,
							})),
						}
					: value,
			);
			if (!response.complete)
				setNotice(
					response.note ??
						"Team setup is partial. Review each person before retrying or starting with ready teammates.",
				);
			else if (response.kickoff) {
				const headId = response.people.find((member) => member.id === draft.positions[0]?.id)?.person;
				const headName = people.find((candidate) => candidate.character.id === headId)?.character.name;
				setNotice(`Sent the team task to ${headName ?? "the team head"}; they coordinate the reports.`);
			} else setNotice(response.note ?? "Team ready for instructions.");
		} catch (reason) {
			setError(String(reason));
		} finally {
			setBusy(false);
		}
	}
	const setupActions = draft && (
		<>
			{started && (
				<section className="wp-org-progress" aria-label="Team setup progress">
					<p role="status">
						{busy
							? "Preparing the head, then reports."
							: (result?.note ??
								(result?.complete ? "Team setup complete." : "Review the actual people before retrying."))}
					</p>
					{draft.positions.map((item, index) => {
						const member = result?.people.find((value) => value.id === item.id);
						const identity = member?.person ?? item.person ?? (item.existing ? item.id : undefined);
						const actual = people.find((value) => value.character.id === identity);
						return (
							<div key={item.id} className="wp-org-progress-person" data-state={member?.state ?? "pending"}>
								<strong>
									{index + 1}. {item.name || role(item.role)?.title || "Teammate"}
								</strong>
								<span className="wp-org-progress-state">{member?.state ?? "pending"}</span>
								{actual ? (
									<button type="button" onClick={(event) => select(actual.character.id, event.currentTarget)}>
										View profile: {actual.character.name}
									</button>
								) : (
									identity && <p>Recorded person: {identity}</p>
								)}
								{member?.reason && <p>{member.reason}</p>}
							</div>
						);
					})}
					{result?.kickoff && (
						<p>
							Sent the team task to{" "}
							{people.find(
								(value) =>
									value.character.id === result.people.find((member) => member.id === draft.positions[0]?.id)?.person,
							)?.character.name ?? "the team head"}
							; they coordinate the reports.
						</p>
					)}
					{result?.channel && openChannel && (
						<button type="button" onClick={() => openChannel(result.channel!)}>
							Open team channel
						</button>
					)}
				</section>
			)}
			{result?.next === "choose-ready" && (
				<button type="button" disabled={busy} onClick={() => void startTeam(true)}>
					Start with ready teammates
				</button>
			)}
			<button
				type="button"
				className="wp-org-primary wp-org-start"
				disabled={busy || result?.complete || !draft.cwd.trim() || typeof api.orgStart !== "function"}
				onClick={() => void startTeam()}
			>
				{busy
					? "Preparing team..."
					: result?.complete
						? result.kickoff
							? "Team started"
							: "Team ready"
						: started
							? "Retry unresolved teammates"
							: "Start team"}
			</button>
		</>
	);
	const draftParents = new Map(draft?.positions.map((candidate) => [candidate.id, candidate.manager]));
	return (
		<ChatPeople.Provider value={{ world, openDM, openProfile: (id, _name, element) => select(id, element) }}>
			<section className="wp-org" aria-label="Organization chart">
				<header className="wp-org-toolbar">
					<div>
						<span className="wp-eyebrow">PEOPLE & TEAMS</span>
						<OrgNameEditor id="workspace" name="Your organization" defaultName="Your organization" heading="h1" />
						<p>
							{people.filter((candidate) => !candidate.parent || !parents.has(candidate.parent)).length} independent
							teams · {people.length} people
						</p>
					</div>
					<div className="wp-org-tools">
						<OrgSearch
							world={world}
							onTeam={(id) => setTeam(id)}
							onPerson={(id) => {
								if (recruiting) return;
								let root = id;
								const visited = new Set<string>();
								while (parents.get(root) && parents.has(parents.get(root)!) && !visited.has(root)) {
									visited.add(root);
									root = parents.get(root)!;
								}
								setTeam(root);
								select(id);
							}}
						/>
						{draft && (planHidden || selected || addingTo) && (
							<button
								type="button"
								disabled={recruiting}
								onClick={() => {
									setPlanHidden(false);
									setSelected(undefined);
									setAddingTo(undefined);
								}}
							>
								{started ? "Resume setup" : "Resume team plan"}
							</button>
						)}
						<button
							type="button"
							className="wp-org-primary"
							disabled={!roles.length || busy || recruiting}
							onClick={newTeam}
						>
							New team
						</button>
					</div>
				</header>
				{error && (
					<div className="wp-org-feedback wp-org-error" role="alert">
						{error}
						<button type="button" aria-label="Dismiss error" onClick={() => setError(undefined)}>
							×
						</button>
					</div>
				)}
				{notice && (
					<div className="wp-org-feedback" role="status">
						{notice}
					</div>
				)}
				<div
					className={`wp-org-layout${(draft && !planHidden) || addingTo || (selected && active) ? " wp-org-has-panel" : ""}`}
				>
					<OrgChart
						world={world}
						people={people}
						team={team}
						setTeam={setTeam}
						selected={selected}
						busy={busy || recruiting}
						manages={manages}
						select={select}
						propose={propose}
						addPerson={(manager) => {
							if (recruiting) return;
							setAddingTo(manager);
							setSelected(undefined);
						}}
					/>
					{addingTo ? (
						<AddPerson
							key={addingTo}
							world={world}
							manager={addingTo}
							onBusyChange={setRecruiting}
							onClose={() => setAddingTo(undefined)}
							onCreated={(id) => {
								setAddingTo(undefined);
								setNotice("Person created.");
								setSelected(id);
								setParent(addingTo);
							}}
						/>
					) : draft && !planHidden && !selected ? (
						<aside className="wp-org-draft" aria-label="Team plan">
							<header>
								<div>
									<span className="wp-eyebrow">{started ? "TEAM SETUP" : "NOT STARTED"}</span>
									<h2>{started ? "Team setup" : "Plan a team"}</h2>
								</div>
								<button type="button" aria-label="Close team plan" disabled={busy} onClick={() => setPlanHidden(true)}>
									×
								</button>
							</header>
							<p className="wp-org-plan-retained">
								Closing hides this plan. Resume it here without losing setup progress.
							</p>
							{started && setupActions}
							<details className="wp-org-plan-details" key={started ? "started" : "draft"} open={!started}>
								<summary>Setup plan</summary>
								<div className="wp-org-plan-fields">
									<p>
										Arrange real roles before any processes start. Existing teammates stay in their current teams until
										Start team. Starting joins you to the shared team channel as a reader; it does not mark messages
										read.
									</p>
									<label>
										Team task (optional)
										<textarea
											aria-label="Team task"
											value={draft.goal}
											disabled={started}
											onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
											placeholder="Leave blank to prepare the team without a shared task."
										/>
									</label>
									{!draft.goal.trim() && (
										<p>
											{draft.positions.some((item) => !item.existing && item.goal.trim())
												? "Only position goals will be assigned."
												: "People will be ready for instructions."}
										</p>
									)}
									<label>
										Repository
										<input
											aria-label="Repository"
											value={draft.cwd}
											disabled={started}
											onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
											placeholder="/path/to/repository"
										/>
									</label>
									<label>
										Head role
										<select
											aria-label="Head role"
											value={draft.positions[0]?.role}
											disabled={started}
											onChange={(event) =>
												setDraft({
													...draft,
													positions: draft.positions.map((item, index) =>
														index === 0 ? { ...item, role: event.target.value } : item,
													),
												})
											}
										>
											{roles
												.filter((choice) => choice.manages)
												.map((choice) => (
													<option key={choice.name} value={choice.name}>
														{choice.title}
													</option>
												))}
										</select>
									</label>
									<div className="wp-org-add">
										<label>
											Role to add
											<select
												aria-label="Role to add"
												value={roleToAdd}
												disabled={started}
												onChange={(event) => setRoleToAdd(event.target.value)}
											>
												{roles.map((choice) => (
													<option key={choice.name} value={choice.name}>
														{choice.title}
													</option>
												))}
											</select>
										</label>
										<button type="button" disabled={started || !roleToAdd} onClick={addRole}>
											Add role
										</button>
									</div>
									<div className="wp-org-add">
										<label>
											Existing teammate
											<select
												aria-label="Existing teammate"
												value={existingToAdd}
												disabled={started}
												onChange={(event) => setExistingToAdd(event.target.value)}
											>
												<option value="">Choose a person</option>
												{people
													.filter((candidate) => !draft.positions.some((item) => item.id === candidate.character.id))
													.map((candidate) => (
														<option key={candidate.character.id} value={candidate.character.id}>
															{candidate.character.name}
														</option>
													))}
											</select>
										</label>
										<button type="button" disabled={started || !existingToAdd} onClick={addExisting}>
											Add teammate
										</button>
									</div>
									<div className="wp-org-positions">
										{draft.positions.map((item, index) => (
											<button
												type="button"
												key={item.id}
												aria-label={`Planned role: ${role(item.role)?.title ?? item.name} ${index + 1}`}
												aria-pressed={position === item.id}
												onClick={() => setPosition(item.id)}
											>
												<span>{item.manager ? "↳" : "◇"}</span>
												<span>
													<strong>{item.name || role(item.role)?.title || "Existing teammate"}</strong>
													<small>
														{item.existing ? "Existing person · staged" : "Planned role"}
														{item.manager
															? ` · reports to ${draft.positions.find((parentItem) => parentItem.id === item.manager)?.name || role(draft.positions.find((parentItem) => parentItem.id === item.manager)?.role ?? "")?.title || "head"}`
															: " · team head"}
													</small>
												</span>
											</button>
										))}
									</div>
									{currentPosition && (
										<fieldset disabled={started}>
											<legend>Position details</legend>
											<p>{role(currentPosition.role)?.mandate}</p>
											<p className="wp-org-capabilities">
												{role(currentPosition.role)?.manages ? "Manages people" : "Individual contributor"} ·{" "}
												{role(currentPosition.role)?.writes ? "Writes files" : "Advises"}
											</p>
											<label>
												Specialization
												<textarea
													aria-label="Specialization"
													className="wp-specialization"
													aria-describedby="wp-org-specialization-help"
													rows={2}
													value={
														currentPosition.existing
															? (recordedSpecialization ?? "")
															: (currentPosition.specialization ?? "")
													}
													readOnly={currentPosition.existing}
													placeholder={
														currentPosition.existing
															? "No specialization recorded."
															: "Focus on keyboard and screen-reader behavior."
													}
													onChange={(event) => updatePosition({ specialization: event.target.value })}
												/>
											</label>
											<p id="wp-org-specialization-help">
												A focus within this role. All role responsibilities still apply.
											</p>
											<label>
												Name (optional)
												<input
													aria-label="Name (optional)"
													value={currentPosition.name}
													disabled={currentPosition.existing}
													onChange={(event) => updatePosition({ name: event.target.value })}
												/>
											</label>
											{!currentPosition.existing && (
												<label>
													Position goal (optional)
													<textarea
														aria-label="Position goal"
														value={currentPosition.goal}
														onChange={(event) => updatePosition({ goal: event.target.value })}
														placeholder="Use the team task when one is set"
													/>
												</label>
											)}
											{currentPosition.manager !== null && (
												<label>
													Reports to
													<select
														aria-label="Reports to"
														value={currentPosition.manager}
														onChange={(event) => updatePosition({ manager: event.target.value })}
													>
														{draft.positions
															.filter(
																(item) =>
																	role(item.role)?.manages &&
																	!descendants(currentPosition.id, draftParents).includes(item.id),
															)
															.map((item) => (
																<option key={item.id} value={item.id}>
																	{item.name || role(item.role)?.title}
																</option>
															))}
													</select>
												</label>
											)}
											<button
												type="button"
												className="wp-org-remove"
												disabled={!currentPosition.manager}
												onClick={() => {
													const removing = descendants(currentPosition.id, draftParents);
													setDraft({
														...draft,
														positions: draft.positions.filter((item) => !removing.includes(item.id)),
													});
													setPosition(draft.positions[0]?.id);
												}}
											>
												Remove branch
											</button>
										</fieldset>
									)}
								</div>
							</details>
							{!started && setupActions}
						</aside>
					) : selected && active && person ? (
						<aside className="wp-org-inspector">
							<div className="wp-org-reporting">
								{manages(person) && !person.home && (
									<button
										type="button"
										disabled={busy || recruiting}
										onClick={() => {
											setAddingTo(selected);
											setSelected(undefined);
										}}
									>
										Add person
									</button>
								)}
								<label>
									Reports to
									<select
										aria-label="Reports to"
										value={parent}
										disabled={busy || typeof api.orgMove !== "function"}
										onChange={(event) => {
											setParent(event.target.value);
											if (event.target.value !== (person.parent ?? "")) propose(selected, event.target.value || null);
										}}
									>
										<option value="">Independent</option>
										{people
											.filter(
												(candidate) =>
													manages(candidate) && !descendants(selected, parents).includes(candidate.character.id),
											)
											.map((candidate) => (
												<option key={candidate.character.id} value={candidate.character.id}>
													{candidate.character.name}
												</option>
											))}
									</select>
								</label>
								<p className="wp-org-reporting-hint">Choose a manager or Independent, then confirm the branch move.</p>
							</div>
							<PersonProfile key={selected} id={selected} name={person.character.name} onClose={closeProfile} />
						</aside>
					) : null}
				</div>
				{move && (
					<OrgMoveConfirm
						name={people.find((item) => item.character.id === move.person)?.character.name ?? move.person}
						reports={move.branch.length - 1}
						manager={people.find((item) => item.character.id === move.manager)?.character.name}
						error={error}
						busy={busy}
						onCancel={() => {
							setMove(undefined);
							setParent(person?.parent ?? "");
						}}
						onConfirm={() => void applyMove()}
					/>
				)}
			</section>
		</ChatPeople.Provider>
	);
}
