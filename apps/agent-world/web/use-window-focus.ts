import { useEffect, useState } from "react";

export function useWindowFocus() {
	const [focused, setFocused] = useState(() => document.hasFocus() && document.visibilityState !== "hidden");
	useEffect(() => {
		const focus = () => setFocused(document.visibilityState !== "hidden");
		const blur = () => setFocused(false);
		const visibility = () => setFocused(document.hasFocus() && document.visibilityState !== "hidden");
		window.addEventListener("focus", focus);
		window.addEventListener("blur", blur);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			window.removeEventListener("focus", focus);
			window.removeEventListener("blur", blur);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, []);
	return focused;
}
