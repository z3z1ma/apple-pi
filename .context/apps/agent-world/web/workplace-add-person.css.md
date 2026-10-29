## file

The form inherits Workplace palette tokens from its enclosing wp-app. Org owns the desktop chart/panel grid and the containing block for the narrow-screen overlay; this stylesheet owns only the form panel and its scrolling content.
Why: mounting the form outside Workplace or changing the parent's positioning can detach the overlay from the chart or lose the light/dark palette even when the form markup is unchanged.
Coupled: apps/agent-world/web/workplace-org.css, apps/agent-world/web/workplace.css, apps/agent-world/web/workplace-add-person.tsx
Verify: apps/agent-world/tests/world-org.test.ts

The optional specialization textarea uses its two-row size instead of Org's shared textarea minimum height. Keep the override scoped to this field, not every textarea in Add person.
Why: Add person is embedded under `.wp-org`, whose general textarea rule otherwise makes the optional focus field as tall as larger planning inputs. The Goal field must retain its existing size.
