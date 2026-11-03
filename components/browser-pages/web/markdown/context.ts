import { createContext, useContext } from "react";

import type { Verdict } from "../../src/page-data";
import type { Selected } from "./marks";
import type { ComposeKind, Pop, State } from "./state";

export interface DocReview {
	session: { token: string; live: boolean; ask: boolean };
	s: State;

	update: (change: (draft: State) => void) => void;
	readOnly: boolean;

	file: string;

	position: (file: string, block: string) => number;

	lineOf: (file: string, block: string) => number;

	reveal: (file: string, block: string, annotation?: string) => void;
	openPop: (kind: ComposeKind, selected?: Selected, extra?: Partial<Pop>) => void;

	savePop: () => void;
	scrollTo: (el: Element | null, offset?: number) => void;
	submit: (verdict: Verdict) => void;
}

export const DocReviewContext = createContext<DocReview | null>(null);

export function useDocReview(): DocReview {
	const review = useContext(DocReviewContext);
	if (!review) throw new Error("DocReviewContext is missing");
	return review;
}
