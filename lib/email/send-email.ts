import "server-only";

import { z } from "zod";

import { getCloudflareEmailBinding } from "@/lib/email/cloudflare-email";
import { optionalEnv, requiredEnv } from "@/lib/env";

const sendEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  subject: z.string().min(1),
  html: z.string().min(1),
  text: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional()
});

type SendEmailInput = z.infer<typeof sendEmailSchema>;

export async function sendEmail(input: SendEmailInput) {
  const payload = sendEmailSchema.parse(input);
  const fromEmail = requiredEnv("CLOUDFLARE_EMAIL_FROM");
  const fromName = optionalEnv("CLOUDFLARE_EMAIL_FROM_NAME");

  return getCloudflareEmailBinding().send({
    from: {
      email: fromEmail,
      ...(fromName ? { name: fromName } : {})
    },
    ...payload
  });
}
