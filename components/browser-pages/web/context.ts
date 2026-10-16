import { createContext, useContext } from "react";

import type { Model } from "./model";
import type { State } from "./state";

export interface Review {
	m: Model;
	s: State;
	/** Applies a change to a copy of the state. */
	update: (change: (draft: State) => void) => void;
	readOnly: boolean;
	/** Whether the agent can answer a question now. */
	canAsk: boolean;
	/** Sends the open composer's text to the agent as a question about its lines. */
	ask: () => void;
	/** Asks a question again after it failed. */
	retry: (id: string) => void;
}

export const ReviewContext = createContext<Review | null>(null);

export function useReview(): Review {
	const review = useContext(ReviewContext);
	if (!review) throw new Error("ReviewContext is missing");
	return review;
}
