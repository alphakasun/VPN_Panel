import pg from 'pg';

/** PostgreSQL-backed, transaction-safe state store for the control plane. */
export class PostgresStore {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 10, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS panel_state (
        id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        event_type TEXT NOT NULL,
        subject_id UUID,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
    await this.pool.query(`INSERT INTO panel_state (id, state) VALUES (TRUE, $1::jsonb) ON CONFLICT (id) DO NOTHING`, [JSON.stringify({ nodes: [], clients: [], routingPolicies: [] })]);
  }

  async read() {
    const result = await this.pool.query('SELECT state FROM panel_state WHERE id = TRUE');
    return result.rows[0]?.state ?? null;
  }

  async write(value) {
    await this.pool.query('INSERT INTO panel_state (id, state) VALUES (TRUE, $1::jsonb) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()', [JSON.stringify(value)]);
  }

  async update(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT state FROM panel_state WHERE id = TRUE FOR UPDATE');
      const next = await callback(result.rows[0]?.state ?? { nodes: [], clients: [], routingPolicies: [] });
      const callbackResult = next.result;
      delete next.result;
      await client.query('UPDATE panel_state SET state = $1::jsonb, updated_at = NOW() WHERE id = TRUE', [JSON.stringify(next)]);
      await client.query('COMMIT');
      return callbackResult ?? next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async audit(eventType, subjectId, metadata = {}) {
    await this.pool.query('INSERT INTO audit_events (event_type, subject_id, metadata) VALUES ($1, $2, $3::jsonb)', [eventType, subjectId || null, JSON.stringify(metadata)]);
  }

  async close() { await this.pool.end(); }
}
