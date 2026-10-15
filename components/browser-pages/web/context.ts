import { createContext, useContext } from "react";

import type { Model } from "./model";
import type { State } from "./state";

export interface Review {
	m: Model;
	s: State;
	/** Applies a change to a copy of the state. */
	update: (change: (draft: State) => void) => void;
	readOnly: boolean;
}

export const ReviewContext = createContext<Review | null>(null);

export function useReview(): Review {
	const review = useContext(ReviewContext);
	if (!review) throw new Error("ReviewContext is missing");
	return review;
}
