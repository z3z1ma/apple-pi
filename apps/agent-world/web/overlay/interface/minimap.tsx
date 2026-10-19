// The minimap at the top right: the whole current place, its painting scaled to fit, with a dot for each agent,
// townsperson, and the avatar, the part on screen outlined, and an arrow at the edge where the way on to the next place
// out of doors leaves (the square's exit to the street). Clicking it asks the world to walk there.
import type { WorldSnapshot } from "../../../src/world.js";
import type { MinimapView } from "../../view-state.js";
import { attentionOf } from "./model.js";

/** The map's drawing area inside its frame, in CSS px. */
const WIDTH = 204;
const HEIGHT = 136;

export function Minimap({
	map,
	world,
	onWalk,
}: {
	map: MinimapView | undefined;
	world: WorldSnapshot | undefined;
	onWalk: (place: string, at: [number, number]) => void;
}) {
	if (!map) return <div className="aw-frame aw-minimap" />;
	// The place fitted inside the frame, centred.
	const scale = Math.min(WIDTH / map.cols, HEIGHT / map.rows);
	const width = map.cols * scale;
	const height = map.rows * scale;
	const left = (WIDTH - width) / 2;
	const top = (HEIGHT - height) / 2;
	const strips = map.strips ?? [{ from: 0, to: map.paintingCols, at: 0 }];
	const people = new Map((world?.characters ?? []).map((character) => [character.id, character]));
	return (
		<div className="aw-frame aw-minimap">
			<button
				type="button"
				className="aw-minimap-map"
				aria-label="Minimap: click to walk there"
				onClick={(event) => {
					const box = event.currentTarget.getBoundingClientRect();
					const x = (event.clientX - box.left - left) / scale;
					const y = (event.clientY - box.top - top) / scale;
					if (x < 0 || y < 0 || x > map.cols || y > map.rows) return;
					onWalk(map.place, [Math.round(x * 2) / 2, Math.round(y * 2) / 2]);
				}}
			>
				<span className="aw-minimap-place" style={{ left, top, width, height }}>
					{strips.map((strip) => (
						<span
							key={`${strip.at}:${strip.from}`}
							className="aw-minimap-strip"
							style={{
								left: strip.at * scale,
								width: (strip.to - strip.from) * scale,
								backgroundImage: `url("${map.painting}")`,
								backgroundSize: `${map.paintingCols * scale}px ${height}px`,
								backgroundPosition: `${-strip.from * scale}px 0`,
							}}
						/>
					))}
					{map.view && (
						<span
							className="aw-minimap-view"
							style={{
								left: Math.max(0, map.view.x) * scale,
								top: Math.max(0, map.view.y) * scale,
								width: Math.min(map.view.w, map.cols) * scale,
								height: Math.min(map.view.h, map.rows) * scale,
							}}
						/>
					)}
					{map.exits?.map((exit) => (
						<span
							key={`exit:${exit.name}`}
							className={`aw-minimap-exit aw-minimap-exit-${exit.edge}`}
							title={`To ${exit.name}`}
							style={{ left: exit.x * scale, top: exit.y * scale }}
						/>
					))}
					{map.dots.map((dot) => {
						const character = dot.kind === "agent" ? people.get(dot.id) : undefined;
						const attention = character ? attentionOf(character) : undefined;
						const calling = attention === "asking" || attention === "finished";
						return (
							<span
								key={`${dot.kind}:${dot.id}`}
								className={`aw-dot aw-dot-${dot.kind}${calling ? " aw-dot-calling" : ""}`}
								data-id={dot.id}
								title={character?.name ?? (dot.kind === "avatar" ? "You" : undefined)}
								style={{ left: dot.x * scale, top: dot.y * scale }}
							/>
						);
					})}
				</span>
			</button>
		</div>
	);
}
