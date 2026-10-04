import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ActiveWorkSource, ActiveWorkTheme } from "../../shared/src/active-work.js";
import { callLabel, type ExecActivitySnapshot, formatDuration, safeText } from "./ui.js";
import type { ExecInvocation } from "./work-panel.js";

const displayText = (text: string): string => safeText(text).replace(/\s+/g, " ").trim();

/** One passive unit per running program; its host calls and model workers stay inside that unit. */
function renderProgram(activity: ExecActivitySnapshot, width: number, theme: ActiveWorkTheme, frame: string): string[] {
	const calls = activity.calls;
	const done = calls.filter((call) => call.status !== "queued" && call.status !== "running").length;
	const running = calls.filter((call) => call.status === "running");
	const queued = calls.filter((call) => call.status === "queued").length;
	const stats = [
		calls.length > 0 ? `${done}/${calls.length} calls` : "starting",
		running.length > 0 ? `${running.length} running` : "",
		queued > 0 ? `${queued} queued` : "",
		formatDuration(Date.now() - activity.startedAt),
	]
		.filter(Boolean)
		.join(" · ");
	const description = activity.description ? `  ${theme.fg("muted", displayText(activity.description))}` : "";
	const current = running.at(-1) ?? calls.at(-1);
	return [
		truncateToWidth(
			`${theme.fg("dim", "├─")} ${theme.fg("accent", frame)} ${theme.bold("Pi Exec")} ${theme.fg("muted", displayText(activity.name))}${description} ${theme.fg("dim", `· ${stats}`)}`,
			width,
		),
		truncateToWidth(
			`${theme.fg("dim", "│  ")}  ${theme.fg("dim", `⎿  ${current ? callLabel(current) : "starting…"}`)}`,
			width,
		),
	];
}

export function createExecActiveWorkSource(invocations: () => Iterable<ExecInvocation>): ActiveWorkSource {
	return {
		key: "pi-exec",
		statusKey: "pi-exec",
		countLabel: "exec",
		getEntries: () =>
			[...invocations()]
				.filter((invocation) => invocation.status === "running")
				.map((invocation) => ({
					id: invocation.id,
					render: (width, theme, frame) => renderProgram(invocation.activity, width, theme, frame),
				})),
	};
}
