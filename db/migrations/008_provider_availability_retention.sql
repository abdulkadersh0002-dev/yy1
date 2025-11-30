-- Retention policy for provider availability history metrics
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
        BEGIN
            PERFORM add_retention_policy('provider_availability_history', INTERVAL '90 days', if_not_exists => TRUE);
        EXCEPTION
            WHEN undefined_function THEN
                RAISE NOTICE 'add_retention_policy not available; retention policy not created';
        END;
    ELSE
        RAISE NOTICE 'TimescaleDB extension not installed; skipping retention policy setup';
    END IF;
END;
$$;
