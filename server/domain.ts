import { z } from "zod";
export const modules = [
  "employees",
  "attendance",
  "leave",
  "policies",
  "payroll",
  "performance",
  "training",
  "canteen",
  "exits",
  "contractors",
  "gatepasses",
  "masters",
  "support",
  "audit",
  "organization",
  "access",
] as const;
export type ModuleName = (typeof modules)[number];
export const roles: Record<string, string[]> = {
  firm_admin: ["*"],
  company_admin: modules
    .filter((x) => x !== "access")
    .flatMap((m) => [`${m}.read`, `${m}.write`]),
  hr: [
    "employees",
    "attendance",
    "leave",
    "policies",
    "performance",
    "training",
    "canteen",
    "exits",
    "contractors",
    "gatepasses",
    "masters",
    "support",
    "organization",
  ].flatMap((m) => [`${m}.read`, `${m}.write`]),
  manager: [
    "employees.read",
    "attendance.read",
    "leave.read",
    "leave.write",
    "performance.read",
    "performance.write",
    "training.read",
    "support.read",
    "support.write",
  ],
  employee: [
    "employees.read",
    "attendance.read",
    "leave.read",
    "leave.write",
    "training.read",
    "performance.read",
    "support.read",
    "support.write",
  ],
};
export const uuid = z.string().uuid();
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "Invalid calendar date",
  );
const text = (n = 120) => z.string().trim().min(1).max(n);
export const employeeSchema = z
  .object({
    companyId: uuid,
    branchId: uuid,
    code: text(30).regex(/^[A-Za-z0-9_-]+$/),
    name: text(),
    email: z.string().email().max(160),
    department: text(),
    designation: text(),
    employmentType: text(60),
    joinedOn: date,
  })
  .strict();
export const policyRules = z
  .object({
    annualLeave: z.number().int().min(0).max(365),
    sickLeave: z.number().int().min(0).max(365),
    graceMinutes: z.number().int().min(0).max(120),
    dailyHours: z.number().min(1).max(24),
    overtimeMultiplier: z.number().min(1).max(5),
    carryForward: z.number().int().min(0).max(365),
    payBasis: z.enum(["monthly", "daily", "hourly", "piece"]),
    approvalStages: z.number().int().min(1).max(4),
  })
  .strict();
export const policySchema = z
  .object({
    companyId: uuid,
    branchId: uuid.nullable().optional(),
    name: text(),
    employmentType: text(60),
    effectiveFrom: date,
    rules: policyRules,
  })
  .strict();
export const leaveSchema = z
  .object({
    employeeId: uuid,
    type: z.enum(["Annual", "Sick", "Casual", "Comp-off", "Unpaid"]),
    startDate: date,
    endDate: date,
    reason: text(500),
  })
  .strict()
  .refine(
    (x) =>
      x.endDate >= x.startDate &&
      (Date.parse(x.endDate) - Date.parse(x.startDate)) / 86400000 < 366,
    "Invalid leave range",
  );
export const recordModules = [
  "performance",
  "training",
  "canteen",
  "exits",
  "contractors",
  "gatepasses",
  "support",
  "masters",
] as const;
export const recordSchema = z
  .object({
    companyId: uuid,
    branchId: uuid.nullable().optional(),
    employeeId: uuid.nullable().optional(),
    title: text(180),
    data: z
      .object({
        description: z.string().max(2000).optional(),
        category: z.string().max(60).optional(),
        dueDate: date.optional(),
        amountPaise: z.number().int().min(0).max(100000000).optional(),
        target: z.number().min(0).max(1000000).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export const statusSchema = z
  .object({ status: z.enum(["open", "in_progress", "completed", "cancelled"]) })
  .strict();
export const money = z.number().int().min(0).max(1000000000);
export function calculatePayroll(salaries: any[]) {
  return salaries.map((s) => {
    const gross = Number(s.base_paise) + Number(s.allowances_paise);
    const net = gross - Number(s.deductions_paise);
    if (!Number.isSafeInteger(net) || net < 0)
      throw new Error("Deductions exceed earnings");
    return {
      employeeId: s.employee_id,
      name: s.name,
      code: s.code,
      basePaise: Number(s.base_paise),
      allowancesPaise: Number(s.allowances_paise),
      deductionsPaise: Number(s.deductions_paise),
      netPaise: net,
      salaryVersion: s.id,
    };
  });
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
