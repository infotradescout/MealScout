# MealScout release gate

`npm run gate:release:local` is the deterministic release check and the Render build command. It stops at the first failure and covers repository structure, dependency policy, route ownership, security regressions, migration safety, payment and ordering contracts, type checking, lint, the production build, mobile readiness, and store metadata.

`npm run gate:release:browser` adds the unauthenticated desktop and mobile browser matrix. `npm run gate:release` runs deterministic checks, that browser matrix, then strict production configuration validation and read-only live probes. It must be run with installed Playwright browsers and the intended production environment values before a production promotion. The live stage performs GET requests only.

Database-backed integration tests, authenticated browser journeys, payment-provider dashboard configuration, email delivery, and a real migration rehearsal require approved staging or production credentials. A passing local gate does not claim those external checks ran.

Render runs the deterministic gate before its pre-deploy migration command, starts the compiled server only after both succeed, and evaluates `/health/ready`, which includes a database query, before treating the service as healthy.

GitHub Actions is intentionally not part of the release path. The repository has one package manager (`npm`), one deterministic gate, and one strict live extension.
