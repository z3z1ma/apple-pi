import { createContext, useContext } from "react";

import type { Verdict } from "../../src/page-data";
import type { Selected } from "./marks";
import type { ComposeKind, Pop, State } from "./state";

export interface DocReview {
	session: { token: string; live: boolean; ask: boolean };
	s: State;
	/** Applies a change to a copy of the state. */
	update: (change: (draft: State) => void) => void;
	readOnly: boolean;
	/** The document on screen; empty when none is. */
	file: string;
	/** A block's place across the whole review, for review order. */
	position: (file: string, block: string) => number;
	/** The source line a block starts on. */
	lineOf: (file: string, block: string) => number;
	/** Shows a block, or an annotation's highlight in it, opening its document first when needed. */
	reveal: (file: string, block: string, annotation?: string) => void;
	openPop: (kind: ComposeKind, selected?: Selected, extra?: Partial<Pop>) => void;
	/** Saves the open popover's text as an annotation, a question, or the overall comment. */
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
