// Author: Brijesh Dave <https://github.com/brijeshdave>
// User contract: the profile fields Reportly owns alongside better-auth's managed
// auth tables. Roles are assigned via groups, never stored on the user.
import { z } from "zod";

import {
  entityStatusSchema,
  nameSchema,
  timestampsSchema,
  uuidSchema,
  patchSchemaOf,
} from "@/entities/common.js";

/** The organisation's own identifier for the person. Kept free-form (formats vary
 * widely) and not unique here — a person may hold different ids across companies. */
export const employeeIdSchema = z.string().trim().max(64);

/**
 * Login name. Unique across the install and required: a user signs in with either
 * their email or this. Lowercased so that "Brijesh" and "brijesh" can never be two
 * accounts — a login name that is ambiguous is a login name that is a security bug.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dot, underscore or hyphen");

/**
 * Mobile number in E.164 (a leading + and country code, e.g. +919876543210).
 * Required in that shape because every messaging channel that uses it — SMS,
 * WhatsApp, Telegram — addresses a number internationally; a local-format number
 * is not deliverable.
 */
export const mobileSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +919876543210");

/** A Discord handle. Discord cannot be reached by phone number, so it is its own
 * address rather than a flag on the mobile. */
export const discordHandleSchema = z
  .string()
  .trim()
  .min(2)
  .max(37)
  .regex(/^[A-Za-z0-9._#]+$/, "Use letters, numbers, dot, underscore or #");

/**
 * A login name derived from an email address: its local part, reduced to the
 * allowed alphabet and padded to the minimum length. Used to seed the first
 * superadmin and to pre-fill the create-user form — a suggestion, not a
 * guarantee of uniqueness, which only the database can settle.
 */
export function suggestUsername(email: string): string {
  const local = email.split("@")[0] ?? "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const base = cleaned === "" ? "user" : cleaned;
  return (base.length < 3 ? `${base}usr` : base).slice(0, 32);
}

/**
 * A picture, already resized by the browser and base64-encoded. Sent as JSON rather
 * than multipart: at 256px the payload is tens of kilobytes, and this keeps a file
 * upload from being a new dependency and a new parser on the edge of the API.
 */
export const avatarUploadSchema = z.object({
  data: z.string().min(1),
});

export type AvatarUpload = z.infer<typeof avatarUploadSchema>;

export const userSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    email: z.string().email(),
    username: z.string(),
    avatarUrl: z.string().url().nullable().optional(),
    /**
     * When their picture last changed, or null if they have none. A cache-buster,
     * not data: the image URL carries it, so a new picture is a new URL and an
     * unchanged one is served from the browser's cache.
     */
    avatarVersion: z.number().nullable().optional(),
    /** Which designation they hold, from the managed catalogue. */
    designationId: uuidSchema.nullable().optional(),
    /** Its name, resolved for display. Read-only — set `designationId` to change it. */
    designation: z.string().nullable().optional(),
    employeeId: z.string().nullable().optional(),
    /** Whether this person is ranked on the leaderboard. On by default. */
    countsOnLeaderboard: z.boolean().default(true),

    // Contact channels. Email is the only required one; the rest are optional and
    // each is verified independently (see the channel contract).
    mobile: z.string().nullable().optional(),
    /** The mobile is reachable on WhatsApp / Telegram. */
    whatsappOnMobile: z.boolean().default(false),
    telegramOnMobile: z.boolean().default(false),
    discordHandle: z.string().nullable().optional(),

    /** Whether they have a second factor enrolled. Read-only here: it is turned on
     * by the person themselves, and can only be *removed* by an administrator. */
    twoFactorEnabled: z.boolean().default(false),

    emailVerified: z.boolean().default(false),
    mobileVerified: z.boolean().default(false),
    whatsappVerified: z.boolean().default(false),
    telegramVerified: z.boolean().default(false),
    discordVerified: z.boolean().default(false),

    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type User = z.infer<typeof userSchema>;

/**
 * Creating a user directly, as an administrator. `password` is optional: give one
 * and the person can sign in at once (they are made to change it first); leave it
 * out and they are emailed a set-password link, exactly as an invite does.
 */
export const createUserSchema = z.object({
  name: nameSchema,
  email: z.string().email(),
  username: usernameSchema,
  password: z.string().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  designationId: uuidSchema.nullable().optional(),
  employeeId: employeeIdSchema.optional(),
  countsOnLeaderboard: z.boolean().default(true),
  mobile: mobileSchema.optional(),
  whatsappOnMobile: z.boolean().default(false),
  telegramOnMobile: z.boolean().default(false),
  discordHandle: discordHandleSchema.optional(),
  status: entityStatusSchema.default("active"),
});

export type CreateUser = z.infer<typeof createUserSchema>;

/**
 * A password is set through the auth endpoints, never by editing the user.
 *
 * The optional fields are nullable as well as absent: absent means "leave it
 * alone", null means "clear it". Without the distinction there is no way to
 * remove a mobile number once one is set.
 */
export const updateUserSchema = patchSchemaOf(createUserSchema.omit({ password: true })).extend({
  avatarUrl: z.string().url().nullable().optional(),
  designationId: uuidSchema.nullable().optional(),
  employeeId: employeeIdSchema.nullable().optional(),
  mobile: mobileSchema.nullable().optional(),
  discordHandle: discordHandleSchema.nullable().optional(),
});

export type UpdateUser = z.infer<typeof updateUserSchema>;
