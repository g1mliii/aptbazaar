import { z } from "zod";

// Shared primitives for every row/input schema. Money is always integer cents.
// Timestamps come back from Supabase as ISO strings; we keep them as strings on read
// rather than coercing to Date so a row schema round-trips a Supabase row unchanged.

export const uuid = z.uuid();
export const timestamptz = z.string();
export const email = z.email();
export const cents = z.number().int().nonnegative();
export const phoneE164 = z.string().regex(/^\+[1-9]\d{1,14}$/, "Use international format, e.g. +14155550100");
export const currency = z.string().length(3).default("CAD");
