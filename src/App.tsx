import React, { useEffect, useState, useRef } from "react";
import PlatformWorkspace from "./PlatformWorkspace";
import EmployeeImport from "./EmployeeImport";
import PasswordInput from "./PasswordInput";
import {
  LayoutDashboard,
  Users,
  Clock3,
  CalendarDays,
  Wallet,
  Target,
  GraduationCap,
  Utensils,
  LogOut,
  Building2,
  ShieldCheck,
  SlidersHorizontal,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  FileText,
  Download,
  Bell,
  HelpCircle,
  Send,
  BriefcaseBusiness,
  DoorOpen,
  BookOpen,
  Activity,
  PanelLeftClose,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Leaf,
  Settings2,
  LockKeyhole,
  Sparkles,
  UploadCloud,
} from "lucide-react";

let csrf = "";
async function api(path: string, method = "GET", body?: any) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
const cash = (paise: number | string) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(paise) / 100);
const day = (s: string) =>
  s
    ? new Date(s).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const initials = (s: string) =>
  s
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
const pretty = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
const today = () => new Date().toISOString().slice(0, 10);
const menu = [
  {
    id: "dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    group: "WORKSPACE",
  },
  { id: "employees", label: "People", icon: Users, group: "WORKSPACE" },
  { id: "attendance", label: "Attendance", icon: Clock3, group: "WORKSPACE" },
  {
    id: "leave",
    label: "Leave & approvals",
    icon: CalendarDays,
    group: "WORKSPACE",
  },
  { id: "payroll", label: "Payroll", icon: Wallet, group: "WORKSPACE" },
  {
    id: "performance",
    label: "Performance",
    icon: Target,
    group: "DEVELOP & MANAGE",
  },
  {
    id: "training",
    label: "Learning",
    icon: GraduationCap,
    group: "DEVELOP & MANAGE",
  },
  {
    id: "canteen",
    label: "Canteen",
    icon: Utensils,
    group: "DEVELOP & MANAGE",
  },
  {
    id: "contractors",
    label: "Contractors",
    icon: BriefcaseBusiness,
    group: "DEVELOP & MANAGE",
  },
  {
    id: "gatepasses",
    label: "Gate passes",
    icon: DoorOpen,
    group: "DEVELOP & MANAGE",
  },
  {
    id: "exits",
    label: "Employee exits",
    icon: LogOut,
    group: "DEVELOP & MANAGE",
  },
  { id: "reports", label: "Reports", icon: FileText, group: "ADMINISTRATION" },
  {
    id: "policies",
    label: "Policies",
    icon: SlidersHorizontal,
    group: "ADMINISTRATION",
  },
  {
    id: "masters",
    label: "Master data",
    icon: BookOpen,
    group: "ADMINISTRATION",
  },
  {
    id: "organization",
    label: "Organization",
    icon: Building2,
    group: "ADMINISTRATION",
  },
  {
    id: "access",
    label: "Access control",
    icon: ShieldCheck,
    group: "ADMINISTRATION",
  },
  {
    id: "audit",
    label: "Activity log",
    icon: Activity,
    group: "ADMINISTRATION",
  },
  {
    id: "support",
    label: "Support tickets",
    icon: HelpCircle,
    group: "ADMINISTRATION",
  },
];
const descriptions: Record<string, string> = {
  employees: "A connected view of the people behind your business.",
  attendance:
    "Every workday, accounted for. Review punches across your locations.",
  leave: "A little time away. Keep requests and approvals moving.",
  payroll: "Bring clarity to compensation, one pay cycle at a time.",
  policies: "Different teams. The right rules for everyone.",
  performance: "Give every person a clear direction to grow.",
  training: "Create space for your people to learn.",
  canteen: "Meals, plans and workplace moments.",
  contractors: "Manage your extended workforce in one place.",
  gatepasses: "Keep track of movement beyond the workplace.",
  exits: "A thoughtful, organized transition for every employee.",
  masters: "Create the categories that make your organization yours.",
  organization: "One firm. Connected companies and locations.",
  access: "The right people, with the right level of access.",
  audit: "A clear record of important changes.",
  reports: "Your workforce information, ready to share.",
  support: "Track questions and keep your team moving.",
};
function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span
      className={
        "avatar " + (large ? "large" : "") + " tone" + (name.length % 5)
      }
    >
      {initials(name)}
    </span>
  );
}
function Empty({
  text = "No records here yet.",
  action,
}: {
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Leaf size={28} />
      <h3>{text}</h3>
      <p>Everything you add will appear here.</p>
      {action}
    </div>
  );
}
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string; companyId?: string }[];
  suggestions?: string[];
  value?: any;
  required?: boolean;
  min?: number;
  max?: number;
};
function Modal({
  title,
  description,
  fields,
  onClose,
  onSave,
}: {
  title: string;
  description?: string;
  fields: Field[];
  onClose: () => void;
  onSave: (v: any) => Promise<void>;
}) {
  const [values, setValues] = useState<any>(
    Object.fromEntries(fields.map((f) => [f.key, f.value ?? ""])),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,select,button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea",
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
      >
        <div className="modal-top">
          <span className="eyebrow">PEOPLEWORK</span>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="modal-title">{title}</h2>
        {description && <p>{description}</p>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await onSave(values);
              onClose();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            {fields.map((f) => (
              <label
                key={f.key}
                className={f.type === "textarea" ? "full" : ""}
              >
                {f.label}
                {f.type === "multi" ? (
                  <select
                    multiple
                    aria-label={f.label}
                    value={values[f.key] || []}
                    onChange={(e) =>
                      setValues({
                        ...values,
                        [f.key]: Array.from(
                          e.target.selectedOptions,
                          (o) => o.value,
                        ),
                      })
                    }
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "select" ? (
                  <select
                    required={f.required !== false}
                    value={values[f.key]}
                    onChange={(e) => {
                      const next = { ...values, [f.key]: e.target.value };
                      if (f.key === "companyId" && "branchId" in next)
                        next.branchId = "";
                      setValues(next);
                    }}
                  >
                    <option value="">Choose {f.label.toLowerCase()}</option>
                    {f.options
                      ?.filter(
                        (o) =>
                          !o.companyId ||
                          !values.companyId ||
                          o.companyId === values.companyId,
                      )
                      .map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    maxLength={2000}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                ) : f.type === "password" ? (
                  <PasswordInput value={values[f.key]} onChange={(value)=>setValues({...values,[f.key]:value})} required={f.required!==false} minLength={14}/>
                ) : (
                  <input
                    required={f.required !== false}
                    type={f.type || "text"}
                    min={f.min}
                    max={f.max}
                    list={f.suggestions ? "options-" + f.key : undefined}
                    value={values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                )}
                {f.suggestions && (
                  <datalist id={"options-" + f.key}>
                    {f.suggestions.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                )}
              </label>
            ))}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Save{" "}
              {title.toLowerCase().includes("policy") ? "draft" : "changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [demo, setDemo] = useState(false);
  useEffect(() => {
    api("/health")
      .then((r) => setDemo(r.demo === true))
      .catch(() => {});
  }, []);
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          peoplework<span className="brand-dot">.</span>
        </div>
        <span className="eyebrow light">SPACE FOR YOUR PEOPLE TO THRIVE</span>
        <h1>
          Good work starts
          <br />
          with great people.
        </h1>
        <p>
          Your teams, policies and everyday moments.
          <br />
          Thoughtfully connected in one workspace.
        </p>
        <div className="login-art">
          <div className="orbit one" />
          <div className="orbit two" />
          <div className="art-card">
            <Users size={27} />
            <strong>People first.</strong>
            <span>Everything else follows.</span>
          </div>
          <div className="art-chip">
            <CheckCircle2 size={18} />
            Connected across companies
          </div>
        </div>
        <small>PEOPLEWORK · BY AS COMMUNICATIONS</small>
      </section>
      <section className="login-form">
        <div>
          <Badge tone="green">Development preview</Badge>
          <h2>Welcome to your workspace</h2>
          <p>Sign in to bring your people together.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const r = await api("/session", "POST", { email, password });
                csrf = r.csrf;
                onLogin();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Work email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password"/>
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          {demo && (
            <div className="demo-accounts">
              <small>EXPLORE WITH FICTIONAL DEMO DATA</small>
              <div>
                {[
                  ["Firm admin", "admin"],
                  ["Company admin", "company"],
                  ["Employee", "employee"],
                ].map(([l, e]) => (
                  <button
                    key={e}
                    onClick={() => {
                      setEmail(e + "@meridian.test");
                      setPassword("");
                    }}
                  >
                    {l}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
              <p>Choose a demo role, then enter the demo password provided by your workspace owner.</p>
            </div>
          )}
        </div>
        <span className="login-foot">
          <ShieldCheck size={15} />
          Scoped access. Thoughtful permissions.
        </span>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<any>(null),
    [authReady, setAuthReady] = useState(false),
    [page, setPage] = useState("dashboard"),
    [company, setCompany] = useState(""),
    [org, setOrg] = useState<any>({ companies: [], branches: [] }),
    [employees, setEmployees] = useState<any[]>([]),
    [attendance, setAttendance] = useState<any[]>([]),
    [leaves, setLeaves] = useState<any[]>([]),
    [rows, setRows] = useState<any[]>([]),
    [masters, setMasters] = useState<any[]>([]),
    [access, setAccess] = useState<any>({ users: [], grants: [], roles: [] }),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [refresh, setRefresh] = useState(0),
    [modal, setModal] = useState<any>(null),
    [showImport, setShowImport] = useState(false),
    [help, setHelp] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [question, setQuestion] = useState(""),
    [chat, setChat] = useState<any[]>([]),
    [chatBusy, setChatBusy] = useState(false);
  const boot = async () => {
    try {
      const s = await api("/session");
      csrf = s.csrf;
      setSession(s);
    } catch {
      setSession(null);
    } finally {
      setAuthReady(true);
    }
  };
  useEffect(() => {
    boot();
  }, []);
  // Help conversations are intentionally in-memory and private to the active
  // signed-in account. Reset them on every account transition so a user who
  // signs in after another user cannot see that user's support messages.
  useEffect(() => {
    setChat([]);
    setQuestion("");
    setChatBusy(false);
    setHelp(false);
  }, [session?.user?.id]);
  const can = (m: string, action = "read") =>
    session?.grants.some(
      (g: any) =>
        (g.permissions.includes("*") ||
          g.permissions.includes(m + "." + action)) &&
        (!company || !g.company_id || g.company_id === company),
    );
  useEffect(() => {
    if (!session || session.grants?.some((g:any)=>g.role==="platform_owner")) return;
    let active = true;
    setLoading(true);
    setError("");
    setRows([]);
    const query = company ? "?companyId=" + company : "";
    (async () => {
      try {
        const [o, e, a, l, m] = await Promise.all([
          api("/organization"),
          can("employees") ? api("/employees" + query) : [],
          can("attendance") ? api("/attendance" + query) : [],
          can("leave") ? api("/leave" + query) : [],
          can("masters") ? api("/records/masters" + query) : [],
        ]);
        if (!active) return;
        setOrg(o);
        setEmployees(e);
        setAttendance(a);
        setLeaves(l);
        setMasters(m);
        if (page === "policies" || page === "payroll" || page === "audit") {
          const r = await api("/" + page + query);
          if (active) setRows(r);
        } else if (page === "access") {
          const r = await api("/access");
          if (active) setAccess(r);
        } else if (
          ![
            "dashboard",
            "employees",
            "attendance",
            "leave",
            "organization",
            "reports",
          ].includes(page)
        ) {
          const r = await api("/records/" + page + query);
          if (active) setRows(r);
        }
      } catch (e: any) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, page, company, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (p: string) => {
    setPage(p);
    setSearch("");
    setStatus("all");
    setMobileNav(false);
  };
  const saved = () => {
    setRefresh((r) => r + 1);
    setToast("Saved. Your workspace is up to date.");
  };
  const mutate = async (path: string, body: any = {}, method = "POST") => {
    await api(path, method, body);
    saved();
  };
  const companyOptions = org.companies
    .filter((c: any) => !company || c.id === company)
    .map((c: any) => ({ value: c.id, label: c.name }));
  const branchOptions = org.branches
    .filter((b: any) => !company || b.company_id === company)
    .map((b: any) => ({ value: b.id, label: b.name, companyId: b.company_id }));
  const employeeOptions = employees.map((e) => ({
    value: e.id,
    label: `${e.name} · ${e.code}`,
  }));
  const cf: Field = {
    key: "companyId",
    label: "Company",
    type: "select",
    options: companyOptions,
    value: company || companyOptions[0]?.value,
  };
  const bf: Field = {
    key: "branchId",
    label: "Branch",
    type: "select",
    options: branchOptions,
    value: branchOptions[0]?.value,
  };
  const ef: Field = {
    key: "employeeId",
    label: "Employee",
    type: "select",
    options: employeeOptions,
    value: session?.user.employeeId || employeeOptions[0]?.value,
  };
  function openCreate(kind = page) {
    const definitions: Record<string, any> = {
      employees: {
        title: "Add employee",
        fields: [
          cf,
          bf,
          { key: "name", label: "Full name" },
          { key: "email", label: "Work email", type: "email" },
          { key: "code", label: "Employee code" },
          { key: "department", label: "Department" },
          { key: "designation", label: "Designation" },
          {
            key: "employmentType",
            label: "Employment type",
            value: "Permanent",
          },
          {
            key: "joinedOn",
            label: "Joining date",
            type: "date",
            value: today(),
          },
        ],
        save: (v: any) => mutate("/employees", v),
      },
      attendance: {
        title: "Record manual punch",
        description:
          "Add a reason so every attendance correction is traceable.",
        fields: [
          ef,
          { key: "occurredAt", label: "Date and time", type: "datetime-local" },
          {
            key: "direction",
            label: "Direction",
            type: "select",
            options: [
              { value: "in", label: "In" },
              { value: "out", label: "Out" },
            ],
            value: "in",
          },
          { key: "note", label: "Reason", type: "textarea" },
        ],
        save: (v: any) =>
          mutate("/attendance", {
            ...v,
            occurredAt: new Date(v.occurredAt).toISOString(),
          }),
      },
      leave: {
        title: "Apply for leave",
        fields: [
          ef,
          {
            key: "type",
            label: "Leave type",
            type: "select",
            options: ["Annual", "Sick", "Casual", "Comp-off", "Unpaid"].map(
              (x) => ({ value: x, label: x }),
            ),
            value: "Annual",
          },
          { key: "startDate", label: "From", type: "date", value: today() },
          { key: "endDate", label: "To", type: "date", value: today() },
          { key: "reason", label: "Reason", type: "textarea" },
        ],
        save: (v: any) => mutate("/leave", v),
      },
      policies: {
        title: "Create policy",
        description:
          "Save a draft, review it, then publish a version with an effective date.",
        fields: [
          cf,
          { key: "name", label: "Policy name" },
          {
            key: "employmentType",
            label: "Employment type",
            value: "Permanent",
          },
          {
            key: "effectiveFrom",
            label: "Effective from",
            type: "date",
            value: today(),
          },
          {
            key: "annualLeave",
            label: "Annual leave (days)",
            type: "number",
            value: 18,
            min: 0,
            max: 365,
          },
          {
            key: "sickLeave",
            label: "Sick leave (days)",
            type: "number",
            value: 6,
            min: 0,
            max: 365,
          },
          {
            key: "graceMinutes",
            label: "Grace period (minutes)",
            type: "number",
            value: 10,
            min: 0,
            max: 120,
          },
          {
            key: "dailyHours",
            label: "Daily hours",
            type: "number",
            value: 8,
            min: 1,
            max: 24,
          },
          {
            key: "overtimeMultiplier",
            label: "Overtime multiplier",
            type: "number",
            value: 2,
            min: 1,
            max: 5,
          },
          {
            key: "carryForward",
            label: "Carry forward (days)",
            type: "number",
            value: 5,
            min: 0,
            max: 365,
          },
          {
            key: "payBasis",
            label: "Pay basis",
            type: "select",
            options: ["monthly", "daily", "hourly", "piece"].map((x) => ({
              value: x,
              label: pretty(x),
            })),
            value: "monthly",
          },
          {
            key: "approvalStages",
            label: "Approval stages",
            type: "number",
            value: 1,
            min: 1,
            max: 4,
          },
        ],
        save: (v: any) => {
          const {
            companyId,
            name,
            employmentType,
            effectiveFrom,
            payBasis,
            ...n
          } = v;
          return mutate("/policies", {
            companyId,
            name,
            employmentType,
            effectiveFrom,
            rules: {
              ...Object.fromEntries(
                Object.entries(n).map(([k, v]) => [k, Number(v)]),
              ),
              payBasis,
            },
          });
        },
      },
      payroll: {
        title: "Create payroll draft",
        description:
          "Preview fixed earnings and deductions. Statutory calculation and attendance proration need validation before live payroll.",
        fields: [
          cf,
          {
            key: "period",
            label: "Pay period",
            type: "month",
            value: today().slice(0, 7),
          },
        ],
        save: (v: any) => mutate("/payroll", v),
      },
      salary: {
        title: "Assign salary",
        description:
          "Enter monthly amounts in rupees. Previous effective versions are retained.",
        fields: [
          ef,
          {
            key: "base",
            label: "Base salary (INR)",
            type: "number",
            value: 30000,
            min: 0,
          },
          {
            key: "allowances",
            label: "Allowances (INR)",
            type: "number",
            value: 0,
            min: 0,
          },
          {
            key: "deductions",
            label: "Deductions (INR)",
            type: "number",
            value: 0,
            min: 0,
          },
          {
            key: "effectiveFrom",
            label: "Effective from",
            type: "date",
            value: today(),
          },
        ],
        save: (v: any) =>
          mutate("/salaries", {
            employeeId: v.employeeId,
            effectiveFrom: v.effectiveFrom,
            basePaise: Math.round(Number(v.base) * 100),
            allowancesPaise: Math.round(Number(v.allowances) * 100),
            deductionsPaise: Math.round(Number(v.deductions) * 100),
          }),
      },
      organization: {
        title: "Add company",
        description: "A new company starts with one reserved employee slot. The AS Communications platform owner can increase its limit from available firm capacity.",
        fields: [
          { key: "name", label: "Company name" },
          { key: "code", label: "Company code" },
        ],
        save: (v: any) => mutate("/companies", v),
      },
      branch: {
        title: "Add branch",
        fields: [cf, { key: "name", label: "Branch name" }],
        save: (v: any) => mutate("/branches", v),
      },
      access: {
        title: "Assign access",
        description:
          "A role grants actions only inside the selected company and optional branch.",
        fields: [
          {
            key: "userId",
            label: "User",
            type: "select",
            options: access.users.map((u: any) => ({
              value: u.id,
              label: u.name,
            })),
          },
          {
            key: "role",
            label: "Role",
            type: "select",
            options: ["company_admin", "hr", "manager", "employee"].map(
              (x) => ({ value: x, label: pretty(x) }),
            ),
            value: "hr",
          },
          cf,
          { ...bf, required: false, value: "" },
          {
            key: "modules",
            label: "Restrict modules (blank = role defaults)",
            type: "multi",
            value: [],
            options: menu
              .filter(
                (m) =>
                  !["dashboard", "reports", "access", "audit"].includes(m.id),
              )
              .map((m) => ({ value: m.id, label: m.label })),
          },
        ],
        save: (v: any) =>
          mutate("/access", {
            ...v,
            modules: v.modules.length ? v.modules : undefined,
            branchId: v.branchId || null,
          }),
      },
      user: {
        title: "Create user",
        description: "Assign company access after creating this account.",
        fields: [
          {
            ...ef,
            label: "Linked employee (optional)",
            value: "",
            required: false,
          },
          { key: "name", label: "Name" },
          { key: "email", label: "Email", type: "email" },
          {
            key: "password",
            label: "Initial password (14+ characters)",
            type: "password",
          },
        ],
        save: (v: any) =>
          mutate("/users", { ...v, employeeId: v.employeeId || null }),
      },
      gatepasses: {
        title: "Issue gate pass",
        description: "Record whether the pass is for an employee or an external visitor, including check-in and check-out times.",
        fields: [
          cf, bf,
          { key: "visitorType", label: "Issued to", type: "select", options: [{ value: "employee", label: "Company employee" }, { value: "external", label: "External visitor" }], value: "external" },
          { key: "visitorName", label: "Person name" },
          { key: "visitorCompany", label: "External company (if applicable)", required: false },
          { key: "purpose", label: "Purpose / items carried", type: "textarea" },
          { key: "checkInAt", label: "Check-in", type: "datetime-local" },
          { key: "checkOutAt", label: "Check-out", type: "datetime-local", required: false },
        ],
        save: (v: any) => mutate("/records/gatepasses", { companyId: v.companyId, branchId: v.branchId, title: v.visitorName + " · " + pretty(v.visitorType) + " gate pass", data: { visitorType: v.visitorType, visitorName: v.visitorName, visitorCompany: v.visitorCompany, purpose: v.purpose, checkInAt: new Date(v.checkInAt).toISOString(), ...(v.checkOutAt ? { checkOutAt: new Date(v.checkOutAt).toISOString() } : {}) } }),
      },
      exits: {
        title: "Start employee exit",
        description: "Create an auditable exit record with the employee, exit reason, last working day and clearance owner.",
        fields: [
          cf, bf, ef,
          { key: "exitType", label: "Exit type", type: "select", options: ["resignation", "retirement", "termination", "contract_end"].map((x) => ({ value: x, label: pretty(x) })), value: "resignation" },
          { key: "lastWorkingDay", label: "Last working day", type: "date", value: today() },
          { key: "noticePeriod", label: "Notice period (days)", type: "number", value: 30, min: 0, max: 365 },
          { key: "handoverTo", label: "Handover to", required: false },
          { key: "clearanceStatus", label: "Clearance status", value: "Pending" },
          { key: "description", label: "Exit notes", type: "textarea", required: false },
        ],
        save: (v: any) => mutate("/records/exits", { companyId: v.companyId, branchId: v.branchId, employeeId: v.employeeId, title: "Exit · " + (employees.find((e) => e.id === v.employeeId)?.name || "Employee"), data: { exitType: v.exitType, lastWorkingDay: v.lastWorkingDay, noticePeriod: Number(v.noticePeriod), handoverTo: v.handoverTo, clearanceStatus: v.clearanceStatus, description: v.description } }),
      },
    };
    const generic = {
      title:
        "Add " +
        (
          {
            performance: "goal",
            training: "training program",
            canteen: "meal plan",
            contractors: "contractor",
            gatepasses: "gate pass",
            exits: "exit request",
            masters: "master record",
            support: "support ticket",
          } as any
        )[kind],
      fields: [
        cf,
        bf,
        { key: "title", label: "Title" },
        {
          key: "category",
          label:
            kind === "masters"
              ? "Type (Department, Employment type, etc.)"
              : "Category",
          required: false,
        },
        { key: "dueDate", label: "Due date", type: "date", required: false },
        { key: "description", label: "Description", type: "textarea" },
      ],
      save: (v: any) =>
        mutate("/records/" + kind, {
          companyId: v.companyId,
          branchId: v.branchId,
          title: v.title,
          data: {
            description: v.description,
            category: v.category,
            ...(v.dueDate ? { dueDate: v.dueDate } : {}),
          },
        }),
    };
    const definition = definitions[kind] || generic;
    const categories: Record<string, string> = {
      employmentType: "Employment type",
      department: "Department",
      designation: "Designation",
    };
    definition.fields = definition.fields.map((f: Field) =>
      categories[f.key]
        ? {
            ...f,
            suggestions: [
              ...new Set(
                masters
                  .filter(
                    (m) =>
                      m.data.category === categories[f.key] &&
                      !["cancelled", "completed"].includes(m.status),
                  )
                  .map((m) => m.title),
              ),
            ],
          }
        : f,
    );
    setModal(definition);
  }
  async function sendHelp(q = question) {
    if (!q.trim() || chatBusy) return;
    setQuestion("");
    setChat((c) => [...c, { role: "user", text: q }]);
    setChatBusy(true);
    try {
      const r = await api("/help/chat", "POST", { question: q });
      setChat((c) => [
        ...c,
        { role: "assistant", text: r.answer, sources: r.sources, mode: r.mode },
      ]);
    } catch (e: any) {
      setChat((c) => [...c, { role: "assistant", text: e.message }]);
    } finally {
      setChatBusy(false);
    }
  }
  if (!authReady)
    return (
      <div className="loading-screen">
        <Loader2 className="spin" />
        Preparing your workspace…
      </div>
    );
  if (!session) return <Login onLogin={boot} />;
  if (session.grants?.some((g:any)=>g.role==="platform_owner"))
    return <PlatformWorkspace api={api} onLogout={async()=>{await api("/session","DELETE",{});csrf="";setSession(null)}}/>;
  // Some utility views (for example Audit and Access) are opened from a
  // dashboard action instead of the left menu. Always provide a page label so
  // those views cannot crash the renderer with an undefined menu item.
  const activeMenu =
    menu.find((m) => m.id === page) || {
      id: page,
      label: pretty(page),
      icon: Activity,
      group: "ADMINISTRATION",
    };
  const visibleMenu = menu.filter(
    (m) =>
      m.id === "dashboard" ||
      (m.id === "reports" ? can("employees") : can(m.id)),
  );
  const filtered = (data: any[]) =>
    data.filter(
      (r) =>
        JSON.stringify(r).toLowerCase().includes(search.toLowerCase()) &&
        (status === "all" || r.status === status),
    );
  const present = new Set(
    attendance
      .filter(
        (a) => a.direction === "in" && a.occurred_at.slice(0, 10) === today(),
      )
      .map((a) => a.employee_id),
  ).size;
  const pending = leaves.filter((l) => l.status === "pending");
  const departments = Object.entries(
    employees.reduce(
      (acc: any, e) => ({
        ...acc,
        [e.department]: (acc[e.department] || 0) + 1,
      }),
      {},
    ),
  ) as [string, number][];
  const cols = (headers: string[], body: React.ReactNode) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
  const approvalTable = (data: any[]) =>
    cols(
      ["EMPLOYEE", "LEAVE TYPE", "DATES", "STATUS", ""],
      data.map((l) => (
        <tr key={l.id}>
          <td>
            <div className="person">
              <Avatar name={l.name} />
              <div>
                <strong>{l.name}</strong>
                <small>{l.code}</small>
              </div>
            </div>
          </td>
          <td>{l.type} leave</td>
          <td>
            {day(l.start_date)}
            <small>{day(l.end_date)}</small>
          </td>
          <td>
            <Badge
              tone={
                l.status === "approved"
                  ? "green"
                  : l.status === "rejected"
                    ? "red"
                    : "amber"
              }
            >
              {pretty(l.status)}
            </Badge>
          </td>
          <td>
            {l.status === "pending" &&
              !session.grants.every((g: any) => g.role === "employee") &&
              can("leave", "write") && (
                <div className="row-actions">
                  <button
                    className="approve"
                    aria-label={"Approve leave for " + l.name}
                    onClick={() =>
                      mutate("/leave/" + l.id + "/decision", {
                        status: "approved",
                      }).catch((e) => setError(e.message))
                    }
                  >
                    <Check size={16} />
                  </button>
                  <button
                    className="reject"
                    aria-label={"Reject leave for " + l.name}
                    onClick={() =>
                      mutate("/leave/" + l.id + "/decision", {
                        status: "rejected",
                      }).catch((e) => setError(e.message))
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
          </td>
        </tr>
      )),
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobileNav ? "mobile-open" : "")}>
        <button className="brand" onClick={() => go("dashboard")}>
          <span className="brand-mark">
            <Leaf size={23} />
          </span>
          <span>
            peoplework<span className="brand-dot">.</span>
            <small className="creator-line">by AS Communications</small>
          </span>
        </button>
        <div className="workspace-card">
          <div className="workspace-logo">M</div>
          <div>
            <strong>Meridian workspace</strong>
            <small>People & operations</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav aria-label="Main navigation">
          {["WORKSPACE", "DEVELOP & MANAGE", "ADMINISTRATION"].map((group) => (
            <React.Fragment key={group}>
              <p className="nav-label">{group}</p>
              {visibleMenu
                .filter((m) => m.group === group)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => go(m.id)}
                    className={"nav-item " + (page === m.id ? "active" : "")}
                  >
                    <m.icon size={18} />
                    <span>{m.label}</span>
                    {m.id === "leave" && pending.length > 0 && (
                      <span className="nav-count">{pending.length}</span>
                    )}
                  </button>
                ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-help">
          <div>
            <span className="help-orb">
              <MessageCircle size={19} />
            </span>
            <strong>A little help goes a long way.</strong>
          </div>
          <p>Your workspace guide is a click away.</p>
          <button onClick={() => setHelp(true)}>
            Ask Peoplework
            <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <span className="status-dot" />
          Development workspace <span>v0.1</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Toggle navigation"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <PanelLeftClose size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{activeMenu.label}</strong>
          </div>
          <div className="topbar-actions">
            <div className="scope-select">
              <Building2 size={15} />
              <select
                aria-label="Company scope"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                <option value="">All permitted companies</option>
                {org.companies.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="icon-button notification"
              aria-label="View pending approvals"
              onClick={() => go("leave")}
            >
              <Bell size={19} />
              {pending.length > 0 && <i />}
            </button>
            <div className="profile">
              <Avatar name={session.user.name} />
              <div>
                <strong>{session.user.name.split(" ")[0]}</strong>
                <small>{pretty(session.grants[0]?.role || "Member")}</small>
              </div>
              <button
                className="icon-button"
                aria-label="Sign out"
                onClick={async () => {
                  try {
                    await api("/session", "DELETE", {});
                  } finally {
                    setSession(null);
                    csrf = "";
                    setCompany("");
                    setChat([]);
                    setQuestion("");
                    setChatBusy(false);
                    setHelp(false);
                    go("dashboard");
                  }
                }}
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </header>
        <main className="content">
          {page === "dashboard" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    YOUR PEOPLE. YOUR BIGGER PICTURE.
                  </div>
                  <h1>
                    A good day starts with your people
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    Welcome back, {session.user.name.split(" ")[0]}. Here’s
                    what’s happening in your workspace.
                  </p>
                </div>
                <div className="date-chip">
                  <CalendarDays size={16} />
                  {new Date().toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </div>
              </div>
              <div className="welcome-banner">
                <div>
                  <Badge tone="outline">PEOPLEWORK PULSE</Badge>
                  <h2>
                    Less admin.
                    <br />
                    More human.
                  </h2>
                  <p>
                    A connected workspace for every team,
                    <br />
                    every company, and every working day.
                  </p>
                  <button
                    onClick={() =>
                      go(can("employees") ? "employees" : "support")
                    }
                  >
                    Meet your people
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="banner-art" aria-hidden="true">
                  <div className="arch arch-back" />
                  <div className="arch arch-front" />
                  <div className="circle-stamp">
                    <Leaf size={42} />
                  </div>
                  <div className="mini-note">
                    <div className="stacked-avatars">
                      {["Aarav Mehta", "Priya Sharma", "Kabir Patel"].map(
                        (n) => (
                          <Avatar key={n} name={n} />
                        ),
                      )}
                    </div>
                    <strong>Better, together.</strong>
                    <small>
                      {employees.length} people. Shared possibilities.
                    </small>
                  </div>
                  <span className="art-spark s1">✳</span>
                  <span className="art-spark s2">✳</span>
                </div>
              </div>
              <div className="stats-grid">
                {[
                  {
                    title: "Total people",
                    value: employees.length,
                    detail: `Across ${org.companies.filter((c: any) => !company || c.id === company).length} companies`,
                    icon: Users,
                    color: "sage",
                  },
                  {
                    title: "Checked in today",
                    value: present,
                    detail: "Based on recorded in-punches",
                    icon: Clock3,
                    color: "blue",
                  },
                  {
                    title: "Pending requests",
                    value: pending.length,
                    detail: "Waiting for a leave decision",
                    icon: CalendarDays,
                    color: "peach",
                  },
                  {
                    title: "Contract workforce",
                    value: employees.filter(
                      (e) => e.employment_type === "Contract",
                    ).length,
                    detail: "Part of your extended team",
                    icon: BriefcaseBusiness,
                    color: "lavender",
                  },
                ].map((s) => (
                  <section className="stat" key={s.title}>
                    <div>
                      <span>{s.title}</span>
                      <div className={"stat-icon " + s.color}>
                        <s.icon size={19} />
                      </div>
                    </div>
                    <strong>{loading ? "—" : s.value}</strong>
                    <small>{s.detail}</small>
                  </section>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="card workforce-card">
                  <div className="card-heading">
                    <div>
                      <h3>Your workforce, at a glance</h3>
                      <p>People by department</p>
                    </div>
                    <Badge>Live data</Badge>
                  </div>
                  <div className="department-bars">
                    {departments.map(([name, count], i) => (
                      <div className="department-row" key={name}>
                        <span>{name}</span>
                        <div className="bar-track">
                          <div
                            className={"bar bar" + i}
                            style={{
                              width:
                                Math.max(
                                  5,
                                  (count /
                                    Math.max(...departments.map((d) => d[1]))) *
                                    100,
                                ) + "%",
                            }}
                          />
                        </div>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="chart-caption">
                    <span className="status-dot" />
                    Only people within your access are included.
                  </div>
                </section>
                <section className="card quick-card">
                  <div className="card-heading">
                    <div>
                      <h3>Make room for good work</h3>
                      <p>Your everyday shortcuts</p>
                    </div>
                    <Sparkles size={19} />
                  </div>
                  {[
                    {
                      title: "Welcome a new person",
                      caption: "Grow your team",
                      icon: Users,
                      key: "employees",
                    },
                    {
                      title: "Set the right policies",
                      caption: "Make work work for everyone",
                      icon: SlidersHorizontal,
                      key: "policies",
                    },
                    {
                      title: "A question on your mind?",
                      caption: "Explore your workspace guide",
                      icon: MessageCircle,
                      key: "help",
                    },
                  ]
                    .filter((x) => x.key === "help" || can(x.key, "write"))
                    .map((x) => (
                      <button
                        className="quick-link"
                        key={x.key}
                        onClick={() =>
                          x.key === "help" ? setHelp(true) : openCreate(x.key)
                        }
                      >
                        <span>
                          <x.icon size={19} />
                        </span>
                        <div>
                          <strong>{x.title}</strong>
                          <small>{x.caption}</small>
                        </div>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                </section>
              </div>
              <section className="card">
                <div className="card-heading">
                  <div>
                    <h3>
                      A few things need your attention{" "}
                      <span className="tiny-count">{pending.length}</span>
                    </h3>
                    <p>Leave requests awaiting review</p>
                  </div>
                  <button className="text-button" onClick={() => go("leave")}>
                    View all requests
                    <ArrowRight size={15} />
                  </button>
                </div>
                {pending.length ? (
                  approvalTable(pending.slice(0, 4))
                ) : (
                  <Empty text="You’re all caught up." />
                )}
              </section>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">{activeMenu.group}</div>
                  <h1>
                    {activeMenu.label}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>{descriptions[page]}</p>
                </div>
                <div className="heading-actions">
                  {page === "employees" && can("employees", "write") && (
                    <button className="button secondary" onClick={() => setShowImport(true)}><UploadCloud size={16}/> Import employees</button>
                  )}
                  {page === "payroll" && can("payroll", "write") && (
                    <button
                      className="button secondary"
                      onClick={() => openCreate("salary")}
                    >
                      Assign salary
                    </button>
                  )}
                  {page === "organization" && can("organization", "write") && (
                    <button
                      className="button secondary"
                      onClick={() => openCreate("branch")}
                    >
                      Add branch
                    </button>
                  )}
                  {page === "access" && (
                    <button
                      className="button secondary"
                      onClick={() => openCreate("user")}
                    >
                      Create user
                    </button>
                  )}
                  {!["reports", "audit"].includes(page) &&
                    can(page, "write") &&
                    (page !== "organization" ||
                      session.grants.some(
                        (g: any) => g.role === "firm_admin",
                      )) && (
                      <button
                        className="button primary"
                        onClick={() => openCreate()}
                      >
                        <Plus size={16} />
                        {(
                          {
                            employees: "Add employee",
                            attendance: "Manual punch",
                            leave: "Apply for leave",
                            policies: "Create policy",
                            payroll: "New payroll",
                            organization: "Add company",
                            access: "Assign access",
                          } as any
                        )[page] || "Add new"}
                      </button>
                    )}
                </div>
              </div>
              {page === "policies" && (
                <div className="info-banner">
                  <SlidersHorizontal size={21} />
                  <div>
                    <strong>Built around the way your people work.</strong>
                    <p>
                      Configure permanent, contract and other worker types.
                      Published versions preserve their effective dates.
                    </p>
                  </div>
                </div>
              )}
              {page === "payroll" && (
                <div className="info-banner amber-bg">
                  <Wallet size={21} />
                  <div>
                    <strong>Payroll preview</strong>
                    <p>
                      Fixed salary snapshots are available. Attendance
                      proration, statutory rules and bank payouts require
                      implementation and validation before live use.
                    </p>
                  </div>
                </div>
              )}
              {[
                "performance",
                "training",
                "canteen",
                "contractors",
                "gatepasses",
                "exits",
              ].includes(page) && (
                <div className="info-banner">
                  <BookOpen size={20} />
                  <div>
                    <strong>{activeMenu.label} register</strong>
                    <p>
                      Create and track records here. Detailed calculations,
                      integrations and document workflows are in the next
                      implementation stages.
                    </p>
                  </div>
                </div>
              )}
              <section
                className={
                  "card " + (page === "policies" ? "policy-section" : "")
                }
              >
                {!["organization", "access", "reports"].includes(page) && (
                  <div className="table-toolbar">
                    <div className="table-title">
                      {page === "employees"
                        ? employees.length
                        : page === "attendance"
                          ? attendance.length
                          : page === "leave"
                            ? leaves.length
                            : rows.length}{" "}
                      records
                      <Badge>
                        {company ? "Selected company" : "Your permitted scope"}
                      </Badge>
                    </div>
                    <div className="filters">
                      <div className="search-box">
                        <Search size={16} />
                        <input
                          aria-label="Search records"
                          placeholder="Search records…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            className="icon-button"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      {["employees", "leave", "policies"].includes(page) && (
                        <select
                          aria-label="Filter status"
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                        >
                          <option value="all">All statuses</option>
                          {(page === "employees"
                            ? ["active", "inactive"]
                            : page === "leave"
                              ? ["pending", "approved", "rejected"]
                              : ["draft", "published"]
                          ).map((s) => (
                            <option key={s} value={s}>
                              {pretty(s)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}
                {loading ? (
                  <div className="loading-inline">
                    <Loader2 size={22} className="spin" />
                    Loading your workspace…
                  </div>
                ) : (
                  <>
                    {page === "employees" &&
                      (filtered(employees).length ? (
                        cols(
                          [
                            "NAME",
                            "EMPLOYEE ID",
                            "TEAM & ROLE",
                            "LOCATION",
                            "TYPE",
                            "STATUS",
                          ],
                          filtered(employees).map((e) => (
                            <tr key={e.id}>
                              <td>
                                <div className="person">
                                  <Avatar name={e.name} />
                                  <div>
                                    <strong>{e.name}</strong>
                                    <small>{e.email}</small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="mono">{e.code}</span>
                              </td>
                              <td>
                                {e.department}
                                <small>{e.designation}</small>
                              </td>
                              <td>
                                {e.branch_name}
                                <small>{e.company_name}</small>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    e.employment_type === "Contract"
                                      ? "purple"
                                      : ""
                                  }
                                >
                                  {e.employment_type}
                                </Badge>
                              </td>
                              <td>
                                <Badge
                                  tone={e.status === "active" ? "green" : ""}
                                >
                                  <span className="badge-dot" />
                                  {pretty(e.status)}
                                </Badge>
                              </td>
                            </tr>
                          )),
                        )
                      ) : (
                        <Empty text="No people match your search." />
                      ))}
                    {page === "attendance" &&
                      (filtered(attendance).length ? (
                        cols(
                          [
                            "EMPLOYEE",
                            "PUNCH TIME",
                            "DIRECTION",
                            "LOCATION",
                            "SOURCE",
                          ],
                          filtered(attendance).map((a) => (
                            <tr key={a.id}>
                              <td>
                                <div className="person">
                                  <Avatar name={a.name} />
                                  <div>
                                    <strong>{a.name}</strong>
                                    <small>{a.code}</small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                {new Date(a.occurred_at).toLocaleTimeString(
                                  "en-IN",
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                                <small>{day(a.occurred_at)}</small>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    a.direction === "in" ? "green" : "amber"
                                  }
                                >
                                  {pretty(a.direction)}
                                </Badge>
                              </td>
                              <td>{a.branch_name}</td>
                              <td>
                                <Badge>{pretty(a.source)}</Badge>
                              </td>
                            </tr>
                          )),
                        )
                      ) : (
                        <Empty text="No attendance events yet." />
                      ))}
                    {page === "leave" &&
                      (filtered(leaves).length ? (
                        approvalTable(filtered(leaves))
                      ) : (
                        <Empty text="No leave requests here." />
                      ))}
                    {page === "policies" && (
                      <div className="policy-grid">
                        {filtered(rows).map((p) => (
                          <article className="policy-card" key={p.id}>
                            <div className="policy-top">
                              <span className="policy-icon">
                                <SlidersHorizontal size={22} />
                              </span>
                              <Badge
                                tone={
                                  p.status === "published" ? "green" : "amber"
                                }
                              >
                                {pretty(p.status)}
                              </Badge>
                            </div>
                            <h3>{p.name}</h3>
                            <p>
                              {p.company_name} · {p.employment_type}
                            </p>
                            <div className="policy-values">
                              <div>
                                <strong>
                                  {p.rules.annualLeave}
                                  <small>days</small>
                                </strong>
                                <span>Annual leave</span>
                              </div>
                              <div>
                                <strong>
                                  {p.rules.dailyHours}
                                  <small>hrs</small>
                                </strong>
                                <span>Working day</span>
                              </div>
                              <div>
                                <strong>
                                  {p.rules.graceMinutes}
                                  <small>min</small>
                                </strong>
                                <span>Grace period</span>
                              </div>
                            </div>
                            <div className="policy-footer">
                              <span>
                                Version {p.version} · {day(p.effective_from)}
                              </span>
                              {p.status === "draft" &&
                              can("policies", "write") ? (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    mutate(
                                      "/policies/" + p.id + "/publish",
                                    ).catch((e) => setError(e.message))
                                  }
                                >
                                  Publish
                                  <ArrowRight size={14} />
                                </button>
                              ) : (
                                <LockKeyhole size={14} />
                              )}
                            </div>
                          </article>
                        ))}
                        {!rows.length && (
                          <Empty text="Create your first policy." />
                        )}
                      </div>
                    )}
                    {page === "payroll" &&
                      (rows.length ? (
                        cols(
                          [
                            "PERIOD",
                            "COMPANY",
                            "PEOPLE",
                            "NET TOTAL",
                            "STATUS",
                            "NEXT STEP",
                          ],
                          filtered(rows).map((p) => (
                            <tr key={p.id}>
                              <td>
                                <strong>{p.period}</strong>
                              </td>
                              <td>{p.company_name}</td>
                              <td>{p.items.length}</td>
                              <td>
                                <strong>{cash(p.total_paise)}</strong>
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    p.status === "locked" ? "green" : "amber"
                                  }
                                >
                                  {pretty(p.status)}
                                </Badge>
                              </td>
                              <td>
                                {p.status !== "locked" &&
                                can("payroll", "write") ? (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      mutate(
                                        "/payroll/" +
                                          p.id +
                                          "/" +
                                          (p.status === "draft"
                                            ? "review"
                                            : "lock"),
                                      ).catch((e) => setError(e.message))
                                    }
                                  >
                                    {p.status === "draft"
                                      ? "Submit for review"
                                      : "Approve & lock"}
                                    <ArrowRight size={14} />
                                  </button>
                                ) : (
                                  <LockKeyhole size={16} />
                                )}
                              </td>
                            </tr>
                          )),
                        )
                      ) : (
                        <Empty
                          text="Start your first pay cycle."
                          action={
                            <button
                              className="button secondary"
                              onClick={() => openCreate("payroll")}
                            >
                              Create a draft
                            </button>
                          }
                        />
                      ))}
                    {page === "organization" && (
                      <div className="organization-grid">
                        {org.companies
                          .filter((c: any) => !company || c.id === company)
                          .map((c: any) => (
                            <div className="org-card" key={c.id}>
                              <span className="org-icon">
                                <Building2 size={24} />
                              </span>
                              <h3>{c.name}</h3>
                              <Badge>{c.code}</Badge>
                              <div className="branch-list">
                                {org.branches
                                  .filter((b: any) => b.company_id === c.id)
                                  .map((b: any) => (
                                    <div key={b.id}>
                                      <span className="status-dot" />
                                      <span>
                                        {b.name}
                                        <small>{b.timezone}</small>
                                      </span>
                                      {session.grants.some((g: any) =>
                                        (g.role === "firm_admin" || g.role === "company_admin") &&
                                        (!g.company_id || g.company_id === c.id) &&
                                        (!g.branch_id || g.branch_id === b.id)) && (
                                        <span className="branch-actions">
                                          <button className="text-button" onClick={() => setModal({
                                            title: `Rename ${b.name}`,
                                            fields: [{ key: "name", label: "Branch name", value: b.name }],
                                            save: (v: any) => mutate(`/branches/${b.id}`, { name: v.name }, "PATCH"),
                                          })}>Rename</button>
                                          <button className="text-button danger" onClick={() => setModal({
                                            title: `Remove ${b.name}?`,
                                            description: "Only an unused branch can be removed. Employees, historical records, assigned users, or biometric devices must be moved first.",
                                            fields: [],
                                            save: () => mutate(`/branches/${b.id}`, {}, "DELETE"),
                                          })}>Remove</button>
                                        </span>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                    {page === "access" &&
                      cols(
                        ["USER", "ROLE", "COMPANY", "BRANCH", ""],
                        access.grants.map((g: any) => (
                          <tr key={g.id}>
                            <td>
                              <strong>
                                {
                                  access.users.find(
                                    (u: any) => u.id === g.user_id,
                                  )?.name
                                }
                              </strong>
                            </td>
                            <td>
                              <Badge tone="purple">{pretty(g.role)}</Badge>
                            </td>
                            <td>
                              {org.companies.find(
                                (c: any) => c.id === g.company_id,
                              )?.name || "Entire firm"}
                            </td>
                            <td>
                              {org.branches.find(
                                (b: any) => b.id === g.branch_id,
                              )?.name || "All permitted branches"}
                            </td>
                            <td>
                              {g.role !== "firm_admin" && (
                                <button
                                  className="text-button danger"
                                  onClick={() => {
                                    setModal({
                                      title: "Revoke access",
                                      description:
                                        "This removes the selected role assignment immediately.",
                                      fields: [],
                                      save: () =>
                                        mutate("/access/" + g.id, {}, "DELETE"),
                                    });
                                  }}
                                >
                                  Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        )),
                      )}
                    {page === "audit" &&
                      cols(
                        ["ACTION", "RESOURCE", "ACTOR", "WHEN"],
                        filtered(rows).map((r) => (
                          <tr key={r.id}>
                            <td>
                              <Badge tone="green">{r.action}</Badge>
                            </td>
                            <td className="mono">
                              {r.resource_id.slice(0, 12)}…
                            </td>
                            <td>
                              {r.actor_id === session.user.id
                                ? "You"
                                : r.actor_id.slice(0, 8)}
                            </td>
                            <td>
                              {new Date(r.created_at).toLocaleString("en-IN")}
                            </td>
                          </tr>
                        )),
                      )}
                    {page === "reports" && (
                      <div className="report-grid">
                        <div className="report-item">
                          <span className="policy-icon">
                            <Users size={24} />
                          </span>
                          <h3>Employee directory</h3>
                          <p>
                            Export people in your permitted company scope as a
                            spreadsheet-ready CSV.
                          </p>
                          <a
                            className="button secondary"
                            href={
                              "/api/reports/employees" +
                              (company ? "?companyId=" + company : "")
                            }
                          >
                            <Download size={16} />
                            Download CSV
                          </a>
                        </div>
                        <div className="report-item">
                          <span className="policy-icon">
                            <Clock3 size={24} />
                          </span>
                          <h3>Attendance register</h3>
                          <p>
                            Review recorded punches, source and location in the
                            attendance workspace.
                          </p>
                          <button
                            className="button secondary"
                            onClick={() => go("attendance")}
                          >
                            Open attendance
                            <ArrowRight size={16} />
                          </button>
                        </div>
                        <div className="report-item">
                          <span className="policy-icon">
                            <Activity size={24} />
                          </span>
                          <h3>Activity trail</h3>
                          <p>
                            Trace employee, policy, approval and payroll
                            changes.
                          </p>
                          <button
                            className="button secondary"
                            disabled={!can("audit")}
                            onClick={() => go("audit")}
                          >
                            View activity
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                    {![
                      "employees",
                      "attendance",
                      "leave",
                      "policies",
                      "payroll",
                      "organization",
                      "access",
                      "audit",
                      "reports",
                    ].includes(page) &&
                      (filtered(rows).length ? (
                        cols(
                          ["TITLE", "COMPANY", "DETAILS", "STATUS", ""],
                          filtered(rows).map((r) => (
                            <tr key={r.id}>
                              <td>
                                <strong>{r.title}</strong>
                                <small>{r.data.category || pretty(page)}</small>
                              </td>
                              <td>{r.company_name}</td>
                              <td className="description-cell">
                                {r.data.description || "—"}
                                {r.data.dueDate && (
                                  <small>Due {day(r.data.dueDate)}</small>
                                )}
                              </td>
                              <td>
                                <Badge
                                  tone={
                                    r.status === "completed" ? "green" : "amber"
                                  }
                                >
                                  {pretty(r.status)}
                                </Badge>
                              </td>
                              <td>
                                {!["completed", "cancelled"].includes(
                                  r.status,
                                ) &&
                                  can(page, "write") && (
                                    <button
                                      className="text-button"
                                      onClick={() =>
                                        mutate(
                                          "/records/" + page + "/" + r.id,
                                          { status: "completed" },
                                          "PATCH",
                                        ).catch((e) => setError(e.message))
                                      }
                                    >
                                      <Check size={14} />
                                      Complete
                                    </button>
                                  )}
                              </td>
                            </tr>
                          )),
                        )
                      ) : (
                        <Empty
                          text={
                            "Your " +
                            activeMenu.label.toLowerCase() +
                            " starts here."
                          }
                        />
                      ))}
                  </>
                )}
              </section>
            </>
          )}
          {error && (
            <div className="error floating-error" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <footer className="content-footer">
            <span>
              Thoughtfully connected. <strong>Peoplework by AS Communications.</strong>
            </span>
            <span>
              <ShieldCheck size={14} />
              Your permitted company scope
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {showImport && <EmployeeImport api={api} companies={org.companies.filter((c:any)=>(!company||company===c.id)&&session.grants.some((g:any)=>(g.permissions.includes("*")||g.permissions.includes("employees.write"))&&(!g.company_id||g.company_id===c.id)))} branches={org.branches} onClose={()=>setShowImport(false)} onImported={()=>{setToast("Employees imported successfully");setRefresh(r=>r+1)}}/>}
      <button
        className="help-launcher"
        aria-label="Open support assistant"
        onClick={() => setHelp(!help)}
      >
        {help ? <X size={21} /> : <MessageCircle size={21} />}
      </button>
      {help && (
        <section className="help-panel" aria-label="Support assistant">
          <div className="help-header">
            <div className="help-avatar">
              <MessageCircle size={23} />
            </div>
            <div>
              <strong>Your workspace guide</strong>
              <small>
                {session.modelConfigured
                  ? "Local model + verified help"
                  : "Prepared answers · no external AI calls"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Close support assistant"
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="chat-body">
            <div className="chat-message assistant">
              Hi! I can help you find your way around Peoplework. What would you
              like to do?
            </div>
            {chat.map((m, i) => (
              <div className={"chat-message " + m.role} key={i}>
                {m.text}
                {m.sources?.map((s: any) => (
                  <small className="chat-source" key={s.id}>
                    <BookOpen size={12} />
                    {s.title}
                  </small>
                ))}
              </div>
            ))}
            {chatBusy && (
              <div className="chat-message assistant">
                <Loader2 className="spin" size={17} />
              </div>
            )}
            {!chat.length && (
              <div className="suggestions">
                {[
                  "How do I add an employee?",
                  "How do leave policies work?",
                  "My attendance punch is missing",
                ].map((q) => (
                  <button key={q} onClick={() => sendHelp(q)}>
                    {q}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="escalate"
            onClick={() => {
              setHelp(false);
              openCreate("support");
            }}
          >
            Need a person? Create a support ticket
            <ArrowRight size={13} />
          </button>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              sendHelp();
            }}
          >
            <input
              aria-label="Ask the support assistant"
              placeholder="Ask about your workspace…"
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              aria-label="Send question"
              disabled={chatBusy || !question.trim()}
            >
              <Send size={17} />
            </button>
          </form>
          <small className="chat-privacy">
            Keep passwords and personal information out of chat.
          </small>
        </section>
      )}
      {modal && (
        <Modal
          title={modal.title}
          description={modal.description}
          fields={modal.fields}
          onClose={() => setModal(null)}
          onSave={modal.save}
        />
      )}
    </div>
  );
}
