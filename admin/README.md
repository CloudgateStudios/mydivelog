# MyDiveLog Admin

Separate staff admin app for MyDiveLog operations.

## Local Development

From the repository root:

```bash
pnpm install
cp api/.env.example api/.env
cp admin/.env.example admin/.env.local
docker compose up -d postgres
pnpm --filter @mydivelog/api prisma:migrate
pnpm --filter @mydivelog/api start:dev
```

In another terminal:

```bash
pnpm --filter @mydivelog/admin dev
```

Open `http://localhost:3001`.

## Local Login

The login screen uses the API's development-only staff login endpoint. The API must have `NODE_ENV=development`.

Default local credentials:

- Email: `staff@example.com`
- Display name: `Local Staff`

The admin app creates an `admin` session with the `staff` role. Normal user sessions should be rejected by the admin session check.

## Dashboard Data

The dashboard reads protected API endpoints through the admin app:

- `GET /admin/overview`
- `GET /admin/users`

Both endpoints require a valid admin session and a staff or admin role.

## Useful Commands

```bash
pnpm --filter @mydivelog/admin check
pnpm --filter @mydivelog/admin build
```
