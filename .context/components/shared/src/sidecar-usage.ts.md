## file

Consultant records remain in older on-disk usage logs. Only the pair writes new sidecar calls.
Why: appending is a no-op when no session is bound. Unit tests that never enable recording must not write into the real agent directory.
