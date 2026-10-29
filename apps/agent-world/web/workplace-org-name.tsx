import { useEffect, useRef, useState } from "react";
import { organizationName, saveOrganizationName, useWorkplaceNames } from "./workplace-names.js";
import "./workplace-org-name.css";

export function OrgNameEditor({
	id,
	name,
	defaultName = `${name} organization`,
	heading,
}: {
	id: string;
	name: string;
	defaultName?: string;
	heading?: "h1" | "h2";
}) {
	useWorkplaceNames();
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState("");
	const [error, setError] = useState<string>();
	const label = organizationName(id, name, defaultName);
	const Heading = heading ?? "strong";
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (editing) input.current?.focus();
	}, [editing]);
	return editing ? (
		<form
			className="wp-org-name-editor"
			aria-label="Rename organization"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					setEditing(false);
					setError(undefined);
				}
			}}
			onSubmit={(event) => {
				event.preventDefault();
				try {
					saveOrganizationName(id, value);
					setEditing(false);
					setError(undefined);
				} catch (failure) {
					setError(`Could not save this display name: ${String(failure)}`);
				}
			}}
		>
			<label>
				Organization name
				<input
					ref={input}
					aria-label="Organization name"
					value={value}
					onChange={(event) => setValue(event.target.value)}
				/>
			</label>
			<p>Display name on this device only. Leave blank to use {defaultName}.</p>
			<div>
				<button type="submit">Save name</button>
				<button
					type="button"
					onClick={() => {
						setEditing(false);
						setError(undefined);
					}}
				>
					Cancel
				</button>
			</div>
			{error && <p role="alert">{error}</p>}
		</form>
	) : (
		<div className="wp-org-name">
			<Heading>{label}</Heading>
			<button
				type="button"
				aria-label={`Rename organization: ${label}`}
				onClick={() => {
					setValue(label);
					setEditing(true);
				}}
			>
				Rename
			</button>
		</div>
	);
}
