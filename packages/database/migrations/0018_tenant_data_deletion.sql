BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE tenant_data_deletion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_data_deletion_jobs_active_organization_idx
  ON tenant_data_deletion_jobs (organization_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX tenant_data_deletion_jobs_pending_idx
  ON tenant_data_deletion_jobs (available_at, created_at)
  WHERE status = 'pending';

INSERT INTO schema_migrations (version)
VALUES ('0018_tenant_data_deletion')
ON CONFLICT DO NOTHING;

COMMIT;
