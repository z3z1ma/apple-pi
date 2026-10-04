Make `mergeConfig` in `src/config.js` merge nested plain objects key by key, at any depth: `mergeConfig({ server: { host: "localhost", port: 8080 } }, { server: { port: 9090 } })` returns `{ server: { host: "localhost", port: 9090 } }`.

Keep everything that works today. An override value that is not a plain object, such as an array, `null`, a string, or a number, replaces the default value whole, as it does now: `mergeConfig({ tags: ["a", "b"] }, { tags: ["c"] })` returns `{ tags: ["c"] }`. `mergeConfig` never modifies its arguments.
