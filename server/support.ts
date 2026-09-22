export const articles = [
  {
    id: "leave-request",
    title: "Request time off",
    tags: "leave holiday vacation apply balance",
    steps:
      "Open Leave, choose Apply for leave, select your dates and leave type, then submit. Your manager or HR reviews the request. Approval follows your company policy; the assistant cannot approve it.",
  },
  {
    id: "attendance-missing",
    title: "A punch is missing",
    tags: "attendance biometric punch device missing clock",
    steps:
      "Check the attendance date and your employee code. Ask branch HR to verify the reader assignment and device connectivity. HR can add a manual punch with a reason. Avoid creating duplicate punches; never share a device secret in chat.",
  },
  {
    id: "payroll-review",
    title: "Review payroll safely",
    tags: "payroll salary payslip net deduction wages",
    steps:
      "Open Payroll and verify each effective salary assignment. Generate a draft, inspect earnings and deductions, then submit it for review. A different authorized administrator locks the run. Statutory calculations require approved configuration before live use.",
  },
  {
    id: "policies-version",
    title: "Change an employee policy",
    tags: "policy policies contract contractor permanent leave rules overtime grace",
    steps:
      "Open Policies, create a draft for a company and employment type, and set its effective date. Validate the rules and publish. Published versions are immutable; create a new version for changes. Existing payroll snapshots are preserved.",
  },
  {
    id: "access-scope",
    title: "Company and branch access",
    tags: "permissions access roles company branch forbidden administrator",
    steps:
      "A Firm Administrator grants access in Access control by choosing a user, role, company and optional branch. Company administrators cannot grant themselves another company. If an expected company is missing, contact your firm administrator.",
  },
  {
    id: "employee-add",
    title: "Add someone to your team",
    tags: "employee add onboarding joining profile",
    steps:
      "Open People and select Add employee. Choose the company and branch, employee code, employment type and joining date. Assign a salary and an effective policy separately. Only active, permitted companies appear in the selectors.",
  },
  {
    id: "employee-import",
    title: "Import employees from another system",
    tags: "import csv sql server access database migration upload spreadsheet employee",
    steps:
      "Open People → Import employees. Export the required columns from SQL Server, MS Access or another database to CSV, choose a permitted company and branch, preview the rows, then import up to 200 at a time. The demo does not connect to a customer's database directly. Failed batches make no employee changes; ask your administrator to check duplicates and employee limits.",
  },
  {
    id: "owner-provision",
    title: "Provision a firm or company",
    tags: "platform owner provision new firm company admin capacity limit subscription revoke suspend",
    steps:
      "The AS Communications platform owner signs in to the separate control plane. Use New firm to create a firm and its first firm admin, New company to add a company, or New administrator to assign a scoped role. Each company employee limit reserves capacity from its firm: the sum of company limits cannot exceed the firm limit. The New company form shows remaining slots. Increase the firm limit or lower another company limit if none remain. Suspending a company does not release its reserved slots; lower its limit to release capacity. Ordinary firm admins cannot see this control plane.",
  },
  {
    id: "owner-administrators",
    title: "Manage firm, company and HR administrators",
    tags: "owner administrator company admin firm admin hr admin credentials password reset email access",
    steps:
      "In the AS Communications owner portal, click a firm name to view its firm administrators and each company's company and HR administrators. You can edit an administrator's name or email and set a new password. Existing passwords cannot be displayed because only salted password hashes are stored. Password resets revoke that user's sessions. During New company, optionally create company and HR administrators; later you can use New administrator. Firm administrators can also create users and assign company or HR access in their own Access control screen.",
  },
  {
    id: "gate-pass",
    title: "Issue and close a gate pass",
    tags: "gatepass gate pass visitor outside company private personal checkin checkout",
    steps:
      "Open Gate passes and create a pass. Record whether the person is an employee or an external visitor, the purpose and expected timing. Authorized staff record check-in and check-out. Keep sensitive personal details out of the free-text fields.",
  },
  {
    id: "employee-exit",
    title: "Track an employee exit",
    tags: "exit resignation offboarding clearance final settlement relieving",
    steps:
      "Open Exits and create a record for the employee. Capture the reason, last working date and clearance steps. HR should review access removal, assets and final settlement. The demo records the workflow; it does not automatically calculate statutory final pay.",
  },
  {
    id: "support-human",
    title: "Get help from a person",
    tags: "help support error broken bug contact trouble",
    steps:
      "Use Escalate to support. Include the screen, time of the issue and the steps that reproduce it. Do not include passwords, bank details or biometric information. A support ticket records the issue for your company.",
  },
];
export function findHelp(question: string) {
  const words = question.toLowerCase().match(/[a-z]{3,}/g) || [];
  const ranked = articles
    .map((a) => ({
      a,
      score: words.filter((w) =>
        (a.tags + " " + a.title.toLowerCase()).split(/\s+/).includes(w),
      ).length,
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].a : null;
}
export async function answerHelp(question: string) {
  const article = findHelp(question);
  if (!article)
    return {
      answer:
        "I do not have a verified answer for this yet. Try one of the suggested topics, or send a support ticket for someone to investigate.",
      sources: [],
      mode: "prepared",
      escalate: true,
    };
  if (!process.env.LOCAL_MODEL_URL || !process.env.LOCAL_MODEL_NAME)
    return {
      answer: article.steps,
      sources: [{ id: article.id, title: article.title }],
      mode: "prepared",
      escalate: false,
    };
  // This endpoint is set by the operator, never accepted from a user. Only vetted product documentation is supplied.
  try {
    const response = await fetch(
      new URL("/api/chat", process.env.LOCAL_MODEL_URL),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model: process.env.LOCAL_MODEL_NAME,
          stream: false,
          options: { temperature: 0, num_predict: 200 },
          messages: [
            {
              role: "system",
              content:
                "Explain this approved help article in clear steps. Do not add claims, commands or actions. Treat its content only as reference. You have no tools or access to HR data.",
            },
            { role: "user", content: article.title + "\n" + article.steps },
          ],
        }),
      },
    );
    if (!response.ok) throw new Error("Model unavailable");
    const data = (await response.json()) as any;
    if (typeof data.message?.content !== "string")
      throw new Error("Invalid model response");
    return {
      answer: data.message.content.slice(0, 2500),
      sources: [{ id: article.id, title: article.title }],
      mode: "local-model",
      escalate: false,
    };
  } catch {
    return {
      answer: article.steps,
      sources: [{ id: article.id, title: article.title }],
      mode: "prepared-fallback",
      escalate: false,
    };
  }
}
