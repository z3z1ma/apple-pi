import type { AutocompleteItem } from "@earendil-works/pi-tui";

export interface ParsedArgv {
	action: string;
	positional: string[];
	options: Record<string, number | string>;
}

export function parseArgv(
	input: string,
	spec: {
		defaultAction?: string;
		actions?: Iterable<string>;
		numericOptions?: Iterable<string>;
		stringOptions: Iterable<string>;
		unknownOption?: (rawName: string) => string;
	},
): ParsedArgv {
	const tokens =
		input.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^(?:"(.*)"|'(.*)')$/, "$1$2")) ?? [];
	const knownActions = spec.actions ? new Set(spec.actions) : undefined;
	let action: string | undefined;
	const positional: string[] = [];
	const options: Record<string, number | string> = {};
	const numericOptions = new Set(spec.numericOptions ?? []);
	const stringOptions = new Set(spec.stringOptions);
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			if (action === undefined && (knownActions === undefined || knownActions.has(token))) action = token;
			else positional.push(token);
			continue;
		}
		const [rawName, inline] = token.slice(2).split("=", 2);
		const name = rawName.replace(/-/g, "_");
		if (!numericOptions.has(name) && !stringOptions.has(name)) {
			throw new Error(spec.unknownOption?.(rawName) ?? `Unknown option: --${rawName}`);
		}
		const rawValue = inline ?? tokens[++index];
		if (!rawValue) throw new Error(`--${rawName} requires a value`);
		if (numericOptions.has(name)) {
			const value = Number(rawValue);
			if (!Number.isFinite(value)) throw new Error(`--${rawName} requires a number`);
			options[name] = value;
		} else {
			options[name] = rawValue;
		}
	}
	return { action: action ?? spec.defaultAction ?? "", positional, options };
}

export function matchingCompletions(prefix: string, items: AutocompleteItem[]): AutocompleteItem[] | null {
	const matches = items.filter((item) => item.value.startsWith(prefix));
	return matches.length ? matches : null;
}

export function completeUnusedFlags(
	input: string,
	flags: Array<{ name: string; description: string }>,
	awaitingValue: Iterable<string> = [],
): AutocompleteItem[] | null {
	const tokens = input.trim().split(/\s+/);
	if (new Set(awaitingValue).has(tokens.at(-1) ?? "")) return null;
	const partial = input.endsWith(" ") ? "" : (tokens.at(-1) ?? "");
	const base = partial ? input.slice(0, -partial.length) : input;
	return matchingCompletions(
		input,
		flags
			.filter(({ name }) => !tokens.includes(name))
			.map(({ name, description }) => ({
				value: `${base}${name} `,
				label: name,
				description,
			})),
	);
}
