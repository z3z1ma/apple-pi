import { useCallback, useLayoutEffect, useRef } from "react";
import "./workplace-world.css";

export function WorkplaceWorld({ active }: { active: boolean }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const notify = useCallback(() => {
		const child = frame.current?.contentWindow;
		child?.dispatchEvent(new Event("world-visibilitychange"));
		if (active) child?.dispatchEvent(new Event("resize"));
	}, [active]);
	useLayoutEffect(notify, [notify]);
	return <iframe ref={frame} className="wp-world-frame" title="Agent World" src="?world&embedded=1" onLoad={notify} />;
}
