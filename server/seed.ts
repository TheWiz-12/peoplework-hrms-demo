import { randomUUID } from "node:crypto";
import { Database } from "./db";
import { hashPassword } from "./security";
import { roles } from "./domain";
export const ids = {
  tenant: "10000000-0000-4000-8000-000000000001",
  other: "10000000-0000-4000-8000-000000000002",
  a: "20000000-0000-4000-8000-000000000001",
  b: "20000000-0000-4000-8000-000000000002",
  c: "20000000-0000-4000-8000-000000000003",
  a1: "30000000-0000-4000-8000-000000000001",
  a2: "30000000-0000-4000-8000-000000000002",
  b1: "30000000-0000-4000-8000-000000000003",
  c1: "30000000-0000-4000-8000-000000000004",
  admin: "40000000-0000-4000-8000-000000000001",
  company: "40000000-0000-4000-8000-000000000002",
  employee: "40000000-0000-4000-8000-000000000003",
  manager: "40000000-0000-4000-8000-000000000004",
  otherAdmin: "40000000-0000-4000-8000-000000000005",
  device: "60000000-0000-4000-8000-000000000001",
};
export const employeeId = (i: number) =>
  `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
export async function seed(db: Database) {
  // Supplied only through the hosting environment; demo credentials must not
  // be committed to the public repository.
  const demoPassword = process.env.DEMO_PASSWORD;
  if (!demoPassword)
    throw new Error("DEMO_PASSWORD is required when DEMO_MODE is enabled");
  await db.owner(async (q) => {
    if ((await q.query("SELECT id FROM tenants LIMIT 1")).rows.length) return;
    await q.query("INSERT INTO tenants VALUES ($1,$2),($3,$4)", [
      ids.tenant,
      "Meridian Group",
      ids.other,
      "Separate Tenant",
    ]);
    for (const [id, t, name, code] of [
      [ids.a, ids.tenant, "Meridian Logistics", "ML"],
      [ids.b, ids.tenant, "Meridian Manufacturing", "MM"],
      [ids.c, ids.other, "Other Firm Ltd", "OF"],
    ])
      await q.query("INSERT INTO companies VALUES ($1,$2,$3,$4)", [
        id,
        t,
        name,
        code,
      ]);
    for (const [id, t, c, name] of [
      [ids.a1, ids.tenant, ids.a, "Indore · Head office"],
      [ids.a2, ids.tenant, ids.a, "Mumbai · Operations"],
      [ids.b1, ids.tenant, ids.b, "Pune · Manufacturing"],
      [ids.c1, ids.other, ids.c, "Other firm branch"],
    ])
      await q.query(
        "INSERT INTO branches(id,tenant_id,company_id,name) VALUES ($1,$2,$3,$4)",
        [id, t, c, name],
      );
    const names = [
      "Aarav Mehta",
      "Priya Sharma",
      "Kabir Patel",
      "Ananya Rao",
      "Rohan Desai",
      "Ishita Shah",
      "Arjun Nair",
      "Neha Verma",
      "Dev Joshi",
      "Sara Khan",
      "Vihaan Singh",
      "Meera Iyer",
      "Aditya Gupta",
      "Riya Kapoor",
      "Kunal Jain",
      "Tara Malhotra",
      "Rahul Das",
      "Sana Ali",
      "Vikram Sethi",
      "Nisha Bhat",
      "Mohit Roy",
      "Pooja Menon",
      "Yash Shah",
      "Zoya Ahmed",
    ];
    for (let i = 1; i <= 25; i++) {
      const other = i === 25;
      const t = other ? ids.other : ids.tenant;
      const c = other ? ids.c : i > 18 ? ids.b : ids.a;
      const b = other ? ids.c1 : i > 18 ? ids.b1 : i > 12 ? ids.a2 : ids.a1;
      const type = i % 4 === 0 ? "Contract" : "Permanent";
      await q.query(
        "INSERT INTO employees(id,tenant_id,company_id,branch_id,code,name,email,department,designation,employment_type,joined_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          employeeId(i),
          t,
          c,
          b,
          `EMP${String(i).padStart(3, "0")}`,
          names[i - 1] || "Other Tenant Person",
          `employee${i}@example.test`,
          ["Operations", "People & Culture", "Finance", "Engineering"][i % 4],
          ["Operations executive", "HR partner", "Accountant", "Team lead"][
            i % 4
          ],
          type,
          "2025-04-01",
        ],
      );
      await q.query(
        "INSERT INTO salary_assignments(id,tenant_id,company_id,branch_id,employee_id,base_paise,allowances_paise,deductions_paise,effective_from) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          t,
          c,
          b,
          employeeId(i),
          (30000 + i * 1700) * 100,
          500000,
          180000,
          "2025-04-01",
        ],
      );
      if (i % 5 !== 0)
        await q.query(
          "INSERT INTO attendance(id,tenant_id,company_id,branch_id,employee_id,occurred_at,direction,source,event_key) VALUES ($1,$2,$3,$4,$5,$6,'in','demo',$7)",
          [
            randomUUID(),
            t,
            c,
            b,
            employeeId(i),
            new Date().toISOString().slice(0, 10) +
              `T03:${String(20 + i).padStart(2, "0")}:00Z`,
            `seed-${i}`,
          ],
        );
    }
    await q.query("INSERT INTO team_links VALUES ($1,$2,$3),($1,$2,$4)", [
      ids.tenant,
      employeeId(2),
      employeeId(1),
      employeeId(3),
    ]);
    for (const [id, email, name, role, c, e, t] of [
      [
        ids.admin,
        "admin@meridian.test",
        "Anika Kapoor",
        "firm_admin",
        null,
        null,
        ids.tenant,
      ],
      [
        ids.company,
        "company@meridian.test",
        "Company A Administrator",
        "company_admin",
        ids.a,
        null,
        ids.tenant,
      ],
      [
        ids.employee,
        "employee@meridian.test",
        "Aarav Mehta",
        "employee",
        ids.a,
        employeeId(1),
        ids.tenant,
      ],
      [
        ids.manager,
        "manager@meridian.test",
        "Priya Sharma",
        "manager",
        ids.a,
        employeeId(2),
        ids.tenant,
      ],
      [
        ids.otherAdmin,
        "other@example.test",
        "Other Firm Admin",
        "firm_admin",
        null,
        null,
        ids.other,
      ],
    ] as any[]) {
      await q.query(
        "INSERT INTO auth.users(id,tenant_id,email,name,password_hash,employee_id) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, t, email, name, hashPassword(demoPassword), e],
      );
      await q.query(
        "INSERT INTO auth.grants(id,tenant_id,user_id,role,company_id,permissions) VALUES ($1,$2,$3,$4,$5,$6)",
        [randomUUID(), t, id, role, c, [...roles[role], "organization.read"]],
      );
    }
    for (const c of [ids.a, ids.b])
      for (const type of ["Permanent", "Contract"])
        await q.query(
          "INSERT INTO policies(id,tenant_id,company_id,name,employment_type,version,effective_from,rules,status) VALUES ($1,$2,$3,$4,$5,1,'2026-01-01',$6,'published')",
          [
            randomUUID(),
            ids.tenant,
            c,
            `${type} · Standard policy`,
            type,
            JSON.stringify({
              annualLeave: type === "Permanent" ? 18 : 12,
              sickLeave: 6,
              graceMinutes: 10,
              dailyHours: 8,
              overtimeMultiplier: 1.5,
              carryForward: 5,
              payBasis: type === "Permanent" ? "monthly" : "daily",
              approvalStages: 1,
            }),
          ],
        );
    for (const [i, type, start, end, reason] of [
      [1, "Annual", "2026-10-05", "2026-10-07", "Family time"],
      [3, "Sick", "2026-10-08", "2026-10-08", "Medical appointment"],
      [8, "Casual", "2026-10-12", "2026-10-12", "Personal commitment"],
    ] as any[])
      await q.query(
        "INSERT INTO leave_requests(id,tenant_id,company_id,branch_id,employee_id,type,start_date,end_date,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          ids.tenant,
          ids.a,
          ids.a1,
          employeeId(i),
          type,
          start,
          end,
          reason,
        ],
      );
    const examples: Record<string, [string, any][]> = {
      performance: [
        [
          "Improve delivery reliability",
          {
            description: "Achieve 98% on-time dispatch this quarter.",
            target: 98,
            dueDate: "2026-12-31",
          },
        ],
      ],
      training: [
        [
          "Workplace safety essentials",
          {
            description: "A practical safety workshop for operations teams.",
            dueDate: "2026-10-15",
          },
        ],
      ],
      canteen: [
        [
          "September lunch plan",
          { description: "Weekday lunch subscription", amountPaise: 150000 },
        ],
      ],
      exits: [
        [
          "Exit workflow template",
          {
            description:
              "Notice, clearance, settlement and relieving letter checklist.",
          },
        ],
      ],
      contractors: [
        [
          "Northstar Workforce",
          { description: "Warehouse staffing partner", category: "Agency" },
        ],
      ],
      gatepasses: [
        [
          "Client site visit",
          {
            description: "Operations visit to the Indore distribution centre.",
            dueDate: "2026-10-02",
          },
        ],
      ],
      masters: [
        [
          "Permanent",
          {
            description: "Regular on-roll employment",
            category: "Employment type",
          },
        ],
        [
          "Contract",
          { description: "Contract workforce", category: "Employment type" },
        ],
        ["Operations", { category: "Department" }],
      ],
      support: [],
    };
    for (const [module, rows] of Object.entries(examples))
      for (const [title, data] of rows)
        await q.query(
          "INSERT INTO records(id,tenant_id,company_id,branch_id,module,title,data) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            ids.tenant,
            ids.a,
            ids.a1,
            module,
            title,
            JSON.stringify(data),
          ],
        );
    await q.query("INSERT INTO auth.devices VALUES ($1,$2,$3,$4,$5,$6,true)", [
      ids.device,
      ids.tenant,
      ids.a,
      ids.a1,
      "Indore entrance",
      // Deliberately regenerated every demo start; public source must never
      // contain a biometric credential, even for a fictional environment.
      randomUUID(),
    ]);
  });
}
