import { createRoot } from "react-dom/client";

import type { CodeReviewPage } from "../src/page-data";
import { CodeReview } from "./app";
import "./styles.css";

const data = JSON.parse(document.getElementById("page-data")?.textContent ?? "null") as CodeReviewPage | null;
const root = createRoot(document.getElementById("root")!);
if (data?.kind === "code-review") {
	document.title = `Review · ${data.title}`;
	root.render(<CodeReview page={data} />);
} else root.render(<p className="empty">This page has no data.</p>);
