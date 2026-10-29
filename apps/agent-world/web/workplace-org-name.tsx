import { useEffect, useRef, useState } from "react";
import { useWorkplaceMenu } from "./workplace-context-menu.js";
import { organizationName, saveOrganizationName, useWorkplaceNames } from "./workplace-names.js";
import "./workplace-org-name.css";

type NameProps = { id: string; name: string; defaultName?: string };

export function OrganizationNameForm({
	id,
	name,
	defaultName = `${name} organization`,
	onClose,
}: NameProps & { onClose: () => void }) {
	const [value, setValue] = useState(() => organizationName(id, name, defaultName));
	const [error, setError] = useState<string>();
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);
	return (
		<form
			className="wp-org-name-editor"
			aria-label="Rename organization"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}
			}}
			onSubmit={(event) => {
				event.preventDefault();
				try {
					saveOrganizationName(id, value);
					onClose();
				} catch (failure) {
					setError(`Could not save this display name: ${String(failure)}`);
				}
			}}
		>
			<input
				ref={input}
				aria-label="Organization name"
				title={`Device-local display name. Leave blank to use ${defaultName}.`}
				value={value}
				onChange={(event) => setValue(event.target.value)}
			/>
			<button type="submit" aria-label="Save name" title="Save name">
				&#10003;
			</button>
			<button type="button" aria-label="Cancel" title="Cancel" onClick={onClose}>
				&#215;
			</button>
			{error && <p role="alert">{error}</p>}
		</form>
	);
}

export function OrgNameEditor({
	id,
	name,
	defaultName = `${name} organization`,
	heading,
}: NameProps & { heading?: "h1" | "h2" }) {
	useWorkplaceNames();
	const openMenu = useWorkplaceMenu();
	const [editing, setEditing] = useState(false);
	const title = useRef<HTMLElement>(null);
	const label = organizationName(id, name, defaultName);
	const Heading = heading ?? "strong";
	const items = [{ label: "Rename", onSelect: () => setEditing(true) }];
	const close = () => {
		setEditing(false);
		requestAnimationFrame(() => title.current?.focus());
	};
	return editing ? (
		<OrganizationNameForm id={id} name={name} defaultName={defaultName} onClose={close} />
	) : (
		<div className="wp-org-name">
			<Heading
				ref={(element) => {
					title.current = element;
				}}
				tabIndex={0}
				aria-haspopup="menu"
				title="Right-click to rename; Shift+F10 opens actions"
				onContextMenu={(event) => openMenu(event, items)}
				onKeyDown={(event) => openMenu(event, items)}
			>
				{label}
			</Heading>
		</div>
	);
}
