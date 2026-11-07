if (!event.path.endsWith("apps/agent-workplace/web/workplace-git.tsx")) return;
if (/\.run\(\s*\{\s*root\s*:\s*\w+\.current\b/.test(event.content))
	return "Capture the repository in the Git action closure so retained confirmations and their continuations keep their original root.";
