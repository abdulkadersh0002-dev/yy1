# Database Setup

This project can persist feature snapshots, trade outcomes, and provider telemetry in TimescaleDB/Postgres. To launch a local instance for development:

```bash
# Install PostgreSQL locally (optionally with TimescaleDB), then set env vars (see .env.example)
# and run migrations.
```

Once the container is running, apply migrations in `db/migrations/` using the built-in runner:

```bash
npm run db:migrate
```

To preview pending migrations without applying them:

```bash
MIGRATIONS_DRY_RUN=true npm run db:migrate
```

This runner maintains a `schema_migrations` ledger (filename + checksum). If a migration file changes after being applied, the runner will abort with a checksum mismatch to prevent accidental drift.

Each migration file is executed inside a transaction. If a migration fails, the transaction is rolled back and the runner exits.

If you prefer manual SQL, you can still apply migrations directly (not recommended for production):

```bash
psql "postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" -f db/migrations/001_init.sql
```

The application reads connection settings from the following environment variables:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL` (`true`/`false`)

If these variables are not provided, the persistence layer remains disabled and the system continues operating in the in-memory mode.
