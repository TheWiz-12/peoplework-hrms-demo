CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN CREATE ROLE hrms_app NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE hrms_auth NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE hrms_internal NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Only the migration identity may assume the helper owner. Never grant this role to runtime.
GRANT hrms_internal TO CURRENT_USER;
-- The managed demo connection may assume only these constrained runtime roles.
-- A real production deployment uses separately provisioned migration and app users.
GRANT hrms_app, hrms_auth TO CURRENT_USER;
CREATE TABLE IF NOT EXISTS auth.users (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, email text UNIQUE NOT NULL,
 name text NOT NULL, password_hash text NOT NULL, employee_id uuid, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS auth.grants (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id),
 role text NOT NULL, company_id uuid, branch_id uuid, permissions text[] NOT NULL,
 CHECK (branch_id IS NULL OR company_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS auth.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), csrf text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.devices (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL,
 name text NOT NULL, secret text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS auth.login_attempts (key text PRIMARY KEY, attempts integer NOT NULL, expires_at timestamptz NOT NULL);
GRANT USAGE ON SCHEMA auth TO hrms_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO hrms_auth;

CREATE TABLE IF NOT EXISTS team_links (tenant_id uuid NOT NULL, manager_id uuid NOT NULL, employee_id uuid NOT NULL, PRIMARY KEY(tenant_id,manager_id,employee_id));
CREATE OR REPLACE FUNCTION auth.can_access(t uuid, c uuid, b uuid, employee uuid, perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
 SELECT EXISTS (
   SELECT 1 FROM auth.users u JOIN auth.grants g ON g.user_id=u.id AND g.tenant_id=u.tenant_id
   WHERE u.id = nullif(current_setting('app.actor_id', true),'')::uuid AND u.active AND u.tenant_id=t
   AND (perm=ANY(g.permissions) OR '*'=ANY(g.permissions))
   AND (g.company_id IS NULL OR g.company_id=c)
   AND (g.branch_id IS NULL OR g.branch_id=b OR (perm='organization.read' AND b IS NULL))
   AND (perm='organization.read' OR g.role NOT IN ('employee','manager') OR employee=u.employee_id
     OR (g.role='manager' AND EXISTS (SELECT 1 FROM public.team_links l WHERE l.tenant_id=t AND l.manager_id=u.employee_id AND l.employee_id=employee)))
 );
$$;
-- team_links is intentionally owned by the migration role and readable only through policy helpers.
-- Create the relation before compiling the function on first install (migration reorders this block).

CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS platform_tenants (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 employee_limit integer NOT NULL DEFAULT 10000 CHECK(employee_limit BETWEEN 1 AND 100000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companies (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL, code text NOT NULL, UNIQUE(tenant_id,id), UNIQUE(tenant_id,code));
CREATE TABLE IF NOT EXISTS platform_company_limits (
 company_id uuid PRIMARY KEY REFERENCES companies(id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 employee_limit integer NOT NULL DEFAULT 1 CHECK(employee_limit BETWEEN 1 AND 100000)
);
-- Existing demo databases were created with a 1,000-slot default. Update the
-- default in place; CREATE TABLE IF NOT EXISTS does not change old columns.
ALTER TABLE platform_company_limits ALTER COLUMN employee_limit SET DEFAULT 1;
CREATE TABLE IF NOT EXISTS platform_audit (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL, action text NOT NULL,
 target_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION platform_initialize_company() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO platform_company_limits(company_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS companies_platform_initialize ON companies;
CREATE TRIGGER companies_platform_initialize AFTER INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION platform_initialize_company();
REVOKE ALL ON FUNCTION platform_initialize_company() FROM PUBLIC;
INSERT INTO platform_tenants(tenant_id) SELECT id FROM tenants ON CONFLICT DO NOTHING;
INSERT INTO platform_company_limits(company_id)
SELECT c.id FROM companies c WHERE NOT EXISTS
  (SELECT 1 FROM platform_company_limits pcl WHERE pcl.company_id=c.id);
-- A company limit reserves employee capacity from its parent firm. Locking the
-- firm row serializes competing company creations and limit edits.
CREATE OR REPLACE FUNCTION platform_validate_company_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE firm_id uuid; firm_limit integer; allocated bigint; existing_employees bigint;
BEGIN
 SELECT tenant_id INTO firm_id FROM companies WHERE id=NEW.company_id;
 SELECT employee_limit INTO firm_limit FROM platform_tenants WHERE tenant_id=firm_id FOR UPDATE;
 IF firm_limit IS NULL THEN
   RAISE EXCEPTION 'Firm employee limit is not configured' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO existing_employees FROM employees WHERE company_id=NEW.company_id;
 IF NEW.employee_limit < existing_employees THEN
   RAISE EXCEPTION 'Company limit cannot be lower than its current employee count' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(pcl.employee_limit),0) INTO allocated
 FROM platform_company_limits pcl JOIN companies c ON c.id=pcl.company_id
 WHERE c.tenant_id=firm_id AND pcl.company_id<>NEW.company_id;
 IF TG_OP='UPDATE' THEN
   IF NEW.company_id=OLD.company_id AND NEW.employee_limit<OLD.employee_limit THEN
     RETURN NEW;
   END IF;
 END IF;
 IF allocated + NEW.employee_limit > firm_limit THEN
   RAISE EXCEPTION 'Company allocation exceeds remaining firm employee capacity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS company_allocation_guard ON platform_company_limits;
CREATE TRIGGER company_allocation_guard BEFORE INSERT OR UPDATE OF employee_limit,company_id ON platform_company_limits
FOR EACH ROW EXECUTE FUNCTION platform_validate_company_allocation();
REVOKE ALL ON FUNCTION platform_validate_company_allocation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform_validate_firm_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE allocated bigint; existing_employees bigint;
BEGIN
 SELECT coalesce(sum(pcl.employee_limit),0) INTO allocated
 FROM platform_company_limits pcl JOIN companies c ON c.id=pcl.company_id
 WHERE c.tenant_id=NEW.tenant_id;
 SELECT count(*) INTO existing_employees FROM employees WHERE tenant_id=NEW.tenant_id;
 IF NEW.employee_limit < allocated OR NEW.employee_limit < existing_employees THEN
   RAISE EXCEPTION 'Firm limit cannot be lower than allocated company limits or current employees' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS firm_allocation_guard ON platform_tenants;
CREATE TRIGGER firm_allocation_guard BEFORE UPDATE OF employee_limit ON platform_tenants
FOR EACH ROW EXECUTE FUNCTION platform_validate_firm_allocation();
REVOKE ALL ON FUNCTION platform_validate_firm_allocation() FROM PUBLIC;
GRANT SELECT ON platform_tenants,platform_company_limits TO hrms_auth;
CREATE TABLE IF NOT EXISTS branches (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, name text NOT NULL, timezone text NOT NULL DEFAULT 'Asia/Kolkata', UNIQUE(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id));
CREATE TABLE IF NOT EXISTS employees (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL,
 code text NOT NULL, name text NOT NULL, email text NOT NULL, department text NOT NULL, designation text NOT NULL,
 employment_type text NOT NULL, joined_on date NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,company_id,id), UNIQUE(tenant_id,company_id,code),
 FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id)
);
CREATE TABLE IF NOT EXISTS team_links (tenant_id uuid NOT NULL, manager_id uuid NOT NULL, employee_id uuid NOT NULL, PRIMARY KEY(tenant_id,manager_id,employee_id));
CREATE TABLE IF NOT EXISTS policies (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid,
 name text NOT NULL, employment_type text NOT NULL, version integer NOT NULL CHECK(version>0), effective_from date NOT NULL,
 rules jsonb NOT NULL, status text NOT NULL CHECK(status IN ('draft','published','retired')), created_at timestamptz DEFAULT now(),
 UNIQUE(tenant_id,company_id,name,version), FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id),
 FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id)
);
CREATE TABLE IF NOT EXISTS attendance (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL, employee_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL, direction text NOT NULL CHECK(direction IN ('in','out','unknown')),
 source text NOT NULL, event_key text NOT NULL, device_id uuid, note text NOT NULL DEFAULT '', created_at timestamptz DEFAULT now(),
 UNIQUE(tenant_id,event_key), FOREIGN KEY(tenant_id,company_id,employee_id) REFERENCES employees(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id)
);
CREATE TABLE IF NOT EXISTS leave_requests (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL, employee_id uuid NOT NULL,
 type text NOT NULL, start_date date NOT NULL, end_date date NOT NULL CHECK(end_date>=start_date), reason text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')), decided_by uuid, created_at timestamptz DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id,employee_id) REFERENCES employees(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id)
);
CREATE TABLE IF NOT EXISTS records (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid, employee_id uuid,
 module text NOT NULL CHECK(module IN ('performance','training','canteen','exits','contractors','gatepasses','support','masters')),
 title text NOT NULL, status text NOT NULL DEFAULT 'open', data jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now(),
 FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id), FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id),
 FOREIGN KEY(tenant_id,company_id,employee_id) REFERENCES employees(tenant_id,company_id,id)
);
CREATE TABLE IF NOT EXISTS salary_assignments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid NOT NULL, employee_id uuid NOT NULL,
 base_paise bigint NOT NULL CHECK(base_paise>=0), allowances_paise bigint NOT NULL DEFAULT 0 CHECK(allowances_paise>=0), deductions_paise bigint NOT NULL DEFAULT 0 CHECK(deductions_paise>=0),
 effective_from date NOT NULL, UNIQUE(tenant_id,employee_id,effective_from),
 FOREIGN KEY(tenant_id,company_id,employee_id) REFERENCES employees(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id,branch_id) REFERENCES branches(tenant_id,company_id,id)
);
CREATE TABLE IF NOT EXISTS payroll_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, branch_id uuid, period text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','locked')), total_paise bigint NOT NULL, items jsonb NOT NULL,
 created_by uuid NOT NULL, approved_by uuid, created_at timestamptz DEFAULT now(), UNIQUE(tenant_id,company_id,period),
 FOREIGN KEY(tenant_id,company_id) REFERENCES companies(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid, branch_id uuid, actor_id uuid NOT NULL,
 action text NOT NULL, resource_id text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_scope ON employees(tenant_id,company_id,branch_id);
CREATE INDEX IF NOT EXISTS attendance_scope ON attendance(tenant_id,company_id,employee_id,occurred_at);
CREATE INDEX IF NOT EXISTS records_scope ON records(tenant_id,company_id,module);
CREATE INDEX IF NOT EXISTS grants_actor ON auth.grants(user_id,tenant_id);

-- Returns only the applicable rules for an employee the caller may request leave for.
-- This helper does not grant employees access to the company's policy register.
CREATE OR REPLACE FUNCTION auth.leave_policy(eid uuid,at_date date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,auth AS $$
 SELECT p.rules FROM public.employees e JOIN public.policies p
 ON p.tenant_id=e.tenant_id AND p.company_id=e.company_id AND p.employment_type=e.employment_type
 WHERE e.id=eid AND auth.can_access(e.tenant_id,e.company_id,e.branch_id,e.id,'leave.write')
 AND (p.branch_id IS NULL OR p.branch_id=e.branch_id) AND p.status='published' AND p.effective_from<=at_date
 ORDER BY (p.branch_id IS NOT NULL) DESC,p.effective_from DESC,p.version DESC,p.created_at DESC,p.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth.leave_policy(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.leave_policy(uuid,date) TO hrms_app;

CREATE OR REPLACE FUNCTION auth.audit_scope(t uuid,c uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,auth AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN auth.grants g ON g.user_id=u.id AND g.tenant_id=u.tenant_id WHERE u.id=nullif(current_setting('app.actor_id',true),'')::uuid AND u.active AND u.tenant_id=t AND (g.company_id IS NULL OR g.company_id=c) AND (g.branch_id IS NULL OR g.branch_id=b));
$$;
REVOKE ALL ON FUNCTION auth.audit_scope(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.audit_scope(uuid,uuid,uuid) TO hrms_app;
CREATE TABLE IF NOT EXISTS auth.device_nonces(device_id uuid NOT NULL,nonce text NOT NULL,created_at timestamptz DEFAULT now(),PRIMARY KEY(device_id,nonce));
CREATE OR REPLACE FUNCTION auth.ingest_event(d uuid,code text,at_time timestamptz,event_id text,dir text,nonce_value text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,auth,public AS $$
DECLARE device auth.devices%ROWTYPE; emp public.employees%ROWTYPE; n integer;
BEGIN
 SELECT * INTO STRICT device FROM auth.devices WHERE id=d AND active;
 SELECT * INTO STRICT emp FROM public.employees WHERE tenant_id=device.tenant_id AND company_id=device.company_id AND branch_id=device.branch_id AND employees.code=ingest_event.code AND status='active';
 INSERT INTO auth.device_nonces(device_id,nonce) VALUES(d,nonce_value);
 INSERT INTO public.attendance(id,tenant_id,company_id,branch_id,employee_id,occurred_at,direction,source,event_key,device_id)
 VALUES(gen_random_uuid(),device.tenant_id,device.company_id,device.branch_id,emp.id,at_time,dir,'device',d::text||':'||event_id,d) ON CONFLICT(tenant_id,event_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n=1;
END; $$;
REVOKE ALL ON FUNCTION auth.ingest_event(uuid,text,timestamptz,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.ingest_event(uuid,text,timestamptz,text,text,text) TO hrms_auth;
CREATE OR REPLACE FUNCTION guard_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='policies' AND OLD.status='published' THEN RAISE EXCEPTION 'Published policies are immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payroll_runs' AND OLD.status='locked' THEN RAISE EXCEPTION 'Locked payroll is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS policies_history ON policies;
CREATE TRIGGER policies_history BEFORE UPDATE ON policies FOR EACH ROW EXECUTE FUNCTION guard_history();
DROP TRIGGER IF EXISTS payroll_history ON payroll_runs;
CREATE TRIGGER payroll_history BEFORE UPDATE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION guard_history();

GRANT USAGE ON SCHEMA public, auth TO hrms_app;
REVOKE ALL ON FUNCTION auth.can_access(uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.can_access(uuid,uuid,uuid,uuid,text) TO hrms_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Explicit, narrow helper privileges: FORCE RLS works without superuser-owned functions.
GRANT USAGE ON SCHEMA public,auth TO hrms_internal;
GRANT SELECT ON auth.users,auth.grants,auth.devices,public.team_links,public.employees,public.policies,public.platform_tenants,public.platform_company_limits TO hrms_internal;
GRANT INSERT ON auth.device_nonces,public.attendance TO hrms_internal;
GRANT EXECUTE ON FUNCTION auth.can_access(uuid,uuid,uuid,uuid,text) TO hrms_internal;
GRANT CREATE ON SCHEMA auth TO hrms_internal;
ALTER FUNCTION auth.can_access(uuid,uuid,uuid,uuid,text) OWNER TO hrms_internal;
ALTER FUNCTION auth.audit_scope(uuid,uuid,uuid) OWNER TO hrms_internal;
ALTER FUNCTION auth.leave_policy(uuid,date) OWNER TO hrms_internal;
ALTER FUNCTION auth.ingest_event(uuid,text,timestamptz,text,text,text) OWNER TO hrms_internal;
REVOKE CREATE ON SCHEMA auth FROM hrms_internal;

-- Tenant and company revocation are applied inside the same server-side RLS
-- helper that protects each normal HRMS record.
CREATE OR REPLACE FUNCTION auth.can_access(t uuid, c uuid, b uuid, employee uuid, perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, auth AS $$
 SELECT EXISTS (
   SELECT 1 FROM auth.users u JOIN auth.grants g ON g.user_id=u.id AND g.tenant_id=u.tenant_id
   WHERE u.id = nullif(current_setting('app.actor_id', true),'')::uuid AND u.active AND u.tenant_id=t
   AND NOT EXISTS (SELECT 1 FROM public.platform_tenants pt WHERE pt.tenant_id=t AND pt.status='suspended')
   AND (c IS NULL OR NOT EXISTS (SELECT 1 FROM public.platform_company_limits pcl WHERE pcl.company_id=c AND pcl.status='suspended'))
   AND (perm=ANY(g.permissions) OR '*'=ANY(g.permissions))
   AND (g.company_id IS NULL OR g.company_id=c)
   AND (g.branch_id IS NULL OR g.branch_id=b OR (perm='organization.read' AND b IS NULL))
   AND (perm='organization.read' OR g.role NOT IN ('employee','manager') OR employee=u.employee_id
     OR (g.role='manager' AND EXISTS (SELECT 1 FROM public.team_links l WHERE l.tenant_id=t AND l.manager_id=u.employee_id AND l.employee_id=employee)))
 );
$$;

-- A row lock on the company limit serializes concurrent employee inserts.
CREATE OR REPLACE FUNCTION platform_enforce_employee_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE company_rule platform_company_limits%ROWTYPE; tenant_rule platform_tenants%ROWTYPE;
BEGIN
 SELECT * INTO tenant_rule FROM platform_tenants WHERE tenant_id=NEW.tenant_id FOR UPDATE;
 SELECT * INTO company_rule FROM platform_company_limits WHERE company_id=NEW.company_id FOR UPDATE;
 IF tenant_rule.tenant_id IS NULL OR company_rule.company_id IS NULL THEN
   RAISE EXCEPTION 'Organization limits are not configured' USING ERRCODE='23514';
 END IF;
 IF tenant_rule.status='suspended' OR company_rule.status='suspended' THEN
   RAISE EXCEPTION 'Organization access is suspended' USING ERRCODE='23514';
 END IF;
 IF tenant_rule.employee_limit IS NOT NULL AND
   (SELECT count(*) FROM employees WHERE tenant_id=NEW.tenant_id) >= tenant_rule.employee_limit THEN
   RAISE EXCEPTION 'Firm employee limit reached' USING ERRCODE='23514';
 END IF;
 IF company_rule.employee_limit IS NOT NULL AND
   (SELECT count(*) FROM employees WHERE company_id=NEW.company_id) >= company_rule.employee_limit THEN
   RAISE EXCEPTION 'Company employee limit reached' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS employees_platform_limit ON employees;
CREATE TRIGGER employees_platform_limit BEFORE INSERT ON employees
FOR EACH ROW EXECUTE FUNCTION platform_enforce_employee_limit();
REVOKE ALL ON FUNCTION platform_enforce_employee_limit() FROM PUBLIC;
