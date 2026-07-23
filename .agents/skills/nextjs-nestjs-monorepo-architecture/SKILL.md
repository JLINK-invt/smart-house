---
name: nextjs-nestjs-monorepo-architecture
description: Next.js and NestJS monorepo architecture for a solo-maintained product. Use whenever planning, creating, reviewing, or refactoring a Next.js frontend, NestJS backend, workspace package, API contract, database boundary, deployment boundary, or cross-application dependency in a monorepo. Favor the smallest maintainable architecture over distributed-system complexity.
---

# Next.js and NestJS Monorepo Architecture

Design a coherent product architecture that one developer can understand, change, test, and deploy safely. Prefer a modular monolith with explicit boundaries. Add services, packages, abstractions, and infrastructure only when a current product or operational need justifies them.

## Architecture Priorities

Use this priority order when choices conflict:

1. Correctness, security, and clear ownership.
2. Fast local development and simple deployment.
3. Explicit, testable interfaces between the web app, API, and database.
4. Reuse that reduces real duplication.
5. Scalability and extensibility supported by current evidence.

Do not introduce microservices, event buses, CQRS, event sourcing, Kubernetes, a separate BFF, or multiple databases merely to appear scalable. A well-structured NestJS application is the backend boundary until there is a concrete reason to split it.

## Start With Discovery

Before proposing a structural change, inspect the repository and identify:

- Workspace tool and conventions: npm, pnpm, Yarn, Bun, Nx, Turborepo, or another setup.
- Existing application roots, shared packages, path aliases, build targets, and CI commands.
- Current data access, authentication, API documentation, validation, and deployment patterns.
- The nearest feature modules and tests that establish local conventions.
- Whether the request changes a public API, data model, authorization rule, or deployment boundary.

Preserve established patterns that work. If conventions conflict or the repository has no precedent, choose the simplest option and state the decision briefly.

## Default Workspace Shape

Use a shape like this when creating a new workspace or correcting an unclear one. Adapt names and layers to the existing repository rather than moving code only to match this diagram.

```text
apps/
  web/                 # Next.js application
  api/                 # NestJS application
packages/
  contracts/           # API schemas, generated client, or shared transport types
  config/              # Shared TypeScript, ESLint, test, or build configuration
  ui/                  # Reusable presentation-only components, if real reuse exists
  domain/              # Framework-free business rules, only when shared and valuable
```

Keep application-specific code in `apps`. Create a package only when it has a clear owner, stable purpose, and at least two consumers or a strong boundary reason. Do not create `common`, `utils`, or `shared` dumping grounds.

## Dependency Rules

Maintain a directed dependency graph:

- `apps/web` may depend on contracts, UI, configuration, and framework-free domain utilities.
- `apps/api` may depend on contracts, configuration, and framework-free domain utilities.
- Shared packages must not import from either application.
- The web app must not import NestJS modules, services, repositories, ORM clients, or API internals.
- The API must not import Next.js components, server actions, or web-specific infrastructure.
- The API owns database access and migrations. The web app accesses protected product data through the API, not a direct database connection.

Use workspace aliases or package exports that make allowed imports obvious. Enforce dependency rules with the workspace tool only after the structure is stable enough to benefit from enforcement.

## Next.js Boundary

Treat Next.js as the web delivery layer:

- Prefer Server Components for data display and Client Components only for browser APIs or interactive state.
- Keep page and route composition close to the relevant route; extract reusable UI only after reuse is established.
- Use route handlers or server actions for web-specific concerns when they reduce complexity, not as an alternate business API.
- Authenticate and authorize every mutation at the NestJS API boundary, including requests originating from server actions.
- Keep browser-visible configuration public and minimal. Never expose backend secrets through `NEXT_PUBLIC_*` variables.
- Use a typed API client or a narrow data-access layer so page components do not duplicate HTTP, error, and authentication behavior.

## NestJS Boundary

Organize the API by business capability, not technical layer alone. A feature module may contain its controller, application service, validation, persistence adapter, and tests when that keeps the feature easy to trace.

For each exposed endpoint:

1. Parse and validate untrusted input at the boundary.
2. Authenticate the requester.
3. Authorize the requested action against the relevant resource.
4. Perform business logic in an application or domain service.
5. Access persistence behind the feature boundary.
6. Return a deliberate transport response without leaking persistence models.

Keep controllers thin. Do not expose ORM entities as API contracts or share Nest DTO classes directly with Next.js. The API remains authoritative for validation, authorization, and its data model.

## Contracts and Validation

Make cross-application contracts explicit. Choose one approach that fits the existing codebase:

- Use an API specification and generated client when the API has multiple consumers, external consumers, or a mature documentation workflow.
- Use shared framework-free schemas and inferred transport types when both applications are TypeScript and a shared runtime validator is already appropriate.
- Use hand-written request and response types with endpoint-level validation for a small, stable internal API when introducing tooling would add more maintenance than value.

Never treat shared TypeScript types as sufficient runtime validation. Validate input in NestJS regardless of how types are shared. Version or deprecate externally consumed contracts deliberately; do not silently repurpose fields.

## Data and State Ownership

Assign every mutable concept one owner:

- The API owns product data, business invariants, and database migrations.
- The web app owns presentation state, transient form state, and cache behavior.
- The identity provider or API owns session verification; the web app may consume verified session information but must not become the sole authorization authority.
- Background work stays in-process or uses a simple queue only when request-time execution is demonstrably unsuitable.

Design database changes to be deployable safely. For incompatible changes, use an additive migration, deploy code that supports both forms, backfill if needed, then remove the old form in a later release.

## Solo-Developer Defaults

Optimize for low cognitive and operational load:

- Prefer one repository, one primary backend, and one primary database.
- Prefer a small number of environment variables with a documented owner and purpose.
- Deploy applications independently only when their delivery needs differ; otherwise keep the release process simple.
- Add observability that answers operational questions: structured errors, request correlation where useful, health checks, and basic metrics or logs.
- Keep architecture decisions near the code. Record consequential decisions in a short ADR or the relevant feature documentation: context, decision, alternatives rejected, and consequences.
- Delete obsolete abstractions and code paths rather than preserving speculative compatibility.

## Change Workflow

When implementing an architecture-related task:

1. Classify the change: local feature work, shared contract change, data migration, security boundary change, or deployment change.
2. Identify the smallest affected boundary and the owning application or package.
3. Describe the dependency direction and data flow before changing cross-boundary code.
4. Implement the smallest complete slice, keeping business logic near its owner.
5. Update contracts, validation, documentation, and tests together when a boundary changes.
6. Run the workspace's relevant type checks, linting, tests, and builds for affected applications and packages.

For a meaningful trade-off, state the recommended option, its main cost, and why it is preferable for a single developer now. Ask a short question only when the decision depends on an unknown product constraint that cannot be safely inferred.

## Review Checklist

During architecture reviews, verify:

- Does each package have a clear purpose and permitted dependencies?
- Is product data accessed through the API rather than imported or queried from the web app?
- Are input validation, authentication, and authorization enforced in NestJS?
- Does a shared contract avoid leaking framework or persistence details?
- Is the proposed solution simpler than the nearest viable alternative?
- Does the migration and deployment sequence preserve compatibility where stored data or public clients require it?
- Can one developer locate, run, test, and deploy the changed feature without hidden coupling?

Call out unnecessary complexity, missing ownership, circular dependencies, contract drift, authorization gaps, unsafe schema changes, and untested cross-application behavior. For React implementation and performance details, apply the repository's React and Next.js guidance in addition to this architecture skill.
