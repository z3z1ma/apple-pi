## file

Git installs omit dev dependencies, so the package ships the built app and that build must match source. The freshness check sets `NODE_ENV=production` before invoking Vite.
Why: Vitest sets `NODE_ENV=test`, which would select React's development build and fail a byte comparison for the wrong reason.
