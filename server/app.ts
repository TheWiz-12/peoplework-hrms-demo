import "reflect-metadata";
import { Module, Controller, All, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response } from "express";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { Database, Q } from "./db";
import {
  roles,
  modules,
  uuid,
  date,
  employeeSchema,
  policySchema,
  leaveSchema,
  recordSchema,
  recordModules,
  statusSchema,
  money,
  calculatePayroll,
  csvCell,
} from "./domain";
import {
  digest,
  token,
  checkPassword,
  hashPassword,
  safeEqual,
} from "./security";
import { seed } from "./seed";
import { answerHelp, articles } from "./support";

type Actor = {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  employee_id: string | null;
  csrf: string;
  grants: any[];
};
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const bad = (s: number, m: string): never => {
  throw new HttpError(s, m);
};
const parseId = (s: string) => uuid.parse(s);
const object = (rows: any[]) => rows[0] || bad(404, "Record not found");
async function audit(
  q: Q,
  a: Actor,
  action: string,
  id: string,
  c: string | null = null,
  b: string | null = null,
) {
  await q.query(
    "INSERT INTO audit_logs(id,tenant_id,company_id,branch_id,actor_id,action,resource_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), a.tenant_id, c, b, a.id, action, id],
  );
}
export async function createApp(
  options: { memory?: boolean; demo?: boolean } = {},
) {
  const db = new Database(options.memory);
  await db.init();
  const demo =
    options.demo ??
    (process.env.DEMO_MODE === "true" ||
      (process.env.NODE_ENV !== "production" &&
        process.env.DEMO_MODE !== "false"));
  if (demo) await seed(db);
  // Render supplies its canonical public HTTPS URL. An explicit APP_ORIGIN
  // still takes precedence for self-hosted production deployments.
  const origin =
    process.env.APP_ORIGIN ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://127.0.0.1:5173";
  const production = process.env.NODE_ENV === "production";
  if (production && !origin.startsWith("https://"))
    throw new Error("Production APP_ORIGIN must use HTTPS");
  async function authenticate(req: Request): Promise<Actor> {
    const raw = req.cookies?.["pw_session"];
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) bad(401, "Please sign in");
    return db.as("hrms_auth", null, async (q) => {
      const r = await q.query(
        "SELECT u.id,u.tenant_id,u.name,u.email,u.employee_id,s.csrf FROM auth.sessions s JOIN auth.users u ON u.id=s.user_id LEFT JOIN platform_tenants pt ON pt.tenant_id=u.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND coalesce(pt.status,'active')='active' AND EXISTS(SELECT 1 FROM auth.grants g LEFT JOIN platform_company_limits pcl ON pcl.company_id=g.company_id WHERE g.user_id=u.id AND (g.company_id IS NULL OR pcl.status='active'))",
        [digest(raw)],
      );
      const a = r.rows[0];
      if (!a) bad(401, "Session expired; please sign in");
      a.grants = (
        await q.query(
          "SELECT g.id,g.role,g.company_id,g.branch_id,g.permissions FROM auth.grants g LEFT JOIN platform_company_limits pcl ON pcl.company_id=g.company_id WHERE g.user_id=$1 AND g.tenant_id=$2 AND (g.company_id IS NULL OR pcl.status='active')",
          [a.id, a.tenant_id],
        )
      ).rows;
      return a;
    });
  }
  function permission(
    a: Actor,
    p: string,
    c?: string | null,
    b?: string | null,
  ) {
    return a.grants.some(
      (g) =>
        (g.permissions.includes("*") || g.permissions.includes(p)) &&
        (!c || !g.company_id || g.company_id === c) &&
        (!b || !g.branch_id || g.branch_id === b),
    );
  }
  function must(a: Actor, p: string, c?: string | null, b?: string | null) {
    if (!permission(a, p, c, b)) bad(403, "This action is outside your access");
  }
  async function scope<T>(a: Actor, fn: (q: Q) => Promise<T>) {
    return db.as("hrms_app", a.id, fn);
  }
  async function handle(req: Request, res: Response) {
    try {
      const path = req.path.replace(/^\/api/, "").replace(/\/$/, "") || "/";
      const method = req.method;
      if (req.headers["x-http-method-override"])
        bad(400, "Method override is not supported");
      if (path === "/health" && method === "GET")
        return res.json({ status: "ok", demo });
      if (path === "/session" && method === "POST") {
        if (req.headers.origin && req.headers.origin !== origin)
          bad(403, "Origin not allowed");
        const input = z
          .object({
            email: z.string().email().max(160),
            password: z.string().min(1).max(200),
          })
          .strict()
          .parse(req.body);
        const result = await db.as("hrms_auth", null, async (q) => {
          const key = digest(input.email.toLowerCase());
          const attempts = (
            await q.query(
              "SELECT attempts FROM auth.login_attempts WHERE key=$1 AND expires_at>now()",
              [key],
            )
          ).rows[0];
          if (attempts?.attempts >= 10)
            bad(429, "Too many sign-in attempts; try again later");
          const u = (
            await q.query(
              "SELECT u.* FROM auth.users u LEFT JOIN platform_tenants pt ON pt.tenant_id=u.tenant_id WHERE u.email=$1 AND u.active AND coalesce(pt.status,'active')='active' AND EXISTS(SELECT 1 FROM auth.grants g LEFT JOIN platform_company_limits pcl ON pcl.company_id=g.company_id WHERE g.user_id=u.id AND (g.company_id IS NULL OR pcl.status='active'))",
              [input.email.toLowerCase()],
            )
          ).rows[0];
          const dummy = "00000000000000000000000000000000:" + "0".repeat(128);
          const valid = checkPassword(
            input.password,
            u?.password_hash || dummy,
          );
          if (!u || !valid) {
            await q.query(
              "INSERT INTO auth.login_attempts VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth.login_attempts.expires_at<now() THEN 1 ELSE auth.login_attempts.attempts+1 END,expires_at=now()+interval '15 minutes'",
              [key],
            );
            return null;
          }
          await q.query("DELETE FROM auth.login_attempts WHERE key=$1", [key]);
          const raw = token(),
            csrf = token();
          await q.query(
            "INSERT INTO auth.sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
            [digest(raw), u.id, csrf],
          );
          return { raw, csrf };
        });
        if (!result) throw new HttpError(401, "Invalid email or password");
        res.cookie("pw_session", result.raw, {
          httpOnly: true,
          secure: production,
          sameSite: "strict",
          path: "/",
          maxAge: 8 * 3600000,
        });
        return res.json({ csrf: result.csrf });
      }
      if (path === "/biometric/events" && method === "POST") {
        const deviceId = uuid.parse(req.headers["x-device-id"]);
        const stamp = String(req.headers["x-timestamp"] || "");
        const nonce = String(req.headers["x-nonce"] || "");
        const signature = String(req.headers["x-signature"] || "");
        if (
          !/^\d{13}$/.test(stamp) ||
          Math.abs(Date.now() - Number(stamp)) > 300000 ||
          !/^[-a-zA-Z0-9]{16,100}$/.test(nonce)
        )
          bad(401, "Invalid device envelope");
        const device = await db.as(
          "hrms_auth",
          null,
          async (q) =>
            (
              await q.query(
                "SELECT * FROM auth.devices WHERE id=$1 AND active",
                [deviceId],
              )
            ).rows[0],
        );
        if (!device) bad(401, "Invalid device envelope");
        const expected = createHmac("sha256", device.secret)
          .update(`${stamp}.${nonce}.` + ((req as any).rawBody || ""))
          .digest("hex");
        if (!safeEqual(expected, signature)) bad(401, "Invalid signature");
        const e = z
          .object({
            employeeCode: z.string().min(1).max(30),
            occurredAt: z.string().datetime({ offset: true }),
            eventId: z.string().min(1).max(100),
            direction: z.enum(["in", "out", "unknown"]).default("unknown"),
          })
          .strict()
          .parse(req.body);
        // Device ingestion uses a separate narrowly scoped, SECURITY DEFINER function.
        const r = await db.as("hrms_auth", null, (q) =>
          q.query("SELECT auth.ingest_event($1,$2,$3,$4,$5,$6) AS accepted", [
            deviceId,
            e.employeeCode,
            e.occurredAt,
            e.eventId,
            e.direction,
            nonce,
          ]),
        );
        return res.status(202).json({ accepted: r.rows[0].accepted });
      }
      const a = await authenticate(req);
      if (!["GET", "HEAD"].includes(method)) {
        if (req.headers.origin && req.headers.origin !== origin)
          bad(403, "Origin not allowed");
        if (!safeEqual(String(req.headers["x-csrf-token"] || ""), a.csrf))
          bad(403, "Invalid request token");
        if (!req.is("application/json")) bad(415, "JSON content type required");
      }
      if (path === "/session" && method === "GET")
        return res.json({
          user: {
            id: a.id,
            name: a.name,
            email: a.email,
            employeeId: a.employee_id,
          },
          grants: a.grants,
          csrf: a.csrf,
          demo,
          modelConfigured: !!process.env.LOCAL_MODEL_URL,
        });
      if (path === "/session" && method === "DELETE") {
        await db.as("hrms_auth", null, (q) =>
          q.query("DELETE FROM auth.sessions WHERE token_hash=$1", [
            digest(req.cookies.pw_session),
          ]),
        );
        res.clearCookie("pw_session", { path: "/" });
        return res.json({ ok: true });
      }
      const platformOwner = a.grants.some((g) => g.role === "platform_owner");
      if (path.startsWith("/platform")) {
        if (!platformOwner) bad(403, "AS Communications platform owner required");
        if (path === "/platform/overview" && method === "GET")
          return res.json(await db.owner(async (q) => {
            const tenants = (await q.query(
              "SELECT t.id,t.name,coalesce(pt.status,'active') AS status,coalesce(pt.employee_limit,10000) AS employee_limit,(SELECT count(*)::int FROM companies c WHERE c.tenant_id=t.id) AS company_count,(SELECT count(*)::int FROM employees e WHERE e.tenant_id=t.id) AS employee_count FROM tenants t LEFT JOIN platform_tenants pt ON pt.tenant_id=t.id WHERE t.id<>$1 ORDER BY t.name",
              [a.tenant_id],
            )).rows;
            const companies = (await q.query(
              "SELECT c.id,c.tenant_id,c.name,c.code,coalesce(pcl.status,'active') AS status,coalesce(pcl.employee_limit,1000) AS employee_limit,(SELECT count(*)::int FROM employees e WHERE e.company_id=c.id) AS employee_count,(SELECT count(*)::int FROM branches b WHERE b.company_id=c.id) AS branch_count FROM companies c LEFT JOIN platform_company_limits pcl ON pcl.company_id=c.id WHERE c.tenant_id<>$1 ORDER BY c.name",
              [a.tenant_id],
            )).rows;
            return { tenants, companies, totals: { tenants: tenants.length, companies: companies.length, employees: tenants.reduce((n: number, t: any) => n + Number(t.employee_count), 0) } };
          }));
        if (path === "/platform/tenants" && method === "POST") {
          const x = z.object({
            firmName: z.string().trim().min(2).max(120),
            adminName: z.string().trim().min(2).max(120),
            adminEmail: z.string().email().max(160),
            adminPassword: z.string().min(14).max(200),
            employeeLimit: z.number().int().min(1).max(100000),
          }).strict().parse(req.body);
          return res.status(201).json(await db.owner(async (q) => {
            const tenantId = randomUUID(), userId = randomUUID();
            await q.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [tenantId,x.firmName]);
            await q.query("INSERT INTO platform_tenants(tenant_id,employee_limit) VALUES($1,$2)", [tenantId,x.employeeLimit]);
            await q.query("INSERT INTO auth.users(id,tenant_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)", [userId,tenantId,x.adminName,x.adminEmail.toLowerCase(),hashPassword(x.adminPassword)]);
            await q.query("INSERT INTO auth.grants(id,tenant_id,user_id,role,company_id,permissions) VALUES($1,$2,$3,'firm_admin',NULL,$4)", [randomUUID(),tenantId,userId,roles.firm_admin]);
            await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,'tenant.created',$3)", [randomUUID(),a.id,tenantId]);
            return { id: tenantId, adminEmail: x.adminEmail.toLowerCase() };
          }));
        }
        const tenantMatch = path.match(/^\/platform\/tenants\/([^/]+)$/);
        if (tenantMatch && method === "PATCH") {
          const id = parseId(tenantMatch[1]);
          const x = z.object({ status: z.enum(["active","suspended"]).optional(), employeeLimit: z.number().int().min(1).max(100000).optional() }).strict().refine(v=>v.status!==undefined || v.employeeLimit!==undefined).parse(req.body);
          if (id === a.tenant_id) bad(403,"Cannot change the owner control plane");
          return res.json(await db.owner(async(q)=>{
            const current=object((await q.query("SELECT * FROM platform_tenants WHERE tenant_id=$1 FOR UPDATE",[id])).rows);
            if(x.employeeLimit!==undefined) {
              const allocation=(await q.query("SELECT coalesce(sum(pcl.employee_limit),0)::int AS allocated FROM platform_company_limits pcl JOIN companies c ON c.id=pcl.company_id WHERE c.tenant_id=$1",[id])).rows[0].allocated;
              const employees=(await q.query("SELECT count(*)::int AS total FROM employees WHERE tenant_id=$1",[id])).rows[0].total;
              const minimum=Math.max(allocation,employees);
              if(x.employeeLimit<minimum) bad(409,`Firm needs a limit of at least ${minimum} for existing company allocations and employees`);
              await q.query("UPDATE platform_tenants SET status=$1,employee_limit=$2 WHERE tenant_id=$3",[x.status||current.status,x.employeeLimit,id]);
            } else if(x.status) await q.query("UPDATE platform_tenants SET status=$1 WHERE tenant_id=$2",[x.status,id]);
            if(x.status==="suspended") await q.query("DELETE FROM auth.sessions WHERE user_id IN(SELECT id FROM auth.users WHERE tenant_id=$1)",[id]);
            await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,$3,$4)",[randomUUID(),a.id,"tenant.updated",id]);
            return {ok:true};
          }));
        }
        if (path === "/platform/companies" && method === "POST") {
          const administrator=z.object({name:z.string().trim().min(2).max(120),email:z.string().email().max(160),password:z.string().min(14).max(200)}).strict();
          const x=z.object({tenantId:uuid,name:z.string().trim().min(2).max(120),code:z.string().regex(/^[A-Z0-9_-]{2,12}$/),employeeLimit:z.number().int().min(1).max(100000),companyAdmin:administrator.optional(),hrAdmin:administrator.optional()}).strict().parse(req.body);
          if(x.companyAdmin && x.hrAdmin && x.companyAdmin.email.toLowerCase()===x.hrAdmin.email.toLowerCase()) bad(400,"Company and HR administrators need different email addresses");
          return res.status(201).json(await db.owner(async(q)=>{
            const tenant=object((await q.query("SELECT pt.*,t.name FROM platform_tenants pt JOIN tenants t ON t.id=pt.tenant_id WHERE pt.tenant_id=$1 AND pt.tenant_id<>$2 FOR UPDATE",[x.tenantId,a.tenant_id])).rows);
            if(tenant.status!=="active") bad(409,"Firm is suspended");
            const allocated=(await q.query("SELECT coalesce(sum(pcl.employee_limit),0)::int AS total FROM platform_company_limits pcl JOIN companies c ON c.id=pcl.company_id WHERE c.tenant_id=$1",[x.tenantId])).rows[0].total;
            const remaining=tenant.employee_limit-allocated;
            if(x.employeeLimit>remaining) bad(409,`Only ${Math.max(0,remaining)} employee slots remain in ${tenant.name}; increase the firm limit or reduce another company limit`);
            const id=randomUUID();
            await q.query("INSERT INTO companies(id,tenant_id,name,code) VALUES($1,$2,$3,$4)",[id,x.tenantId,x.name,x.code]);
            await q.query("UPDATE platform_company_limits SET employee_limit=$2 WHERE company_id=$1",[id,x.employeeLimit]);
            for(const [role,admin] of [["company_admin",x.companyAdmin],["hr",x.hrAdmin]] as const) {
              if(!admin) continue;
              const userId=randomUUID();
              await q.query("INSERT INTO auth.users(id,tenant_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)",[userId,x.tenantId,admin.name,admin.email.toLowerCase(),hashPassword(admin.password)]);
              await q.query("INSERT INTO auth.grants(id,tenant_id,user_id,role,company_id,permissions) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),x.tenantId,userId,role,id,roles[role]]);
              await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,'user.created',$3)",[randomUUID(),a.id,userId]);
            }
            await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,'company.created',$3)",[randomUUID(),a.id,id]);
            return {id};
          }));
        }
        const firmAdminsMatch=path.match(/^\/platform\/tenants\/([^/]+)\/administrators$/);
        if(firmAdminsMatch && method==="GET") {
          const tenantId=parseId(firmAdminsMatch[1]);
          if(tenantId===a.tenant_id) bad(403,"Owner account details are not shown here");
          return res.json(await db.owner(async(q)=>{
            object((await q.query("SELECT id FROM tenants WHERE id=$1",[tenantId])).rows);
            return (await q.query("SELECT u.id,u.name,u.email,u.active,g.role,g.company_id,c.name AS company_name FROM auth.grants g JOIN auth.users u ON u.id=g.user_id AND u.tenant_id=g.tenant_id LEFT JOIN companies c ON c.id=g.company_id WHERE g.tenant_id=$1 AND g.role IN ('firm_admin','company_admin','hr') ORDER BY CASE g.role WHEN 'firm_admin' THEN 0 WHEN 'company_admin' THEN 1 ELSE 2 END,c.name,u.name",[tenantId])).rows;
          }));
        }
        if (path === "/platform/users" && method === "POST") {
          const x=z.object({tenantId:uuid,companyId:uuid.optional(),name:z.string().trim().min(2).max(120),email:z.string().email().max(160),password:z.string().min(14).max(200),role:z.enum(["firm_admin","company_admin","hr"])}).strict().parse(req.body);
          if (x.role!=="firm_admin" && !x.companyId) bad(400,"A company is required for this role");
          if (x.role==="firm_admin" && x.companyId) bad(400,"Firm admin must not be company-scoped");
          return res.status(201).json(await db.owner(async(q)=>{
            const t=object((await q.query("SELECT * FROM platform_tenants WHERE tenant_id=$1 AND tenant_id<>$2",[x.tenantId,a.tenant_id])).rows);
            if(t.status!=="active") bad(409,"Firm is suspended");
            if(x.companyId) {
              const c=object((await q.query("SELECT pcl.status FROM companies c JOIN platform_company_limits pcl ON pcl.company_id=c.id WHERE c.id=$1 AND c.tenant_id=$2",[x.companyId,x.tenantId])).rows);
              if(c.status!=="active") bad(409,"Company is suspended");
            }
            const id=randomUUID();
            await q.query("INSERT INTO auth.users(id,tenant_id,name,email,password_hash) VALUES($1,$2,$3,$4,$5)",[id,x.tenantId,x.name,x.email.toLowerCase(),hashPassword(x.password)]);
            await q.query("INSERT INTO auth.grants(id,tenant_id,user_id,role,company_id,permissions) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),x.tenantId,id,x.role,x.companyId||null,roles[x.role]]);
            await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,'user.created',$3)",[randomUUID(),a.id,id]);
            return {id,email:x.email.toLowerCase()};
          }));
        }
        const platformUserMatch=path.match(/^\/platform\/users\/([^/]+)$/);
        if(platformUserMatch && method==="PATCH") {
          const id=parseId(platformUserMatch[1]);
          const x=z.object({name:z.string().trim().min(2).max(120).optional(),email:z.string().email().max(160).optional(),newPassword:z.string().min(14).max(200).optional()}).strict().refine(v=>v.name!==undefined||v.email!==undefined||v.newPassword!==undefined).parse(req.body);
          return res.json(await db.owner(async(q)=>{
            const user=object((await q.query("SELECT u.id,u.tenant_id FROM auth.users u WHERE u.id=$1 AND u.tenant_id<>$2 AND EXISTS(SELECT 1 FROM auth.grants g WHERE g.user_id=u.id AND g.tenant_id=u.tenant_id AND g.role IN ('firm_admin','company_admin','hr')) FOR UPDATE",[id,a.tenant_id])).rows);
            await q.query("UPDATE auth.users SET name=coalesce($1,name),email=coalesce($2,email),password_hash=coalesce($3,password_hash) WHERE id=$4",[x.name??null,x.email?.toLowerCase()??null,x.newPassword?hashPassword(x.newPassword):null,id]);
            if(x.email!==undefined||x.newPassword!==undefined) await q.query("DELETE FROM auth.sessions WHERE user_id=$1",[id]);
            await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,'user.updated',$3)",[randomUUID(),a.id,user.id]);
            return {ok:true};
          }));
        }
        const companyMatch=path.match(/^\/platform\/companies\/([^/]+)$/);
        if(companyMatch && method==="PATCH") {
          const id=parseId(companyMatch[1]);
          const x=z.object({status:z.enum(["active","suspended"]).optional(),employeeLimit:z.number().int().min(1).max(100000).optional()}).strict().refine(v=>v.status!==undefined || v.employeeLimit!==undefined).parse(req.body);
          return res.json(await db.owner(async(q)=>{
            const company=object((await q.query("SELECT c.tenant_id,c.name FROM companies c WHERE c.id=$1 AND c.tenant_id<>$2",[id,a.tenant_id])).rows);
            const firm=object((await q.query("SELECT employee_limit FROM platform_tenants WHERE tenant_id=$1 FOR UPDATE",[company.tenant_id])).rows);
            const current=object((await q.query("SELECT * FROM platform_company_limits WHERE company_id=$1 FOR UPDATE",[id])).rows);
            if(x.employeeLimit!==undefined) {
              const used=(await q.query("SELECT count(*)::int AS total FROM employees WHERE company_id=$1",[id])).rows[0].total;
              if(x.employeeLimit<used) bad(409,`${company.name} already has ${used} employees; its limit cannot be lower`);
              const otherAllocated=(await q.query("SELECT coalesce(sum(pcl.employee_limit),0)::int AS total FROM platform_company_limits pcl JOIN companies c ON c.id=pcl.company_id WHERE c.tenant_id=$1 AND pcl.company_id<>$2",[company.tenant_id,id])).rows[0].total;
              const available=firm.employee_limit-otherAllocated;
              if(x.employeeLimit>current.employee_limit && x.employeeLimit>available) bad(409,`Only ${Math.max(0,available)} employee slots are available for ${company.name}; increase the firm limit or reduce another company limit`);
              await q.query("UPDATE platform_company_limits SET status=$1,employee_limit=$2 WHERE company_id=$3",[x.status||current.status,x.employeeLimit,id]);
            } else if(x.status) await q.query("UPDATE platform_company_limits SET status=$1 WHERE company_id=$2",[x.status,id]);
            if(x.status==="suspended") await q.query("DELETE FROM auth.sessions WHERE user_id IN(SELECT u.id FROM auth.users u JOIN auth.grants g ON g.user_id=u.id WHERE g.company_id=$1)",[id]);
            await q.query("INSERT INTO platform_audit(id,actor_id,action,target_id) VALUES($1,$2,'company.updated',$3)",[randomUUID(),a.id,id]);
            return {ok:true};
          }));
        }
        const peopleMatch=path.match(/^\/platform\/companies\/([^/]+)\/employees$/);
        if(peopleMatch && method==="GET") {
          const id=parseId(peopleMatch[1]);
          return res.json(await db.owner(async(q)=>{
            object((await q.query("SELECT c.id FROM companies c WHERE c.id=$1 AND c.tenant_id<>$2",[id,a.tenant_id])).rows);
            return (await q.query("SELECT id,code,name,department,designation,employment_type,status FROM employees WHERE company_id=$1 ORDER BY name LIMIT 1000",[id])).rows;
          }));
        }
        bad(404,"Platform endpoint not found");
      }
      if (platformOwner && !path.startsWith("/help/")) bad(403,"Use the platform workspace");
      const company = req.query.companyId
        ? uuid.parse(req.query.companyId)
        : null;
      const branch = req.query.branchId ? uuid.parse(req.query.branchId) : null;
      if (
        company &&
        !a.grants.some((g) => !g.company_id || g.company_id === company)
      )
        bad(403, "Company is outside your access");
      if (
        branch &&
        !a.grants.some((g) => !g.branch_id || g.branch_id === branch)
      )
        bad(403, "Branch is outside your access");
      if (path === "/organization" && method === "GET")
        return res.json(
          await scope(a, async (q) => ({
            companies: (await q.query("SELECT * FROM companies ORDER BY name"))
              .rows,
            branches: (await q.query("SELECT * FROM branches ORDER BY name"))
              .rows,
          })),
        );
      if (path === "/companies" && method === "POST") {
        if (!a.grants.some((g) => g.role === "firm_admin" && !g.company_id))
          bad(403, "Firm administrator required");
        const x = z
          .object({
            name: z.string().trim().min(2).max(120),
            code: z.string().regex(/^[A-Z0-9_-]{2,12}$/),
          })
          .strict()
          .parse(req.body);
        return res.status(201).json(
          await scope(a, async (q) => {
            const id = randomUUID();
            await q.query("INSERT INTO companies VALUES($1,$2,$3,$4)", [
              id,
              a.tenant_id,
              x.name,
              x.code,
            ]);
            await audit(q, a, "company.created", id, id);
            return { id };
          }),
        );
      }
      if (path === "/branches" && method === "POST") {
        const x = z
          .object({ companyId: uuid, name: z.string().trim().min(2).max(120) })
          .strict()
          .parse(req.body);
        must(a, "organization.write", x.companyId);
        return res.status(201).json(
          await scope(a, async (q) => {
            const id = randomUUID();
            await q.query(
              "INSERT INTO branches(id,tenant_id,company_id,name) VALUES($1,$2,$3,$4)",
              [id, a.tenant_id, x.companyId, x.name],
            );
            await audit(q, a, "branch.created", id, x.companyId, id);
            return { id };
          }),
        );
      }
      const branchMatch = path.match(/^\/branches\/([0-9a-f-]+)$/i);
      if (branchMatch && (method === "PATCH" || method === "DELETE")) {
        const id = parseId(branchMatch[1]);
        if (!a.grants.some((g) => g.role === "firm_admin" || g.role === "company_admin"))
          bad(403, "Firm or company administrator required");
        const branchRecord = await scope(a, async (q) => object((await q.query(
          "SELECT id,company_id,name FROM branches WHERE id=$1 AND tenant_id=$2", [id,a.tenant_id],
        )).rows));
        must(a, "organization.write", branchRecord.company_id, id);
        if (!a.grants.some((g) =>
          (g.role === "firm_admin" || g.role === "company_admin") &&
          (!g.company_id || g.company_id === branchRecord.company_id) &&
          (!g.branch_id || g.branch_id === id)))
          bad(403, "Firm or company administrator required for this branch");
        if (method === "PATCH") {
          const x = z.object({name:z.string().trim().min(2).max(120)}).strict().parse(req.body);
          return res.json(await scope(a, async (q) => {
            const updated = object((await q.query(
              "UPDATE branches SET name=$1 WHERE id=$2 AND tenant_id=$3 AND company_id=$4 RETURNING id,name",
              [x.name,id,a.tenant_id,branchRecord.company_id],
            )).rows);
            await audit(q,a,"branch.renamed",id,branchRecord.company_id,id);
            return updated;
          }));
        }
        const linkedAccess = await db.as("hrms_auth",a.id,async(q) => (await q.query(
          "SELECT EXISTS(SELECT 1 FROM auth.grants WHERE tenant_id=$1 AND branch_id=$2) OR EXISTS(SELECT 1 FROM auth.devices WHERE tenant_id=$1 AND branch_id=$2) AS used",
          [a.tenant_id,id],
        )).rows[0].used);
        if (linkedAccess) bad(409,"Branch has assigned users or biometric devices. Reassign them before removing it.");
        return res.json(await scope(a, async(q) => {
          const linked = (await q.query(
            "SELECT EXISTS(SELECT 1 FROM employees WHERE branch_id=$1) OR EXISTS(SELECT 1 FROM policies WHERE branch_id=$1) OR EXISTS(SELECT 1 FROM attendance WHERE branch_id=$1) OR EXISTS(SELECT 1 FROM leave_requests WHERE branch_id=$1) OR EXISTS(SELECT 1 FROM records WHERE branch_id=$1) OR EXISTS(SELECT 1 FROM salary_assignments WHERE branch_id=$1) OR EXISTS(SELECT 1 FROM payroll_runs WHERE branch_id=$1) AS used",
            [id],
          )).rows[0].used;
          if (linked) bad(409,"Branch has employees or historical records. Move or resolve them before removing it.");
          object((await q.query(
            "DELETE FROM branches WHERE id=$1 AND tenant_id=$2 AND company_id=$3 RETURNING id",
            [id,a.tenant_id,branchRecord.company_id],
          )).rows);
          await audit(q,a,"branch.removed",id,branchRecord.company_id);
          return {id,removed:true};
        }));
      }
      if (path === "/employees" && method === "GET") {
        must(a, "employees.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT e.*,c.name AS company_name,b.name AS branch_name FROM employees e JOIN companies c ON c.id=e.company_id JOIN branches b ON b.id=e.branch_id WHERE ($1::uuid IS NULL OR e.company_id=$1) AND ($2::uuid IS NULL OR e.branch_id=$2) ORDER BY e.name LIMIT 1000",
                  [company, branch],
                )
              ).rows,
          ),
        );
      }
      if (path === "/employees" && method === "POST") {
        const x = employeeSchema.parse(req.body);
        must(a, "employees.write", x.companyId, x.branchId);
        return res.status(201).json(
          await scope(a, async (q) => {
            const id = randomUUID();
            await q.query(
              "INSERT INTO employees(id,tenant_id,company_id,branch_id,code,name,email,department,designation,employment_type,joined_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
              [
                id,
                a.tenant_id,
                x.companyId,
                x.branchId,
                x.code,
                x.name,
                x.email,
                x.department,
                x.designation,
                x.employmentType,
                x.joinedOn,
              ],
            );
            await audit(q, a, "employee.created", id, x.companyId, x.branchId);
            return { id };
          }),
        );
      }
      if (path === "/employees/import" && method === "POST") {
        const x=z.object({companyId:uuid,branchId:uuid,source:z.enum(["csv","sqlserver","access","other"]),rows:z.array(employeeSchema.omit({companyId:true,branchId:true})).min(1).max(200)}).strict().parse(req.body);
        must(a,"employees.write",x.companyId,x.branchId);
        const codes=new Set<string>();
        for(const row of x.rows) {
          const code=row.code.toLowerCase();
          if(codes.has(code)) bad(400,`Duplicate employee code in import: ${row.code}`);
          codes.add(code);
        }
        return res.status(201).json(await scope(a,async(q)=>{
          object((await q.query("SELECT id FROM branches WHERE tenant_id=$1 AND company_id=$2 AND id=$3",[a.tenant_id,x.companyId,x.branchId])).rows);
          const found=(await q.query("SELECT code FROM employees WHERE company_id=$1 AND lower(code)=ANY($2::text[])",[x.companyId,Array.from(codes)])).rows;
          if(found.length) bad(409,`Employee code already exists: ${found[0].code}`);
          const batchId=randomUUID();
          for(const row of x.rows) {
            const id=randomUUID();
            await q.query("INSERT INTO employees(id,tenant_id,company_id,branch_id,code,name,email,department,designation,employment_type,joined_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[id,a.tenant_id,x.companyId,x.branchId,row.code,row.name,row.email,row.department,row.designation,row.employmentType,row.joinedOn]);
            await audit(q,a,"employee.imported",id,x.companyId,x.branchId);
          }
          await audit(q,a,`employee.import.${x.source}`,batchId,x.companyId,x.branchId);
          return {batchId,imported:x.rows.length};
        }));
      }
      const empMatch = path.match(/^\/employees\/([^/]+)$/);
      if (empMatch) {
        const id = parseId(empMatch[1]);
        if (method === "GET")
          return res.json(
            await scope(a, async (q) =>
              object(
                (await q.query("SELECT * FROM employees WHERE id=$1", [id]))
                  .rows,
              ),
            ),
          );
        if (method === "PATCH") {
          const x = z
            .object({ status: z.enum(["active", "inactive"]) })
            .strict()
            .parse(req.body);
          return res.json(
            await scope(a, async (q) => {
              const e = object(
                (await q.query("SELECT * FROM employees WHERE id=$1", [id]))
                  .rows,
              );
              must(a, "employees.write", e.company_id, e.branch_id);
              await q.query("UPDATE employees SET status=$1 WHERE id=$2", [
                x.status,
                id,
              ]);
              await audit(
                q,
                a,
                "employee." + x.status,
                id,
                e.company_id,
                e.branch_id,
              );
              return { ok: true };
            }),
          );
        }
      }
      if (path === "/policies" && method === "GET") {
        must(a, "policies.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT p.*,c.name AS company_name FROM policies p JOIN companies c ON c.id=p.company_id WHERE ($1::uuid IS NULL OR p.company_id=$1) ORDER BY p.name,p.version DESC",
                  [company],
                )
              ).rows,
          ),
        );
      }
      if (path === "/policies" && method === "POST") {
        const x = policySchema.parse(req.body);
        must(a, "policies.write", x.companyId, x.branchId);
        return res.status(201).json(
          await scope(a, async (q) => {
            const id = randomUUID();
            const v = (
              await q.query(
                "SELECT coalesce(max(version),0)+1 AS v FROM policies WHERE company_id=$1 AND name=$2",
                [x.companyId, x.name],
              )
            ).rows[0].v;
            await q.query(
              "INSERT INTO policies(id,tenant_id,company_id,branch_id,name,employment_type,version,effective_from,rules,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft')",
              [
                id,
                a.tenant_id,
                x.companyId,
                x.branchId || null,
                x.name,
                x.employmentType,
                v,
                x.effectiveFrom,
                JSON.stringify(x.rules),
              ],
            );
            await audit(
              q,
              a,
              "policy.drafted",
              id,
              x.companyId,
              x.branchId || null,
            );
            return { id };
          }),
        );
      }
      const policyMatch = path.match(/^\/policies\/([^/]+)\/publish$/);
      if (policyMatch && method === "POST") {
        const id = parseId(policyMatch[1]);
        return res.json(
          await scope(a, async (q) => {
            const p = object(
              (
                await q.query("SELECT * FROM policies WHERE id=$1 FOR UPDATE", [
                  id,
                ])
              ).rows,
            );
            must(a, "policies.write", p.company_id, p.branch_id);
            if (p.status !== "draft") bad(409, "Only drafts may be published");
            await q.query(
              "UPDATE policies SET status='published' WHERE id=$1",
              [id],
            );
            await audit(
              q,
              a,
              "policy.published",
              id,
              p.company_id,
              p.branch_id,
            );
            return { ok: true };
          }),
        );
      }
      if (path === "/attendance" && method === "GET") {
        must(a, "attendance.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT t.*,e.name,e.code,b.name AS branch_name FROM attendance t JOIN employees e ON e.id=t.employee_id JOIN branches b ON b.id=t.branch_id WHERE ($1::uuid IS NULL OR t.company_id=$1) ORDER BY occurred_at DESC LIMIT 1000",
                  [company],
                )
              ).rows,
          ),
        );
      }
      if (path === "/attendance" && method === "POST") {
        const x = z
          .object({
            employeeId: uuid,
            occurredAt: z.string().datetime({ offset: true }),
            direction: z.enum(["in", "out"]),
            note: z.string().trim().min(5).max(500),
          })
          .strict()
          .parse(req.body);
        return res.status(201).json(
          await scope(a, async (q) => {
            const e = object(
              (
                await q.query(
                  "SELECT * FROM employees WHERE id=$1 AND status=$2",
                  [x.employeeId, "active"],
                )
              ).rows,
            );
            must(a, "attendance.write", e.company_id, e.branch_id);
            const id = randomUUID();
            await q.query(
              "INSERT INTO attendance(id,tenant_id,company_id,branch_id,employee_id,occurred_at,direction,source,event_key,note) VALUES($1,$2,$3,$4,$5,$6,$7,'manual',$8,$9)",
              [
                id,
                a.tenant_id,
                e.company_id,
                e.branch_id,
                e.id,
                x.occurredAt,
                x.direction,
                "manual:" + id,
                x.note,
              ],
            );
            await audit(
              q,
              a,
              "attendance.manual",
              id,
              e.company_id,
              e.branch_id,
            );
            return { id };
          }),
        );
      }
      if (path === "/leave" && method === "GET") {
        must(a, "leave.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT l.*,e.name,e.code FROM leave_requests l JOIN employees e ON e.id=l.employee_id WHERE ($1::uuid IS NULL OR l.company_id=$1) ORDER BY l.created_at DESC",
                  [company],
                )
              ).rows,
          ),
        );
      }
      if (path === "/leave" && method === "POST") {
        const x = leaveSchema.parse(req.body);
        return res.status(201).json(
          await scope(a, async (q) => {
            const e = object(
              (
                await q.query(
                  "SELECT * FROM employees WHERE id=$1 AND status=$2",
                  [x.employeeId, "active"],
                )
              ).rows,
            );
            must(a, "leave.write", e.company_id, e.branch_id);
            // Serialize requests for one employee without requiring employee-edit privileges.
            await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [e.id]);
            const clashes = await q.query(
              "SELECT id FROM leave_requests WHERE employee_id=$1 AND status IN ('pending','approved') AND start_date<=$3 AND end_date>=$2",
              [e.id, x.startDate, x.endDate],
            );
            if (clashes.rows.length)
              bad(409, "These dates overlap an existing leave request");
            if (x.startDate.slice(0, 4) !== x.endDate.slice(0, 4))
              bad(400, "Submit separate requests for each calendar year");
            const rules = (
              await q.query("SELECT auth.leave_policy($1,$2) AS rules", [
                e.id,
                x.startDate,
              ])
            ).rows[0].rules;
            if (!rules)
              bad(
                409,
                "Publish an applicable employment policy before requesting leave",
              );
            if (rules.approvalStages !== 1)
              bad(
                409,
                "Multi-stage approval is not enabled yet; this policy requires it",
              );
            if (["Casual", "Comp-off"].includes(x.type))
              bad(
                409,
                "This leave category requires a configured entitlement ledger",
              );
            if (x.type !== "Unpaid") {
              const used = (
                await q.query(
                  "SELECT coalesce(sum(end_date-start_date+1),0)::integer AS days FROM leave_requests WHERE employee_id=$1 AND type=$2 AND status IN ('pending','approved') AND extract(year FROM start_date)=$3::integer",
                  [e.id, x.type, Number(x.startDate.slice(0, 4))],
                )
              ).rows[0].days;
              const requested =
                1 +
                (Date.parse(x.endDate) - Date.parse(x.startDate)) / 86400000;
              if (
                Number(used) + requested >
                rules[x.type === "Annual" ? "annualLeave" : "sickLeave"]
              )
                bad(
                  409,
                  "Request exceeds the published calendar-year leave allowance",
                );
            }
            const id = randomUUID();
            await q.query(
              "INSERT INTO leave_requests(id,tenant_id,company_id,branch_id,employee_id,type,start_date,end_date,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                id,
                a.tenant_id,
                e.company_id,
                e.branch_id,
                e.id,
                x.type,
                x.startDate,
                x.endDate,
                x.reason,
              ],
            );
            await audit(q, a, "leave.requested", id, e.company_id, e.branch_id);
            return { id };
          }),
        );
      }
      const leaveMatch = path.match(/^\/leave\/([^/]+)\/decision$/);
      if (leaveMatch && method === "POST") {
        const id = parseId(leaveMatch[1]);
        const x = z
          .object({ status: z.enum(["approved", "rejected"]) })
          .strict()
          .parse(req.body);
        if (a.grants.every((g) => g.role === "employee"))
          bad(403, "Approval permission required");
        return res.json(
          await scope(a, async (q) => {
            const l = object(
              (
                await q.query(
                  "SELECT * FROM leave_requests WHERE id=$1 FOR UPDATE",
                  [id],
                )
              ).rows,
            );
            must(a, "leave.write", l.company_id, l.branch_id);
            if (l.employee_id === a.employee_id)
              bad(403, "You cannot approve your own leave");
            if (l.status !== "pending") bad(409, "Request already decided");
            await q.query(
              "UPDATE leave_requests SET status=$1,decided_by=$2 WHERE id=$3",
              [x.status, a.id, id],
            );
            await audit(
              q,
              a,
              "leave." + x.status,
              id,
              l.company_id,
              l.branch_id,
            );
            return { ok: true };
          }),
        );
      }
      if (path === "/salaries" && method === "GET") {
        must(a, "payroll.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT s.*,e.name,e.code FROM salary_assignments s JOIN employees e ON e.id=s.employee_id WHERE ($1::uuid IS NULL OR s.company_id=$1) ORDER BY effective_from DESC",
                  [company],
                )
              ).rows,
          ),
        );
      }
      if (path === "/salaries" && method === "POST") {
        const x = z
          .object({
            employeeId: uuid,
            basePaise: money,
            allowancesPaise: money,
            deductionsPaise: money,
            effectiveFrom: date,
          })
          .strict()
          .parse(req.body);
        if (x.deductionsPaise > x.basePaise + x.allowancesPaise)
          bad(400, "Deductions exceed earnings");
        return res.status(201).json(
          await scope(a, async (q) => {
            const e = object(
              (
                await q.query("SELECT * FROM employees WHERE id=$1", [
                  x.employeeId,
                ])
              ).rows,
            );
            must(a, "payroll.write", e.company_id, e.branch_id);
            const id = randomUUID();
            await q.query(
              "INSERT INTO salary_assignments VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                id,
                a.tenant_id,
                e.company_id,
                e.branch_id,
                e.id,
                x.basePaise,
                x.allowancesPaise,
                x.deductionsPaise,
                x.effectiveFrom,
              ],
            );
            await audit(q, a, "salary.assigned", id, e.company_id, e.branch_id);
            return { id };
          }),
        );
      }
      if (path === "/payroll" && method === "GET") {
        must(a, "payroll.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT p.*,c.name AS company_name FROM payroll_runs p JOIN companies c ON c.id=p.company_id WHERE ($1::uuid IS NULL OR p.company_id=$1) ORDER BY p.created_at DESC",
                  [company],
                )
              ).rows,
          ),
        );
      }
      if (path === "/payroll" && method === "POST") {
        const x = z
          .object({
            companyId: uuid,
            period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          })
          .strict()
          .parse(req.body);
        must(a, "payroll.write", x.companyId);
        return res.status(201).json(
          await scope(a, async (q) => {
            const salaries = (
              await q.query(
                "SELECT DISTINCT ON(s.employee_id) s.*,e.name,e.code FROM salary_assignments s JOIN employees e ON e.id=s.employee_id WHERE s.company_id=$1 AND s.effective_from<=($2::date+interval '1 month'-interval '1 day') AND e.joined_on<=($2::date+interval '1 month'-interval '1 day') AND e.status='active' ORDER BY s.employee_id,s.effective_from DESC",
                [x.companyId, x.period + "-01"],
              )
            ).rows;
            if (!salaries.length) bad(400, "No eligible salary assignments");
            const items = calculatePayroll(salaries),
              id = randomUUID();
            await q.query(
              "INSERT INTO payroll_runs(id,tenant_id,company_id,period,total_paise,items,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id,
                a.tenant_id,
                x.companyId,
                x.period,
                items.reduce((n, s) => n + s.netPaise, 0),
                JSON.stringify(items),
                a.id,
              ],
            );
            await audit(q, a, "payroll.drafted", id, x.companyId);
            return { id };
          }),
        );
      }
      const payrollMatch = path.match(/^\/payroll\/([^/]+)\/(review|lock)$/);
      if (payrollMatch && method === "POST") {
        const id = parseId(payrollMatch[1]);
        return res.json(
          await scope(a, async (q) => {
            const p = object(
              (
                await q.query(
                  "SELECT * FROM payroll_runs WHERE id=$1 FOR UPDATE",
                  [id],
                )
              ).rows,
            );
            must(a, "payroll.write", p.company_id);
            const lock = payrollMatch[2] === "lock";
            if (p.status !== (lock ? "review" : "draft"))
              bad(409, "Invalid payroll transition");
            if (lock && p.created_by === a.id)
              bad(403, "A different administrator must approve payroll");
            await q.query(
              "UPDATE payroll_runs SET status=$1,approved_by=$2 WHERE id=$3",
              [lock ? "locked" : "review", lock ? a.id : null, id],
            );
            await audit(
              q,
              a,
              lock ? "payroll.locked" : "payroll.review",
              id,
              p.company_id,
            );
            return { ok: true };
          }),
        );
      }
      const recordMatch = path.match(/^\/records\/([a-z]+)(?:\/([^/]+))?$/);
      if (recordMatch) {
        const module = z.enum(recordModules).parse(recordMatch[1]);
        const id = recordMatch[2] ? parseId(recordMatch[2]) : null;
        if (method === "GET" && !id) {
          must(a, module + ".read");
          return res.json(
            await scope(
              a,
              async (q) =>
                (
                  await q.query(
                    "SELECT r.*,c.name AS company_name FROM records r JOIN companies c ON c.id=r.company_id WHERE module=$1 AND ($2::uuid IS NULL OR r.company_id=$2) ORDER BY r.created_at DESC",
                    [module, company],
                  )
                ).rows,
            ),
          );
        }
        if (method === "POST" && !id) {
          const x = recordSchema.parse(req.body);
          must(a, module + ".write", x.companyId, x.branchId);
          return res.status(201).json(
            await scope(a, async (q) => {
              if (x.employeeId) {
                const e = object(
                  (
                    await q.query("SELECT * FROM employees WHERE id=$1", [
                      x.employeeId,
                    ])
                  ).rows,
                );
                if (
                  e.company_id !== x.companyId ||
                  (x.branchId && e.branch_id !== x.branchId)
                )
                  bad(400, "Employee scope does not match");
              }
              const newId = randomUUID();
              await q.query(
                "INSERT INTO records(id,tenant_id,company_id,branch_id,employee_id,module,title,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
                [
                  newId,
                  a.tenant_id,
                  x.companyId,
                  x.branchId || null,
                  x.employeeId || a.employee_id,
                  module,
                  x.title,
                  JSON.stringify(x.data),
                ],
              );
              await audit(
                q,
                a,
                module + ".created",
                newId,
                x.companyId,
                x.branchId || null,
              );
              return { id: newId };
            }),
          );
        }
        if (method === "PATCH" && id) {
          const x = statusSchema.parse(req.body);
          return res.json(
            await scope(a, async (q) => {
              const r = object(
                (
                  await q.query(
                    "SELECT * FROM records WHERE id=$1 AND module=$2 FOR UPDATE",
                    [id, module],
                  )
                ).rows,
              );
              must(a, module + ".write", r.company_id, r.branch_id);
              if (["completed", "cancelled"].includes(r.status))
                bad(409, "Closed records cannot be changed");
              await q.query("UPDATE records SET status=$1 WHERE id=$2", [
                x.status,
                id,
              ]);
              await audit(
                q,
                a,
                module + "." + x.status,
                id,
                r.company_id,
                r.branch_id,
              );
              return { ok: true };
            }),
          );
        }
      }
      if (path === "/access" && method === "GET") {
        must(a, "access.read");
        return res.json(
          await db.as("hrms_auth", null, async (q) => ({
            users: (
              await q.query(
                "SELECT id,name,email,employee_id FROM auth.users WHERE tenant_id=$1",
                [a.tenant_id],
              )
            ).rows,
            grants: (
              await q.query(
                "SELECT id,user_id,role,company_id,branch_id,permissions FROM auth.grants WHERE tenant_id=$1",
                [a.tenant_id],
              )
            ).rows,
            roles: Object.keys(roles),
            modules,
          })),
        );
      }
      if (path === "/access" && method === "POST") {
        if (!a.grants.some((g) => g.role === "firm_admin" && !g.company_id))
          bad(403, "Firm administrator required");
        const x = z
          .object({
            userId: uuid,
            role: z.enum(["company_admin", "hr", "manager", "employee"]),
            companyId: uuid,
            branchId: uuid.nullable().optional(),
            modules: z
              .array(z.enum(modules))
              .min(1)
              .max(modules.length)
              .optional(),
          })
          .strict()
          .parse(req.body);
        await scope(a, async (q) => {
          object(
            (
              await q.query("SELECT id FROM companies WHERE id=$1", [
                x.companyId,
              ])
            ).rows,
          );
          if (x.branchId)
            object(
              (
                await q.query(
                  "SELECT id FROM branches WHERE id=$1 AND company_id=$2",
                  [x.branchId, x.companyId],
                )
              ).rows,
            );
        });
        return res.status(201).json(
          await db.as("hrms_auth", null, async (q) => {
            const u = object(
              (
                await q.query(
                  "SELECT id,employee_id FROM auth.users WHERE id=$1 AND tenant_id=$2",
                  [x.userId, a.tenant_id],
                )
              ).rows,
            );
            if (["manager", "employee"].includes(x.role) && !u.employee_id)
              bad(400, "Link an employee before assigning this role");
            const id = randomUUID();
            const perms = roles[x.role].filter(
              (p) => !x.modules || x.modules.includes(p.split(".")[0] as any),
            );
            await q.query(
              "INSERT INTO auth.grants(id,tenant_id,user_id,role,company_id,branch_id,permissions) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id,
                a.tenant_id,
                x.userId,
                x.role,
                x.companyId,
                x.branchId || null,
                [...perms, "organization.read"],
              ],
            );
            await audit(
              q,
              a,
              "access.granted",
              id,
              x.companyId,
              x.branchId || null,
            );
            return { id };
          }),
        );
      }
      const grantMatch = path.match(/^\/access\/([^/]+)$/);
      if (grantMatch && method === "DELETE") {
        if (!a.grants.some((g) => g.role === "firm_admin" && !g.company_id))
          bad(403, "Firm administrator required");
        const id = parseId(grantMatch[1]);
        return res.json(
          await db.as("hrms_auth", null, async (q) => {
            const g = object(
              (
                await q.query(
                  "SELECT * FROM auth.grants WHERE id=$1 AND tenant_id=$2",
                  [id, a.tenant_id],
                )
              ).rows,
            );
            if (g.role === "firm_admin")
              bad(400, "Firm administrator grants are protected");
            await q.query("DELETE FROM auth.grants WHERE id=$1", [id]);
            await audit(q, a, "access.revoked", id, g.company_id, g.branch_id);
            return { ok: true };
          }),
        );
      }
      if (path === "/users" && method === "POST") {
        if (!a.grants.some((g) => g.role === "firm_admin" && !g.company_id))
          bad(403, "Firm administrator required");
        const x = z
          .object({
            name: z.string().trim().min(2).max(120),
            email: z.string().email().max(160),
            password: z.string().min(14).max(200),
            employeeId: uuid.nullable().optional(),
          })
          .strict()
          .parse(req.body);
        if (x.employeeId)
          await scope(a, async (q) =>
            object(
              (
                await q.query("SELECT id FROM employees WHERE id=$1", [
                  x.employeeId,
                ])
              ).rows,
            ),
          );
        return res.status(201).json(
          await db.as("hrms_auth", null, async (q) => {
            const id = randomUUID();
            await q.query(
              "INSERT INTO auth.users(id,tenant_id,name,email,password_hash,employee_id) VALUES($1,$2,$3,$4,$5,$6)",
              [
                id,
                a.tenant_id,
                x.name,
                x.email.toLowerCase(),
                hashPassword(x.password),
                x.employeeId || null,
              ],
            );
            await audit(q, a, "user.created", id);
            return { id };
          }),
        );
      }
      if (path === "/audit" && method === "GET") {
        must(a, "audit.read");
        return res.json(
          await scope(
            a,
            async (q) =>
              (
                await q.query(
                  "SELECT * FROM audit_logs WHERE ($1::uuid IS NULL OR company_id=$1) ORDER BY created_at DESC LIMIT 200",
                  [company],
                )
              ).rows,
          ),
        );
      }
      if (path === "/reports/employees" && method === "GET") {
        must(a, "employees.read");
        const rows = await scope(
          a,
          async (q) =>
            (
              await q.query(
                "SELECT code,name,department,employment_type,status FROM employees WHERE ($1::uuid IS NULL OR company_id=$1) ORDER BY name",
                [company],
              )
            ).rows,
        );
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="employees.csv"',
        );
        return res.send(
          [
            "Code,Name,Department,Employment type,Status",
            ...rows.map((r) => Object.values(r).map(csvCell).join(",")),
          ].join("\r\n"),
        );
      }
      if (path === "/help/articles" && method === "GET")
        return res.json(articles.map(({ tags, ...a }) => a));
      if (path === "/help/chat" && method === "POST") {
        const x = z
          .object({ question: z.string().trim().min(1).max(500) })
          .strict()
          .parse(req.body);
        return res.json(await answerHelp(x.question));
      }
      bad(404, "Endpoint not found");
    } catch (e: any) {
      const code =
        e instanceof HttpError
          ? e.status
          : e instanceof z.ZodError
            ? 400
            : ["23505", "23514", "23503", "22P02", "22007"].includes(e.code)
              ? 409
              : e.code === "42501"
                ? 403
                : e.code === "P0002"
                  ? 422
                  : 500;
      if (code === 500)
        console.error("request_failed", { path: req.path, error: e.message });
      return res.status(code).json({
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof z.ZodError
              ? "Invalid request fields"
              : code === 409
                ? "Conflict or invalid reference"
                : code === 403
                  ? "This action is outside your access"
                  : "Something went wrong. Contact support.",
      });
    }
  }
  @Controller("api")
  class ApiController {
    @All("{*path}") route(@Req() req: Request, @Res() res: Response) {
      return handle(req, res);
    }
  }
  @Module({ controllers: [ApiController] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    logger: false,
    bodyParser: false,
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use((req: Request, res: Response, next: any) => {
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: options.memory ? 1000 : 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/session",
    rateLimit({
      windowMs: 900000,
      limit: options.memory ? 1000 : 40,
      skip: (req) => req.method !== "POST",
      legacyHeaders: false,
    }),
  );
  app.use(
    "/api/help/chat",
    rateLimit({
      windowMs: 60000,
      limit: options.memory ? 1000 : 12,
      legacyHeaders: false,
    }),
  );
  app.use(
    express.json({
      limit: "64kb",
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(cookieParser());
  app.use(
    express.static(resolve("dist"), { index: "index.html", fallthrough: true }),
  );
  await app.init();
  return { app, db };
}
