import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
export interface Q {
  query<T = any>(
    sql: string,
    params?: any[],
  ): Promise<{ rows: T[]; rowCount?: number; affectedRows?: number }>;
}
export class Database {
  private embedded?: PGlite;
  private pool?: pg.Pool;
  constructor(public memory = false) {
    if (process.env.DATABASE_URL && !memory)
      this.pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
      });
    else {
      if (!memory) mkdirSync(".data", { recursive: true });
      this.embedded = new PGlite(memory ? "memory://" : ".data/postgres");
    }
  }
  async owner<T>(fn: (q: Q) => Promise<T>): Promise<T> {
    if (this.embedded)
      return this.embedded.transaction((tx) =>
        fn({
          query: async (sql: string, params?: any[]) =>
            params
              ? tx.query(sql, params)
              : (await tx.exec(sql)).at(-1) || { rows: [] },
        } as Q),
      );
    const c = await this.pool!.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async as<T>(
    role: "hrms_app" | "hrms_auth",
    actor: string | null,
    fn: (q: Q) => Promise<T>,
  ): Promise<T> {
    return this.owner(async (q) => {
      await q.query(`SET LOCAL ROLE ${role}`);
      await q.query("SELECT set_config('app.actor_id',$1,true)", [actor || ""]);
      return fn(q);
    });
  }
  async init() {
    // The public demo is deliberately fictional and ephemeral. It is the only
    // production-hosted case allowed to use the embedded store; every real
    // deployment must use the restricted PostgreSQL application role below.
    const embeddedDemo =
      process.env.DEMO_MODE === "true" &&
      process.env.ALLOW_EMBEDDED_DEMO === "true";
    // A hosted demo uses the managed PostgreSQL database supplied by Render.
    // Its schema is initialized and seeded only with fictional records.
    const hostedDemo = process.env.DEMO_MODE === "true" && !!this.pool;
    if (process.env.NODE_ENV === "production") {
      if (hostedDemo) {
        await migrate(this);
        return;
      }
      if (!embeddedDemo && (!this.pool || process.env.DEMO_MODE === "true"))
        throw new Error("Production requires PostgreSQL and forbids demo mode");
      if (embeddedDemo && this.embedded) {
        await migrate(this);
        return;
      }
      await this.owner(async (q) => {
        const r = await q.query(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        if (r.rows[0]?.rolsuper || r.rows[0]?.rolbypassrls)
          throw new Error("Unsafe database role");
        const own = await q.query(
          "SELECT 1 FROM pg_tables WHERE schemaname IN ('public','auth') AND tableowner=current_user LIMIT 1",
        );
        if (own.rows.length) throw new Error("Application must not own tables");
      });
      return;
    }
    if (this.embedded) await migrate(this);
  }
  async close() {
    await this.embedded?.close();
    await this.pool?.end();
  }
}
export async function migrate(db: Database) {
  const schema = await readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  await db.owner(async (q) => {
    await q.query(schema);
    const tables: Record<
      string,
      { c: string; b: string; e: string; m: string }
    > = {
      tenants: { c: "NULL", b: "NULL", e: "NULL", m: "'organization'" },
      companies: { c: "id", b: "NULL", e: "NULL", m: "'organization'" },
      branches: { c: "company_id", b: "id", e: "NULL", m: "'organization'" },
      employees: { c: "company_id", b: "branch_id", e: "id", m: "'employees'" },
      policies: { c: "company_id", b: "branch_id", e: "NULL", m: "'policies'" },
      attendance: {
        c: "company_id",
        b: "branch_id",
        e: "employee_id",
        m: "'attendance'",
      },
      leave_requests: {
        c: "company_id",
        b: "branch_id",
        e: "employee_id",
        m: "'leave'",
      },
      records: {
        c: "company_id",
        b: "branch_id",
        e: "employee_id",
        m: "module",
      },
      salary_assignments: {
        c: "company_id",
        b: "branch_id",
        e: "employee_id",
        m: "'payroll'",
      },
      payroll_runs: {
        c: "company_id",
        b: "branch_id",
        e: "NULL",
        m: "'payroll'",
      },
      audit_logs: { c: "company_id", b: "branch_id", e: "NULL", m: "'audit'" },
    };
    for (const [table, x] of Object.entries(tables)) {
      const t = table === "tenants" ? "id" : "tenant_id";
      // The public demo seeds fictional data through the database owner. The
      // application itself still SET ROLEs to hrms_app, where every policy is
      // enforced. Real deployments force RLS even for the table owner.
      const forceRls =
        process.env.DEMO_MODE === "true"
          ? "NO FORCE ROW LEVEL SECURITY"
          : "FORCE ROW LEVEL SECURITY";
      await q.query(
        `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} ${forceRls}; GRANT SELECT,INSERT,UPDATE ON ${table} TO hrms_app;`,
      );
      const check = (action: string) =>
        `auth.can_access(${t},${x.c},${x.b},${x.e},${x.m} || '.${action}')`;
      await q.query(
        `DROP POLICY IF EXISTS scoped_read ON ${table}; CREATE POLICY scoped_read ON ${table} FOR SELECT TO hrms_app USING (${check("read")});`,
      );
      await q.query(
        `DROP POLICY IF EXISTS scoped_insert ON ${table}; CREATE POLICY scoped_insert ON ${table} FOR INSERT TO hrms_app WITH CHECK (${check("write")});`,
      );
      await q.query(
        `DROP POLICY IF EXISTS scoped_update ON ${table}; CREATE POLICY scoped_update ON ${table} FOR UPDATE TO hrms_app USING (${check("write")}) WITH CHECK (${check("write")});`,
      );
    }
    // Branch removal is the only application-level hard delete. PostgreSQL
    // checks the same tenant/company/branch scope as the other operations.
    await q.query(
      "GRANT DELETE ON branches TO hrms_app; DROP POLICY IF EXISTS scoped_delete ON branches; CREATE POLICY scoped_delete ON branches FOR DELETE TO hrms_app USING (auth.can_access(tenant_id,company_id,id,NULL,'organization.write'));",
    );
    // Audit writes require the authenticated actor; edits and deletes are forbidden.
    await q.query(
      "REVOKE UPDATE ON audit_logs,attendance,salary_assignments FROM hrms_app; DROP POLICY scoped_insert ON audit_logs; CREATE POLICY scoped_insert ON audit_logs FOR INSERT TO hrms_app WITH CHECK(actor_id=nullif(current_setting('app.actor_id',true),'')::uuid AND auth.audit_scope(tenant_id,company_id,branch_id)); ",
    );
    await q.query("GRANT INSERT ON audit_logs TO hrms_auth;");
    await q.query(
      "DROP POLICY IF EXISTS auth_audit_insert ON audit_logs; CREATE POLICY auth_audit_insert ON audit_logs FOR INSERT TO hrms_auth WITH CHECK (EXISTS (SELECT 1 FROM auth.users u WHERE u.id=actor_id AND u.tenant_id=audit_logs.tenant_id));",
    );
  });
}
