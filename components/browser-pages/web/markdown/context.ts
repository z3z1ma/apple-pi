import { createContext, useContext } from "react";

import type { MarkdownReviewPage, Verdict } from "../../src/page-data";
import type { Selected } from "./marks";
import type { ComposeKind, Pop, State } from "./state";

export interface DocReview {
	page: MarkdownReviewPage;
	s: State;
	/** Applies a change to a copy of the state. */
	update: (change: (draft: State) => void) => void;
	readOnly: boolean;
	/** Block id to its position in the document. */
	order: Map<string, number>;
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
