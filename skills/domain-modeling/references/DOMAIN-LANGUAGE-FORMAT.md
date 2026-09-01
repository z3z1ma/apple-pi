# Domain Language Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.

## Single vs multi-context repos

**Single context (most repos):** One domain-language page in `.wiki/`, normally `.wiki/pages/domain-language.md` unless `.wiki/README.md` establishes another name.

**Multiple contexts:** A `domain-contexts.md` page in `.wiki/` lists the contexts, links to each domain-language page, and records how they relate:

```md
# Domain Contexts

## Contexts

- [[ordering-language|Ordering]]: receives and tracks customer orders
- [[billing-language|Billing]]: generates invoices and processes payments
- [[fulfillment-language|Fulfillment]]: manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `.wiki/README.md` names a context-map page, read that page to find contexts
- Otherwise, if a `domain-contexts.md` page exists, read it to find contexts
- If only one domain-language page exists, single context
- If neither exists, create the default domain-language page lazily when the first term is resolved

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.

Follow established `.wiki/README.md` organization and filenames when present. Otherwise use `domain-language.md` for a single context and `domain-contexts.md` plus `<context>-language.md` pages for multiple contexts. Every Markdown filename stem must remain globally unique and case-insensitive.
