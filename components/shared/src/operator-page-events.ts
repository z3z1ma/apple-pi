export const OPERATOR_PAGE_CHANNEL = "operator-page:open";

export interface OpenOperatorPage {
	sessionId: string;
	toolCallId: string;
	title: string;
	closed: Promise<void>;
}
