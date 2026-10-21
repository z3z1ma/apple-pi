// Hiring a new person (ticket 10): the form opened at a manager's desk (a person who reports to that manager) or at
// the square's recruiter (an independent one), the role catalog it offers, and what it sends. The world and the form
// act through here; `main.tsx` connects the backend API and the view store. Each change replaces the state object,
// as useSyncExternalStore needs.
import type { AgentWorldApi, Character, RecruitRequest, RoleChoice, WorldSnapshot } from "../../../src/world.js";
import { say, type Theme } from "../../theme.js";
import { themeStore } from "../../theme-store.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";
import type { Progress } from "./place-panels.js";

/** Who the form recruits: a worker for a coordinator, or an independent agent. */
export type RecruitFor = { kind: "worker"; coordinator: Pick<Character, "id" | "name"> } | { kind: "independent" };

export interface RecruitState {
	open?: RecruitFor;
	/** Counts each opening, so opening again starts afresh. */
	opening: number;
	/** The catalog, read as the form opens; undefined until it arrives. */
	roles?: RoleChoice[];
	api?: Pick<AgentWorldApi, "recruit" | "roles">;
	view?: ViewStore;
}

/** What became of a recruit: sending, done (with the new session's id), or failed with why. */
export type RecruitProgress = Progress & { sessionId?: string };

/** A repository the form offers: its directory, and what the world calls it (a wing's banner). */
export interface KnownRepository {
	path: string;
	name: string;
}

let state: RecruitState = { opening: 0 };
const listeners = new Set<() => void>();
const update = (change: Partial<RecruitState>) => {
	state = { ...state, ...change };
	for (const listener of listeners) listener();
};

const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/**
 * The look the square's recruiter wears: the one its place data names, else the pack's first `recruiter` look, else
 * the first townsperson's (a pack painted before recruiters had their own look).
 */
export function recruiterLook(theme: Theme): string | undefined {
	const named = theme.places.square?.recruiter?.look;
	if (named && theme.looks[named]) return named;
	const of = (role: string) =>
		Object.entries(theme.looks)
			.filter(([, look]) => look.role === role)
			.map(([name]) => name)
			.sort()[0];
	return of("recruiter") ?? of("townsfolk");
}

/**
 * The repositories the world knows, as the form offers them: the coordinator's own wings first (for a worker), then
 * every other headquarters' wings, then the repositories awake agents work in. Each once.
 */
export function knownRepositories(world: WorldSnapshot | undefined, coordinator?: string): KnownRepository[] {
	const found = new Map<string, KnownRepository>();
	const headquarters = [...(world?.headquarters ?? [])].sort(
		(a, b) => Number(b.id === coordinator) - Number(a.id === coordinator),
	);
	for (const hq of headquarters)
		for (const wing of hq.wings)
			if (!wing.team && !found.has(wing.repository))
				found.set(wing.repository, { path: wing.repository, name: wing.name });
	for (const character of world?.characters ?? []) {
		const repository = character.facts?.git?.repository;
		if (repository && !found.has(repository)) found.set(repository, { path: repository, name: base(repository) });
	}
	return [...found.values()];
}

export const recruiting = {
	get: () => state,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	connect(api: Pick<AgentWorldApi, "recruit" | "roles">, view: ViewStore) {
		update({ api, view });
	},
	open(recruit: RecruitFor) {
		onePanel.opening("recruit");
		const opening = state.opening + 1;
		update({ open: recruit, opening, roles: undefined });
		void state.api?.roles().then(
			(roles) => {
				if (state.opening === opening) update({ roles });
			},
			() => {
				if (state.opening === opening) update({ roles: [] });
			},
		);
	},
	close() {
		if (state.open) update({ open: undefined });
	},
	/** Close the form and go to the new agent: travel to its place (its wing, or the square) and walk up to it. */
	goTo(characterId: string) {
		recruiting.close();
		state.view?.intend({ kind: "go-to", character: characterId });
	},
	/** Send `start` for the new agent; resolves with what the form shows, and says it in the chatbox. */
	async send(request: RecruitRequest): Promise<RecruitProgress> {
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent World is not connected." };
		try {
			const receipt = await api.recruit(request);
			const name = request.name.replace(/\s+/g, " ").trim();
			if (!receipt.ok) {
				view?.notify(receipt.reason);
				return { state: "failed", text: receipt.reason };
			}
			const joined = say(themeStore.get(), "recruit-joined", { name });
			const text = receipt.stage === "applied" ? joined : (receipt.note ?? "Its window is opening.");
			view?.notify(receipt.stage === "applied" ? joined : `${name}: ${text}`);
			return { state: "done", text, sessionId: receipt.sessionId };
		} catch (error) {
			return { state: "failed", text: String((error as Error)?.message ?? error) };
		}
	},
};

onePanel.closes("recruit", () => recruiting.close());
