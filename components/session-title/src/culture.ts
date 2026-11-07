export type Pronouns = "she" | "he" | "they";

export interface Culture {
	people: string;
	places: readonly string[];
	given: Readonly<Record<Pronouns, readonly string[]>>;
	family:
		| readonly string[]
		| { readonly fathers: readonly string[]; readonly suffix: Readonly<Record<Pronouns, string>> };
}
