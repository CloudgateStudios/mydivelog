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

The local Docker database is available on `localhost:5433`, while Postgres still uses `5432` inside the container.

Health endpoints:

- `GET http://localhost:3000/health`
- `GET http://localhost:3000/health/db`

Auth endpoints:

- `GET http://localhost:3000/auth/providers`
- `POST http://localhost:3000/auth/dev-login`
- `GET http://localhost:3000/auth/me`
- `GET http://localhost:3000/auth/admin/me`
- `POST http://localhost:3000/auth/logout`

Read-only admin endpoints:

- `GET http://localhost:3000/admin/overview`
- `GET http://localhost:3000/admin/users?page=1&pageSize=20&search=staff`

Development user session:

```bash
curl -i -c /tmp/mydivelog-user.cookies \
  -H "Content-Type: application/json" \
  -d '{"email":"diver@example.com","displayName":"Local Diver"}' \
  http://localhost:3000/auth/dev-login

curl -b /tmp/mydivelog-user.cookies http://localhost:3000/auth/me
```

Development staff/admin session:

```bash
curl -i -c /tmp/mydivelog-admin.cookies \
  -H "Content-Type: application/json" \
  -d '{"email":"staff@example.com","displayName":"Local Staff","role":"staff","sessionKind":"admin"}' \
  http://localhost:3000/auth/dev-login

curl -b /tmp/mydivelog-admin.cookies http://localhost:3000/auth/admin/me
curl -b /tmp/mydivelog-admin.cookies http://localhost:3000/admin/overview
curl -b /tmp/mydivelog-admin.cookies "http://localhost:3000/admin/users?page=1&pageSize=10"
```

`POST /auth/dev-login` only exists when `NODE_ENV=development`.

## Useful Commands

```bash
pnpm --filter @mydivelog/api check
pnpm --filter @mydivelog/api build
pnpm --filter @mydivelog/api prisma:validate
pnpm --filter @mydivelog/api prisma:migrate
pnpm --filter @mydivelog/api prisma:studio
```
