import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import type { PageData } from "../src/page-data";

type PageOf<K extends PageData["kind"]> = Extract<PageData, { kind: K }>;

/** Renders the data the server embedded in the page, when it is the kind of page this file was built for. */
export function mount<K extends PageData["kind"]>(kind: K, render: (page: PageOf<K>) => ReactNode): void {
	const data = JSON.parse(document.getElementById("page-data")?.textContent ?? "null") as PageData | null;
	const root = createRoot(document.getElementById("root")!);
	if (data?.kind !== kind) {
		root.render(<p className="empty">This page has no data.</p>);
		return;
	}
	document.title = `Review · ${data.title}`;
	root.render(render(data as PageOf<K>));
}
