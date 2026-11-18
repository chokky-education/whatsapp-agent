// Shared wire contract for the separate, opt-in task channel.
export const WORK_SYNC_MS = 15_000;
export const WORK_FRESH_MS = 45_000;
export const WORK_PROOF_MS = 60_000;
export const WORK_TTL_MS = 86_400_000;
export const WORK_BODY_LIMIT = 256 * 1024;
export const WORK_MAX_OUTCOMES = 16;
export const isWorkId = (value) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isTaskId = (value) => Number.isSafeInteger(value) && value > 0;

export function workLabel(value, length) {
  if (typeof value !== "string") return null;
  return value
    .replace(/[^\s<>]+@(?:s\.whatsapp\.net|g\.us|hosted(?:\.lid)?|lid|c\.us|broadcast|newsletter)\b/gi, "［ข้อมูลติดต่อ］")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, "［ข้อมูลติดต่อ］")
    .replace(/(?:https?:\/\/[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b(?:[/:?#][^\s<>]*)?)/gi, "［ลิงก์］")
    .replace(/\+?\d(?:[(). -]*\d){7,}/g, "［ข้อมูลติดต่อ］")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim().slice(0, length) || null;
}

const stamp = (value) => Number.isSafeInteger(value) && value >= 0;
const optionalStamp = (value) => value === null || (stamp(value) && value <= 8_640_000_000_000_000);
const reasons = new Set(["expired", "offline", "forbidden", "missing", "reassigned", "closed", "erased"]);
const outcomes = new Set(["applied", "already_done", "rejected"]);
const modes = new Set(["ready", "offline", "missing", "purge"]);
function invalid() { throw new Error("invalid_work"); }

export function sanitizeWorkSync(raw, pilot, memberKey, now) {
  if (
    !raw || raw.pilot !== pilot || raw.memberKey !== memberKey || !isWorkId(raw.runId) || !isTaskId(raw.revision) ||
    !stamp(raw.epoch) || !stamp(raw.generatedAt) || raw.generatedAt > now + 5_000 ||
    raw.generatedAt <= now - WORK_FRESH_MS || !modes.has(raw.mode) ||
    (raw.claim !== undefined && typeof raw.claim !== "boolean") ||
    !Array.isArray(raw.outcomes) || raw.outcomes.length > WORK_MAX_OUTCOMES
  ) invalid();
  const { revision, epoch, runId, mode } = raw;
  const generatedAt = Math.min(raw.generatedAt, now);
  let proofAt = null, tasks = null;
  if (mode === "ready") {
    if (!stamp(raw.proofAt) || raw.proofAt > raw.generatedAt || raw.proofAt < now - WORK_PROOF_MS ||
        !Array.isArray(raw.tasks)) invalid();
    proofAt = Math.min(raw.proofAt, now);
    const ids = new Set();
    tasks = raw.tasks.map((task) => {
      if (!task || !isTaskId(task.id) || ids.has(task.id) || typeof task.mine !== "boolean" ||
          !optionalStamp(task.dueAt) || !optionalStamp(task.doneAt) ||
          (task.projectId !== null && !isTaskId(task.projectId))) invalid();
      ids.add(task.id);
      const project = workLabel(task.project, 120);
      return {
        id: task.id,
        title: workLabel(task.title, 360) || "งานไม่มีชื่อ",
        projectId: project ? task.projectId : null,
        project,
        assignee: workLabel(task.assignee, 80),
        mine: task.mine,
        dueAt: task.dueAt,
        doneAt: task.doneAt,
      };
    });
  }
  const receipts = new Set();
  const explicitOutcomes = raw.outcomes.map((outcome) => {
    if (!outcome || !isWorkId(outcome.requestId) || receipts.has(outcome.requestId) || !outcomes.has(outcome.result)) invalid();
    receipts.add(outcome.requestId);
    if (outcome.result === "rejected") {
      if (!reasons.has(outcome.reason)) invalid();
      return { requestId: outcome.requestId, result: outcome.result, reason: outcome.reason, doneAt: null };
    }
    if (!stamp(outcome.doneAt) || outcome.doneAt > now + 5_000) invalid();
    return { requestId: outcome.requestId, result: outcome.result, reason: null, doneAt: outcome.doneAt };
  });
  return { revision, epoch, runId, mode, generatedAt, proofAt, tasks, outcomes: explicitOutcomes, claim: raw.claim !== false };
}
