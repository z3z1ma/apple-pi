export interface GraphCommit {
	sha: string;
	parents: string[];
}

export interface GraphRow {
	lane: number;
	incoming: number[];
	through: number[];
	outgoing: number[];
	width: number;
}

export function laneLayout(commits: GraphCommit[]): GraphRow[] {
	const lanes: (string | null)[] = [];
	const free = (avoid: number) => {
		const index = lanes.findIndex((sha, at) => sha === null && at !== avoid);
		if (index >= 0) return index;
		lanes.push(null);
		return lanes.length - 1;
	};
	return commits.map((commit) => {
		let lane = lanes.indexOf(commit.sha);
		if (lane < 0) lane = free(-1);
		const incoming = lanes.flatMap((sha, at) => (sha === commit.sha ? [at] : []));
		const through = lanes.flatMap((sha, at) => (sha !== null && sha !== commit.sha ? [at] : []));
		for (const at of incoming) lanes[at] = null;
		const outgoing: number[] = [];
		commit.parents.forEach((parent, index) => {
			const existing = lanes.indexOf(parent);
			if (existing >= 0) {
				outgoing.push(existing);
				return;
			}
			const at = index === 0 ? lane : free(lane);
			lanes[at] = parent;
			outgoing.push(at);
		});
		while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
		const width = Math.max(lane, ...incoming, ...through, ...outgoing) + 1;
		return { lane, incoming, through, outgoing, width };
	});
}
