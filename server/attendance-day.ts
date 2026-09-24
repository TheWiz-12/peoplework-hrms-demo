export type PunchEvent = {
  id: string;
  occurred_at: string | Date;
  direction: "in" | "out" | "unknown";
  source: string;
  device_id?: string | null;
  note?: string;
};

// Work time uses completed IN -> OUT pairs within this branch-local day.
// Repeated IN punches stay in the audit trail without resetting the first IN.
export function summarizeAttendanceDay(events: PunchEvent[]) {
  const ordered = [...events].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
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
    if (event.direction === "in") {
      inCount++;
      firstIn ??= occurredAt;
      openIn ??= instant;
    } else if (event.direction === "out") {
      outCount++;
      lastOut = occurredAt;
      if (openIn !== null && instant >= openIn) {
        workedMs += instant - openIn;
        openIn = null;
      }
    } else {
      unknownCount++;
    }
    return { ...event, occurred_at: occurredAt };
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
