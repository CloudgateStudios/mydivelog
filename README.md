# MyDiveLog

MyDiveLog is a digital log book and sharing hub for scuba divers. The product goal is to give divers one reliable place to record dives, preserve their history, import/export their data, and eventually share selected dives publicly.

The repository is currently in foundation mode. The first work is planning, architecture, and repo setup before application implementation begins.

## Current Status

- Planning docs are in [docs](./docs/README.md).
- The decided launch platform is Full GCP Lean.
- The planned app sequence is API/database/import foundation, admin app, web app, then Flutter mobile/desktop.
- Application code has not been scaffolded yet.

## Planned Repository Shape

```text
api/       NestJS API service
web/       Public website and logged-in web app
admin/     Separate staff admin app
app/       Future Flutter mobile/desktop app
packages/  Shared TypeScript packages and generated clients
infra/     Terraform
docs/      Product, architecture, and implementation docs
design/    Design references and brand assets
scripts/   Repo automation and checks
```

Some folders will be added as implementation begins.

## Stack Direction

- Monorepo with pnpm workspaces and Turborepo.
- NestJS API.
- Next.js web and admin apps, deployed separately.
- PostgreSQL on Cloud SQL.
- Prisma for database access and migrations.
- Cloud Run, Cloud Storage, Cloud Tasks, Secret Manager, Cloud DNS, and GCP-native observability.
- Terraform and GitHub Actions.
- Flutter later for mobile/desktop.

See [Technology Decisions](./docs/technology-decisions.md) for the full decision log.

## Local Checks

This repo uses pnpm. Once pnpm is available:

```bash
pnpm check
```

For now, checks focus on repo hygiene and documentation links. More app-specific linting, tests, and builds will be added as app work begins.

## Documentation

Start here:

- [Docs Index](./docs/README.md)
- [Implementation Roadmap](./docs/implementation-roadmap.md)
- [Technology Decisions](./docs/technology-decisions.md)
- [Data Model](./docs/data-model.md)
- [API Plan](./docs/api-plan.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
