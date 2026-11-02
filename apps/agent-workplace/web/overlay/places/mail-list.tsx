// Mail as the rookery and the Mail tab list it: who wrote to whom, when, a preview, and whether it arrived (delivered
// once the receiver's transcript holds it, waiting until then, as for a sleeper). A row opens to the whole letter.
import { useState } from "react";
import type { MailItem } from "../../../src/world.js";
import { ago } from "../interface/model.js";

const STATE: Record<MailItem["state"], string> = { delivered: "Delivered", waiting: "Waiting", failed: "Failed" };

const clock = (at: number) => {
	const d = new Date(at);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function MailList({ mail, label, compact }: { mail: MailItem[]; label: string; compact?: boolean }) {
	const [open, setOpen] = useState<string>();
	return (
		<ul className={`aw-mail-list${compact ? " aw-mail-compact" : ""}`} aria-label={label}>
			{mail.map((item) => (
				<MailRow
					key={item.id}
					item={item}
					open={open === item.id}
					onToggle={() => setOpen(open === item.id ? undefined : item.id)}
				/>
			))}
		</ul>
	);
}

function MailRow({ item, open, onToggle }: { item: MailItem; open: boolean; onToggle: () => void }) {
	const when = ago(item.sentAt);
	return (
		<li className={`aw-mail-row aw-mail-${item.state}${open ? " aw-mail-open" : ""}`}>
			<button type="button" className="aw-mail-main" aria-expanded={open} onClick={onToggle} title={item.body}>
				<span className="aw-mail-who">
					<span className={item.from === "operator" ? "aw-mail-name aw-mail-you" : "aw-mail-name"}>
						{item.fromName}
					</span>
					<span className="aw-mail-arrow" aria-hidden="true">
						{"\u2192"}
					</span>
					<span className="aw-sr"> to </span>
					<span className="aw-mail-name">{item.toName}</span>
				</span>
				<span className="aw-mail-meta">
					<time dateTime={new Date(item.sentAt).toISOString()} title={new Date(item.sentAt).toLocaleString()}>
						{when === "now" ? clock(item.sentAt) : when}
					</time>
					<span className={`aw-mail-state aw-mail-state-${item.state}`} title={item.reason ?? undefined}>
						{STATE[item.state]}
					</span>
				</span>
				<span className="aw-mail-body">{item.body}</span>
			</button>
		</li>
	);
}
