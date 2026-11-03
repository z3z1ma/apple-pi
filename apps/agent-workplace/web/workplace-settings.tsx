import type { ReactNode } from "react";
import { type Palette, THEMES, type Theme } from "./workplace-themes.js";
import "./workplace-settings.css";

export type AppearanceMode = "light" | "dark" | "system";

const MODES: { id: AppearanceMode; label: string }[] = [
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
	{ id: "system", label: "System" },
];

function Preview({ palette }: { palette: Palette }) {
	return (
		<span className="wp-theme-preview" style={{ background: palette.bg }} aria-hidden="true">
			<span className="wp-theme-rail" style={{ background: palette.rail }} />
			<span className="wp-theme-side" style={{ background: palette.sidebar, borderColor: palette.border }}>
				<i style={{ background: palette.accent }} />
				<i style={{ background: palette.muted }} />
				<i style={{ background: palette.muted }} />
			</span>
			<span className="wp-theme-main">
				<i style={{ background: palette.text, width: "70%" }} />
				<i style={{ background: palette.muted, width: "90%" }} />
				<i style={{ background: palette.code, width: "40%" }} />
				<span className="wp-theme-actions">
					<b style={{ background: palette.green }} />
					<b style={{ background: palette.accent }} />
					<b style={{ background: palette.danger }} />
				</span>
			</span>
		</span>
	);
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
	return (
		<section className="wp-settings-section" aria-label={title}>
			<header>
				<h2>{title}</h2>
				{note && <p>{note}</p>}
			</header>
			{children}
		</section>
	);
}

export function WorkplaceSettings({
	theme,
	setTheme,
	mode,
	setMode,
	dark,
	children,
}: {
	theme: Theme;
	setTheme: (id: string) => void;
	mode: AppearanceMode;
	setMode: (mode: AppearanceMode) => void;
	dark: boolean;
	children?: ReactNode;
}) {
	return (
		<main className="wp-settings-page" aria-label="Settings">
			<header className="wp-settings-header">
				<h1>Settings</h1>
			</header>
			<div className="wp-settings-body">
				<Section title="Appearance" note="Every theme has a light and a dark variant. Changes apply at once.">
					<fieldset className="wp-segmented wp-settings-mode" aria-label="Light or dark">
						{MODES.map((each) => (
							<button key={each.id} type="button" aria-pressed={mode === each.id} onClick={() => setMode(each.id)}>
								{each.label}
							</button>
						))}
					</fieldset>
					<fieldset className="wp-theme-grid" aria-label="Theme">
						{THEMES.map((each) => (
							<label key={each.id} className="wp-theme-card" data-checked={each.id === theme.id}>
								<input
									type="radio"
									name="workplace-theme"
									className="wp-visually-hidden"
									aria-label={each.name}
									checked={each.id === theme.id}
									onChange={() => setTheme(each.id)}
								/>
								<Preview palette={dark ? each.dark : each.light} />
								<span className="wp-theme-name">
									<strong>{each.name}</strong>
									<small>{each.note}</small>
								</span>
							</label>
						))}
					</fieldset>
				</Section>
				{children}
			</div>
		</main>
	);
}
