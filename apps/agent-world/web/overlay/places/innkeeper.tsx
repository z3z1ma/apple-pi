// The innkeeper's register (ticket 15), in the theme's words: every dormant agent, the most recently stopped first, with its repository, its
// last ledger task, how long it has slept, and where (at a table, in a bed, or upstairs once the inn's spots are full).
// From a row the operator reads its last conversation or wakes it; the wake's receipt shows on the row.
import { useMemo, useState } from "react";
import type { DormantAgent, WorldSnapshot } from "../../../src/world.js";
import { lookFor, portraitOf } from "../../looks.js";
import { say, type Theme } from "../../theme.js";
import { useTheme } from "../../theme-store.js";
import { ago } from "../interface/model.js";
import { PlaceDialog } from "./place-dialog.js";
import { placeActions, placePanels } from "./place-panels.js";

const base = (path: string | null) => (path ? (path.split("/").filter(Boolean).pop() ?? path) : null);

/** Where each sleeper is: at a table, in a bed, or upstairs (more sleepers than the inn has spots). */
function wherePlaces(theme: Theme | undefined, spots: number, beds: Set<number>) {
	return (index: number) => ({
		upstairs: index >= spots,
		text: say(theme, index >= spots ? "sleeper-upstairs" : beds.has(index) ? "sleeper-bed" : "sleeper-table"),
	});
}

export function InnkeeperRegister({ world }: { world: WorldSnapshot | undefined }) {
	const { wakes } = placePanels.get();
	const theme = useTheme();
	const [search, setSearch] = useState("");
	const dormant = world?.dormant ?? [];
	const inn = theme?.places.inn;
	const spots = inn?.spots.length ?? 0;
	const beds = useMemo(
		() => new Set((inn?.overlaySlots ?? []).filter((slot) => slot.kind === "bed").map((slot) => slot.spot)),
		[inn],
	) as Set<number>;
	const where = wherePlaces(theme, spots, beds);
	const here = Math.min(spots, dormant.length);
	const upstairs = dormant.length - here;

	const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const rows = dormant
		.map((agent, index) => ({ agent, index }))
		.filter(({ agent }) => {
			if (!words.length) return true;
			const text = [agent.name, agent.id, agent.repository, agent.task?.title, agent.cwd].join(" ").toLowerCase();
			return words.every((word) => text.includes(word));
		});

	const host = theme ? portraitOf(theme, "innkeeper", dormant.length ? "happy" : "neutral") : undefined;
	const greeting = dormant.length
		? say(theme, "register-greeting", {
				here,
				upstairs: upstairs ? say(theme, "register-upstairs", { count: upstairs }) : "",
			})
		: say(theme, "register-empty");
	const title = say(theme, "register-title");

	return (
		<PlaceDialog label={title} className="aw-register">
			<header className="aw-place-head">
				<div className="aw-place-portrait">
					{host && <img src={host} alt={theme?.labels.innkeeper} draggable={false} />}
				</div>
				<div className="aw-place-heading">
					<h2>{title.replace(/'/g, "\u2019")}</h2>
					<p className="aw-place-says">&ldquo;{greeting}&rdquo;</p>
				</div>
			</header>
			{dormant.length > 0 && (
				<input
					type="search"
					className="aw-place-search"
					placeholder="Search by name, repository, or task"
					aria-label={say(theme, "register-search")}
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
			)}
			<ul className="aw-place-list aw-register-list" aria-label={say(theme, "asleep-here")}>
				{rows.map(({ agent, index }) => (
					<SleeperRow key={agent.id} agent={agent} where={where(index)} progress={wakes[agent.id]} />
				))}
			</ul>
			{dormant.length > 0 && rows.length === 0 && <p className="aw-place-empty">Nobody here by that name.</p>}
		</PlaceDialog>
	);
}

function SleeperRow({
	agent,
	where,
	progress,
}: {
	agent: DormantAgent;
	where: { upstairs: boolean; text: string };
	progress: ReturnType<typeof placePanels.get>["wakes"][string] | undefined;
}) {
	const theme = useTheme();
	const portrait = theme ? portraitOf(theme, lookFor(theme, agent)) : undefined;
	const former = agent.retiredAt != null;
	const repository = base(agent.repository);
	const slept = ago(agent.stoppedAt);
	return (
		<li className="aw-register-row">
			<span className="aw-register-face">{portrait && <img src={portrait} alt="" draggable={false} />}</span>
			<span className="aw-register-text">
				<span className="aw-register-name">
					{agent.name}
					{agent.title && <small className="aw-register-title">{agent.title}</small>}
					<small className={where.upstairs ? "aw-register-where aw-upstairs" : "aw-register-where"}>{where.text}</small>
				</span>
				{former && (
					<span className="aw-register-left" title={agent.retiredReason ?? undefined}>
						{say(theme, "retired")}
						{agent.retiredReason && `: ${agent.retiredReason}`}
					</span>
				)}
				<span className="aw-register-detail">
					{repository ?? base(agent.cwd) ?? "No repository"}
					{" \u00b7 "}
					{agent.task ? (
						<>
							{agent.task.title}
							{agent.task.status && <span className="aw-register-status">{agent.task.status}</span>}
						</>
					) : (
						<span className="aw-register-quiet">No focused task</span>
					)}
				</span>
				{progress && (
					<span className={`aw-progress aw-progress-${progress.state}`} role="status">
						{progress.text}
					</span>
				)}
			</span>
			<span className="aw-register-side">
				{slept && <span className="aw-register-time">{slept === "now" ? "just now" : `asleep ${slept}`}</span>}
				<span className="aw-register-actions">
					<button
						type="button"
						className="aw-button"
						aria-label={`Read ${agent.name}'s last conversation`}
						title={`Read ${agent.name}'s last conversation`}
						onClick={() => placeActions.readConversation(agent)}
					>
						Read
					</button>
					{!former && (
						<button
							type="button"
							className="aw-button aw-button-strong"
							aria-label={`Wake ${agent.name}`}
							title={`Wake ${agent.name} in a new tmux window`}
							disabled={progress?.state === "sending"}
							onClick={() => void placeActions.wake(agent)}
						>
							Wake
						</button>
					)}
				</span>
			</span>
		</li>
	);
}
