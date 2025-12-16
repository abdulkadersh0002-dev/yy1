# Database Setup

This project can persist feature snapshots, trade outcomes, and provider telemetry in TimescaleDB/Postgres. To launch a local instance for development:

```bash
# Ensure environment variables exist (see .env.example)
docker compose up -d timescaledb
```

Once the container is running, apply migrations in `db/migrations/` (any migration tool is fine, for example `psql`):

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
