import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import autoCompact from "../../../extensions/auto-compact.js";
import homeSearchGuard from "../../../extensions/home-search-guard.js";
import ledger from "../../../extensions/ledger.js";
import rtk from "../../../extensions/rtk.js";
import sessionSearch from "../../../extensions/session-search.js";
import tasks from "../../../extensions/tasks.js";
import vroom from "../../../extensions/vroom.js";
import wiki from "../../../extensions/wiki.js";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import type { Rates } from "./report.js";
import type { SessionFactory } from "./run.js";

/**
 * Real root sessions for the evaluation, through Pi's SDK with the profile the configuration names.
 * They read the real credentials (`auth.json`, which a token refresh may rewrite), `models.json`, and
 * `model-profiles.json` from the agent directory; every other store the SDK writes (settings, the
 * models store, sessions) lives in a temporary agent directory that `close` removes, and extension,
 * package, skill, prompt, and theme discovery stays off. Each session loads the extensions an ordinary
 * child session loads (fast mode, compaction safety through auto-compact, search guard, ledger, wiki,
 * session search, RTK) plus tasks. Sessions are in memory in their clone.
 */
export async function realSessions(
	profile: string,
	options: { agentDir?: string } = {},
): Promise<{ createSession: SessionFactory; modelLabel: string; rates: Rates; close: () => void }> {
	const agentDir = options.agentDir ?? getAgentDir();
	const stateDir = mkdtempSync(join(tmpdir(), "apple-pi-eval-agent-"));
	const close = () => rmSync(stateDir, { recursive: true, force: true });
	try {
		// The downloaded model catalog names models the built-in list lacks; runs read a copy of it.
		const store = join(agentDir, "models-store.json");
		if (existsSync(store)) copyFileSync(store, join(stateDir, "models-store.json"));
		const runtime = await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			modelsStorePath: join(stateDir, "models-store.json"),
		});
		const registry = new ModelRegistry(runtime);
		const { model, thinking } = resolveModelProfile(profile, registry);
		return {
			modelLabel: `${model.provider}/${model.id} (profile ${profile}, thinking ${thinking})`,
			rates: model.cost,
			close,
			async createSession(cwd) {
				const settingsManager = SettingsManager.create(cwd, stateDir);
				const loader = new DefaultResourceLoader({
					cwd,
					agentDir: stateDir,
					settingsManager,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					extensionFactories: [autoCompact, vroom, homeSearchGuard, ledger, wiki, sessionSearch, rtk, tasks],
				});
				await loader.reload();
				const { session } = await createAgentSession({
					cwd,
					agentDir: stateDir,
					modelRuntime: runtime,
					model,
					thinkingLevel: thinking as ThinkingLevel,
					resourceLoader: loader,
					sessionManager: SessionManager.inMemory(cwd),
					settingsManager,
				});
				await session.bindExtensions({});
				// The run shuts the session down and disposes it; nothing else is held per session.
				return { session, dispose: () => {} };
			},
		};
	} catch (error) {
		close();
		throw error;
	}
}
