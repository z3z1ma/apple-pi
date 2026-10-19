// The recruiting form (ticket 10), in the theme's words: at the coordinator's desk it recruits a worker who reports to
// that coordinator, at the square's recruiter an independent agent. It asks for a name, a repository (one the world
// knows, or a typed path), and an opening brief, sends `start`, and shows the receipt; the new character then walks
// into its wing or the square.
import { useState, useSyncExternalStore } from "react";
import type { WorldSnapshot } from "../../../src/world.js";
import { lookFor, portraitOf } from "../../looks.js";
import { say } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { PlaceDialog } from "./place-dialog.js";
import {
	knownRepositories,
	type RecruitFor,
	type RecruitProgress,
	recruiterLook,
	recruiting,
} from "./recruit-state.js";
import "./recruit.css";

/** The select's value for a directory typed by hand. */
const TYPED = "";

export function RecruitPanels({ world }: { world: WorldSnapshot | undefined }) {
	const state = useSyncExternalStore(recruiting.subscribe, recruiting.get);
	if (!state.open) return null;
	return <RecruitForm key={state.opening} recruit={state.open} world={world} />;
}

function RecruitForm({ recruit, world }: { recruit: RecruitFor; world: WorldSnapshot | undefined }) {
	const theme = useTheme();
	const worker = recruit.kind === "worker";
	const coordinator = worker ? recruit.coordinator : undefined;
	const [repositories] = useState(() => knownRepositories(world, coordinator?.id));
	const [name, setName] = useState("");
	const [repository, setRepository] = useState(repositories[0]?.path ?? TYPED);
	const [typed, setTyped] = useState("");
	const [brief, setBrief] = useState("");
	const [progress, setProgress] = useState<RecruitProgress>();

	const title = worker
		? say(theme, "recruit-worker-title", { coordinator: coordinator!.name })
		: say(theme, "recruit-independent-title");
	const greeting = say(theme, worker ? "recruit-worker-greeting" : "recruit-independent-greeting");
	const look = theme && (worker ? lookFor(theme, { id: coordinator!.id, role: "coordinator" }) : recruiterLook(theme));
	const host = theme && look ? portraitOf(theme, look, progress?.state === "done" ? "happy" : "neutral") : undefined;
	const hostName = worker ? coordinator!.name : theme?.labels.recruiter;
	const cwd = repository === TYPED ? typed.trim() : repository;
	const ready = name.trim() !== "" && cwd !== "" && progress?.state !== "sending";
	const joined = progress?.sessionId
		? world?.characters.find((character) => character.id === progress.sessionId)
		: undefined;

	const send = async () => {
		if (!ready) return;
		const clean = name.replace(/\s+/g, " ").trim();
		setProgress({ state: "sending", text: say(theme, "recruit-sending", { name: clean }) });
		setProgress(
			await recruiting.send({
				name: clean,
				cwd,
				brief,
				...(coordinator ? { reportsTo: coordinator.id } : {}),
			}),
		);
	};

	return (
		<PlaceDialog label={title} className="aw-recruit" onClose={() => recruiting.close()}>
			<header className="aw-place-head">
				<div className="aw-place-portrait">{host && <img src={host} alt={hostName} draggable={false} />}</div>
				<div className="aw-place-heading">
					<h2>{title.replace(/'/g, "\u2019")}</h2>
					<p className="aw-place-says">&ldquo;{greeting}&rdquo;</p>
				</div>
			</header>
			{progress && progress.state !== "sending" ? (
				<div className="aw-letter aw-letter-sent aw-recruit-sent">
					<span className={`aw-progress aw-progress-${progress.state}`} role="status">
						{progress.text}
					</span>
					<div className="aw-letter-actions">
						{progress.state === "done" ? (
							<>
								<button type="button" className="aw-button" onClick={() => setProgress(undefined)}>
									{say(theme, worker ? "recruit-worker" : "recruit-independent")}
								</button>
								<button
									type="button"
									className="aw-button aw-button-strong"
									onClick={() => (joined ? recruiting.goTo(joined.id) : recruiting.close())}
								>
									{joined ? `Go to ${joined.name}` : "Close"}
								</button>
							</>
						) : (
							<>
								<button type="button" className="aw-button" onClick={() => recruiting.close()}>
									Cancel
								</button>
								<button type="button" className="aw-button aw-button-strong" onClick={() => setProgress(undefined)}>
									Try again
								</button>
							</>
						)}
					</div>
				</div>
			) : (
				<form
					className="aw-letter aw-recruit-form"
					onSubmit={(event) => {
						event.preventDefault();
						void send();
					}}
				>
					<label className="aw-letter-to">
						<span>Name</span>
						<input
							type="text"
							aria-label="Name"
							value={name}
							maxLength={60}
							spellCheck={false}
							autoComplete="off"
							onChange={(event) => setName(event.target.value)}
						/>
					</label>
					<label className="aw-letter-to">
						<span>Repository</span>
						<select aria-label="Repository" value={repository} onChange={(event) => setRepository(event.target.value)}>
							{repositories.map((known) => (
								<option key={known.path} value={known.path}>
									{`${known.name} \u2014 ${known.path}`}
								</option>
							))}
							<option value={TYPED}>Another directory{"\u2026"}</option>
						</select>
					</label>
					{repository === TYPED && (
						<label className="aw-letter-to aw-recruit-path">
							<span>Directory</span>
							<input
								type="text"
								aria-label="Directory"
								placeholder="/path/to/repository"
								value={typed}
								spellCheck={false}
								autoComplete="off"
								onChange={(event) => setTyped(event.target.value)}
							/>
						</label>
					)}
					<label className="aw-letter-to aw-recruit-brief">
						<span>Brief</span>
						<textarea
							aria-label="Brief"
							className="aw-letter-body"
							placeholder={say(theme, "recruit-brief")}
							value={brief}
							rows={5}
							onChange={(event) => setBrief(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
							}}
						/>
					</label>
					<p className="aw-letter-note">
						{worker
							? `Opens in a new tmux window after ${coordinator!.name}'s, reporting to ${coordinator!.name}. The brief is its first prompt.`
							: "Opens in a new tmux window beside your current one, reporting to nobody. The brief is its first prompt."}
					</p>
					<div className="aw-letter-actions">
						<button type="button" className="aw-button" onClick={() => recruiting.close()}>
							Cancel
						</button>
						<button type="submit" className="aw-button aw-button-strong" disabled={!ready}>
							{say(theme, "recruit-send")}
						</button>
					</div>
					{progress?.state === "sending" && (
						<span className="aw-progress aw-progress-sending" role="status">
							{progress.text}
						</span>
					)}
				</form>
			)}
		</PlaceDialog>
	);
}
