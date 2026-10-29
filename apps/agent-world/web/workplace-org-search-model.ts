import type { WorldSnapshot } from "../src/world.js";

/** Search recorded metadata across teams; reading a task remains a separate operator action. */
export function searchOrg(world: WorldSnapshot, query: string) {
	const people = [
		...world.characters
			.filter((person) => !person.facts?.temporary)
			.map((person) => ({
				id: person.id,
				name: person.name,
				role: person.facts?.title ?? "Pi session",
				manager: person.facts?.reportsTo ?? null,
				task: person.facts?.task?.title ?? "",
				home: false,
			})),
		...(world.dormant ?? [])
			.filter(
				(person) => !person.temporary && !person.retiredAt && !world.characters.some((awake) => awake.id === person.id),
			)
			.map((person) => ({
				id: person.id,
				name: person.name,
				role: person.title ?? "Pi session",
				manager: person.reportsTo,
				task: person.task?.title ?? "",
				home: true,
			})),
	];
	const byId = new Map(people.map((person) => [person.id, person]));
	const nameOf = (id: string) => byId.get(id)?.name ?? world.headquarters.find((team) => team.id === id)?.name ?? id;
	const rootOf = (id: string) => {
		const seen = new Set<string>();
		while (!seen.has(id)) {
			seen.add(id);
			const manager = byId.get(id)?.manager;
			if (!manager || !byId.has(manager)) return id;
			id = manager;
		}
		return id;
	};
	const needle = query.trim().toLocaleLowerCase();
	const matches = (...fields: string[]) =>
		needle.length > 0 && fields.some((field) => field.toLocaleLowerCase().includes(needle));
	return {
		people: people
			.map((person) => {
				const team = rootOf(person.id);
				return { ...person, team, teamName: nameOf(team) };
			})
			.filter((person) => matches(person.id, person.name, person.role, person.task, person.teamName)),
		work: (world.workplace?.workHistory ?? [])
			.map((task) => ({ ...task, organizationName: nameOf(task.headquarters) }))
			.filter((task) =>
				matches(task.id, task.title, task.project, task.status ?? "", task.headquarters, task.organizationName),
			),
	};
}
