import type { AgentWorkplaceApi, Character, RecruitRequest, RoleChoice, WorldSnapshot } from "../../../src/world.js";
import { say, type Theme } from "../../theme.js";
import { themeStore } from "../../theme-store.js";
import type { ViewStore } from "../../view-state.js";
import { onePanel } from "../one-panel.js";
import type { Progress } from "./place-panels.js";

export type RecruitFor = { kind: "worker"; coordinator: Pick<Character, "id" | "name"> } | { kind: "independent" };

export interface RecruitState {
	open?: RecruitFor;

	opening: number;

	roles?: RoleChoice[];
	api?: Pick<AgentWorkplaceApi, "recruit" | "roles">;
	view?: ViewStore;
}

export type RecruitProgress = Progress & { sessionId?: string };

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
	connect(api: Pick<AgentWorkplaceApi, "recruit" | "roles">, view: ViewStore) {
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

	goTo(characterId: string) {
		recruiting.close();
		state.view?.intend({ kind: "go-to", character: characterId });
	},

	async send(request: RecruitRequest): Promise<RecruitProgress> {
		const { api, view } = state;
		if (!api) return { state: "failed", text: "Agent Workplace is not connected." };
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
