import type { Culture, Pronouns } from "./culture.js";
import { AFRICA } from "./cultures/africa.js";
import { ANGLOSPHERE } from "./cultures/anglosphere.js";
import { CENTRAL_EASTERN_EUROPE } from "./cultures/central-eastern-europe.js";
import { EAST_ASIA } from "./cultures/east-asia.js";
import { IBERIA_LATIN_AMERICA } from "./cultures/iberia-latin-america.js";
import { MIDDLE_EAST } from "./cultures/middle-east.js";
import { NORDIC } from "./cultures/nordic.js";
import { SOUTH_ASIA } from "./cultures/south-asia.js";
import { SOUTHEAST_ASIA } from "./cultures/southeast-asia.js";
import { WESTERN_EUROPE } from "./cultures/western-europe.js";

export const CULTURES: readonly Culture[] = [
	...ANGLOSPHERE,
	...WESTERN_EUROPE,
	...IBERIA_LATIN_AMERICA,
	...NORDIC,
	...CENTRAL_EASTERN_EUROPE,
	...MIDDLE_EAST,
	...SOUTH_ASIA,
	...EAST_ASIA,
	...SOUTHEAST_ASIA,
	...AFRICA,
];

export interface Identity {
	name: string;
	people: string;
	place: string;
	pronouns: Pronouns;
}

type Random = () => number;

function pick<T>(list: readonly T[], random: Random): T {
	return list[Math.floor(random() * list.length)] as T;
}

export function drawIdentity(culture: Culture, random: Random): Identity {
	const given = (["she", "he", "they"] as const).flatMap((pronouns) =>
		culture.given[pronouns].map((name) => ({ name, pronouns })),
	);
	const person = pick(given, random);
	const family =
		"fathers" in culture.family
			? `${pick(culture.family.fathers, random)}${culture.family.suffix[person.pronouns]}`
			: pick(culture.family, random);
	return {
		name: `${person.name} ${family}`,
		people: culture.people,
		place: pick(culture.places, random),
		pronouns: person.pronouns,
	};
}

const firstName = (name: string) => name.split(" ")[0]!.toLowerCase();

export function pickIdentity(
	taken: { names: Iterable<string>; firstNames: Iterable<string> },
	random: Random = Math.random,
): Identity {
	const names = new Set([...taken.names].map((name) => name.toLowerCase()));
	const firstNames = new Set([...taken.firstNames].map(firstName));
	const draw = () => drawIdentity(pick(CULTURES, random), random);
	let identity = draw();
	for (const fresh of [
		(candidate: Identity) => !names.has(candidate.name.toLowerCase()) && !firstNames.has(firstName(candidate.name)),
		(candidate: Identity) => !names.has(candidate.name.toLowerCase()),
	])
		for (let attempt = 0; attempt < 200; attempt++) {
			if (fresh(identity)) return identity;
			identity = draw();
		}
	return identity;
}
