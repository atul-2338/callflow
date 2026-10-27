import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { getBusinessById, getAllBusinesses, updateBusiness } from "./db";
import { readSmtpConfig, sendOperatorAlertEmail } from "./email";
import { isValidPoolNumber, normalizeOwnerPhone, usAreaCode } from "./phone";
import type { Business } from "./types";

/**
 * File-based pool of CallFlow numbers — the ONLY source of per-business
 * numbers. `data/phone_numbers.json` is a JSON array of
 * `{ number, status, businessId, assignedAt }`; it is created as `[]` on first
 * use and kept tiny on purpose: all reads/writes are synchronous
 * (fs.readFileSync / writeFileSync) because concurrent signups at this scale
 * are not a concern, and a plain file needs no migration and no locking.
 *
 * Routing rule that makes this work: the Dograh webhook attributes a call to
 * the business whose `assignedNumber` equals the dialled number — nothing
 * else. `businesses.assignedNumber` mirrors the pool entry; the pool file is
 * the source of truth for WHICH numbers exist.
 *
 * "pending_number" is not a stored flag: a business is pending exactly when
 * `assignedNumber` is NULL (empty pool, released number), so the state can
 * never drift from the assignment data.
 */

export interface NumberPoolEntry {
  /** E.164 US number, "+1" + 10 digits. */
  number: string;
  status: "available" | "assigned";
  /** Business row id while assigned; null while available. */
  businessId: string | null;
  /** ISO timestamp of the assignment; null while available. */
  assignedAt: string | null;
}

function poolFilePath(): string {
  const configured = process.env.NUMBERS_POOL_PATH?.trim();
  // Same resolution rule as DATABASE_PATH: a relative override is resolved
  // against the project cwd once, so tests and ops scripts always hit the
  // file the server uses.
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.join(process.cwd(), "data", "phone_numbers.json");
}

/** The pool file path the running app uses (for logs and admin copy). */
export function getPoolFilePath(): string {
  return poolFilePath();
}

function isPoolEntry(value: unknown): value is NumberPoolEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<NumberPoolEntry>;
  return (
    typeof entry.number === "string" &&
    (entry.status === "available" || entry.status === "assigned") &&
    (typeof entry.businessId === "string" || entry.businessId === null) &&
    (typeof entry.assignedAt === "string" || entry.assignedAt === null)
  );
}

function readPool(): NumberPoolEntry[] {
  const file = poolFilePath();
  if (!existsSync(file)) {
    writePool([]);
    return [];
  }
  const raw = readFileSync(file, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `[numbers-pool] ${file} is not valid JSON — fix or restore the pool file before assigning numbers.`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`[numbers-pool] ${file} must contain a JSON array.`);
  }
  // One malformed entry means the file was hand-edited into an unknown state;
  // refuse loudly rather than silently dropping numbers on the floor.
  parsed.forEach((entry, index) => {
    if (!isPoolEntry(entry)) {
      throw new Error(
        `[numbers-pool] ${file} entry #${index} is malformed — expected { number, status, businessId, assignedAt }.`
      );
    }
  });
  return parsed as NumberPoolEntry[];
}

function writePool(entries: NumberPoolEntry[]): void {
  const file = poolFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
}

/** Every pool entry, creating the file as [] on first use. */
export function listPool(): NumberPoolEntry[] {
  return readPool();
}

export function poolCounts(): { available: number; assigned: number } {
  const entries = readPool();
  return {
    available: entries.filter((e) => e.status === "available").length,
    assigned: entries.filter((e) => e.status === "assigned").length,
  };
}

export interface AssignNumberResult {
  /** The assigned E.164 number, or null when the pool is empty. */
  assignedNumber: string | null;
  /** True when nothing could be assigned (pool empty) — the caller shows the
   * "your number is being prepared" message; this case never throws. */
  pending: boolean;
}

/**
 * Assign the next available pool number to `businessId` and mirror it into
 * businesses.assignedNumber. Prefers a number in the same area code as the
 * owner's phone, otherwise the first available entry. Idempotent: a business
 * that already has an assignedNumber keeps it (never double-assigned).
 */
