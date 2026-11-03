import { useEffect, useState } from "react";

export type IssuesSource = "jira" | "github";
const KEY = "workplace-issues-source";
const CHANGED = "workplace-issues-source-changed";
export const CONNECTIONS_CHANGED = "workplace-connections-changed";

function storedSource(): IssuesSource | undefined {
	const value = localStorage.getItem(KEY);
	return value === "jira" || value === "github" ? value : undefined;
}

export function useIssuesSource(enabled = true) {
	const [source, setSource] = useState<IssuesSource | undefined>(storedSource);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!enabled) return;
		let current = true;
		let generation = 0;
		const load = async () => {
			const request = ++generation;
			const saved = storedSource();
			if (saved) {
				setSource(saved);
				setError("");
				return;
			}
			try {
				const status = await window.agentWorkplace.credentialStatus();
				if (current && request === generation) {
					setSource(status.atlassian ? "jira" : "github");
					setError("");
				}
			} catch (error) {
				if (current && request === generation) setError(error instanceof Error ? error.message : String(error));
			}
		};
		const refresh = () => void load();
		refresh();
		window.addEventListener(CHANGED, refresh);
		window.addEventListener("storage", refresh);
		window.addEventListener(CONNECTIONS_CHANGED, refresh);
		return () => {
			current = false;
			window.removeEventListener(CHANGED, refresh);
			window.removeEventListener("storage", refresh);
			window.removeEventListener(CONNECTIONS_CHANGED, refresh);
		};
	}, [enabled]);
	return {
		source,
		error,
		chooseSource(value: IssuesSource) {
			localStorage.setItem(KEY, value);
			setSource(value);
			window.dispatchEvent(new Event(CHANGED));
		},
	};
}
