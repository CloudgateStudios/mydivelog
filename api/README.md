# MyDiveLog API

NestJS API service for MyDiveLog.

## Local Development

From the repository root:

```bash
cp api/.env.example api/.env
docker compose up -d postgres
pnpm install
pnpm --filter @mydivelog/api prisma:migrate
pnpm --filter @mydivelog/api start:dev
```

Health endpoints:

- `GET http://localhost:3000/health`
- `GET http://localhost:3000/health/db`

## Useful Commands

```bash
pnpm --filter @mydivelog/api check
pnpm --filter @mydivelog/api build
pnpm --filter @mydivelog/api prisma:validate
pnpm --filter @mydivelog/api prisma:migrate
pnpm --filter @mydivelog/api prisma:studio
```