export async function assignNumber(
  businessId: string,
  ownerPhone: string | null
): Promise<AssignNumberResult> {
  const business = await getBusinessById(businessId);
  if (!business) {
    throw new Error(`[numbers-pool] assignNumber: business ${businessId} not found`);
  }
  if (business.assignedNumber) {
    return { assignedNumber: business.assignedNumber, pending: false };
  }

  const entries = readPool();
  const available = entries.filter((e) => e.status === "available");
  if (available.length === 0) {
    await alertPoolEmpty(business);
    return { assignedNumber: null, pending: true };
  }

  const ownerE164 = ownerPhone ? normalizeOwnerPhone(ownerPhone) : null;
  const area = ownerE164 ? usAreaCode(ownerE164) : null;
  const preferred =
    (area && available.find((e) => usAreaCode(e.number) === area)) || available[0];

  preferred.status = "assigned";
  preferred.businessId = businessId;
  preferred.assignedAt = new Date().toISOString();
  writePool(entries);

  await updateBusiness(businessId, { assignedNumber: preferred.number });
  return { assignedNumber: preferred.number, pending: false };
}

/**
 * Give a business's number back to the pool (admin "Release"): the entry
 * returns to `available` with businessId/assignedAt cleared, and the business
 * row's assignedNumber is cleared too (it becomes pending_number by
 * definition). Returns true when a pool entry was found and released.
 */
export async function releaseNumber(businessId: string): Promise<boolean> {
  const entries = readPool();
  const entry = entries.find(
    (e) => e.status === "assigned" && e.businessId === businessId
  );
  if (entry) {
    entry.status = "available";
    entry.businessId = null;
    entry.assignedAt = null;
    writePool(entries);
  }
  await updateBusiness(businessId, { assignedNumber: null });
  return Boolean(entry);
}

export interface AddNumbersResult {
  added: string[];
  /** Lines that were not valid "+1" + 10 digits. */
  skippedInvalid: string[];
  /** Valid lines already in the pool or already used on a business row. */
  skippedDuplicate: string[];
}

/**
 * Append admin-pasted numbers (one per line) to the pool as `available`.
 * Valid lines are strictly "+1" + 10 digits; duplicates already in the pool —
 * or already live on any business row (assignedNumber or owner phoneNumber,
 * so legacy manual assignments can never be double-assigned) — are skipped.
 */
export async function addNumbers(raw: string): Promise<AddNumbersResult> {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = readPool();
  const known = new Set(entries.map((e) => e.number));
  for (const business of await getAllBusinesses()) {
    if (business.assignedNumber) known.add(business.assignedNumber);
    if (business.phoneNumber) known.add(business.phoneNumber);
  }

  const result: AddNumbersResult = {
    added: [],
    skippedInvalid: [],
    skippedDuplicate: [],
  };
  for (const line of lines) {
    if (!isValidPoolNumber(line)) {
      result.skippedInvalid.push(line);
    } else if (known.has(line)) {
      result.skippedDuplicate.push(line);
    } else {
      entries.push({
        number: line,
        status: "available",
        businessId: null,
        assignedAt: null,
      });
      known.add(line);
      result.added.push(line);
    }
  }
  if (result.added.length) writePool(entries);
  return result;
}

/**
 * Pool-empty alert: ALWAYS a loud console.error, plus a best-effort email via
 * the existing SMTP code (to the business's notification email, falling back
 * to the SMTP sender). Never throws — signup must not crash because the pool
 * ran dry.
 */
async function alertPoolEmpty(business: Business): Promise<void> {
  const who = business.billingName ?? business.clientUid ?? business.id;
  console.error(
    `[numbers-pool] POOL EMPTY — no available numbers in ${poolFilePath()}. ` +
      `Business "${who}" (${business.clientUid ?? business.id}) is waiting for a number. ` +
      `Add numbers in /admin/numbers (or data/phone_numbers.json) and re-run onboarding within 24 h.`
  );
  const config = readSmtpConfig();
  if (!config) {
    console.error(
      "[numbers-pool] SMTP not configured — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM to also receive pool-empty alerts by email."
    );
    return;
  }
  const to = business.notificationEmail?.trim() || config.from;
  const name = business.billingName?.trim() || "your business";
  const result = await sendOperatorAlertEmail(
    config,
    to,
    "CallFlow: your number is being prepared",
    `Hi ${name},\n\n` +
      `your CallFlow number is being prepared and you will receive it by email within 24 hours.\n` +
      `No action is needed from you — once the number is ready, sign in and the setup flow will show it with the forwarding instructions.\n\n` +
      `— CallFlow`
  );
  if (!result.sent) {
    console.error(`[numbers-pool] Pool-empty email not sent: ${result.error}`);
  }
}