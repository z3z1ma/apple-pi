if (/nativeRetry:\s*isRetryableAssistantError\s*\(|return\s+isRetryableAssistantError\s*\(/.test(event.content ?? event.added))
	return "Match Pi's context-overflow exclusion before delegating provider failover continuation to native retry.";
