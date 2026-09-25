export type PunchEvent = {
  id: string;
  occurred_at: string | Date;
  direction: "in" | "out" | "unknown";
  source: string;
  device_id?: string | null;
  note?: string;
};

export type AttendanceRule = {
  punchRequired: boolean;
  halfDayEnabled: boolean;
  shortLeaveEnabled: boolean;
  presentMinHours: number;
  halfDayMaxHours: number;
  shortDayMaxHours: number;
};

export function classifyAttendance(workedMinutes: number, punches: number, rule: AttendanceRule, approvedLeave = false) {
  if (approvedLeave) return "leave";
  if (!rule.punchRequired) return "present";
  if (punches === 0 || workedMinutes < rule.presentMinHours * 60) return "absent";
  if (rule.halfDayEnabled && workedMinutes <= rule.halfDayMaxHours * 60) return "half-day";
  if (rule.shortLeaveEnabled && workedMinutes <= rule.shortDayMaxHours * 60) return "short-day";
  return "present";
}

// Work time uses completed IN -> OUT pairs within this branch-local day.
// Repeated IN punches stay in the audit trail without resetting the first IN.
export function summarizeAttendanceDay(events: PunchEvent[]) {
  const ordered = [...events].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() || a.id.localeCompare(b.id),
  );
  let firstIn: string | null = null;
  let lastOut: string | null = null;
  let openIn: number | null = null;
  let workedMs = 0;
  let inCount = 0;
  let outCount = 0;
  let unknownCount = 0;

  const normalized = ordered.map((event) => {
    const occurredAt = new Date(event.occurred_at).toISOString();
    const instant = Date.parse(occurredAt);
    // For one reader, every successive event for this employee/workday
    // alternates. Deriving at read time also handles delayed/out-of-order data.
    const direction = event.direction === "unknown" ? (openIn === null ? "in" : "out") : event.direction;
    if (direction === "in") {
      inCount++;
      firstIn ??= occurredAt;
      openIn ??= instant;
    } else if (direction === "out") {
      outCount++;
      lastOut = occurredAt;
      if (openIn !== null && instant >= openIn) {
        workedMs += instant - openIn;
        openIn = null;
      }
    } else unknownCount++;
    return { ...event, direction, occurred_at: occurredAt };
  });

  return {
    events: normalized,
    totalPunches: normalized.length,
    inCount,
    outCount,
    unknownCount,
    firstIn,
    lastOut,
    workedMinutes: Math.floor(workedMs / 60000),
    openSession: openIn !== null,
  };
}
