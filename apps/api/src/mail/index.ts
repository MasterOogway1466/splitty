import type { Env } from "../env.js";
import { LogMailer, SmtpMailer, type Mailer } from "./mailer.js";

export type { Mailer, MailMessage } from "./mailer.js";
export { LogMailer } from "./mailer.js";

export function createMailer(env: Env): Mailer {
  if (env.EMAIL_PROVIDER === "smtp") {
    if (!env.SMTP_URL) {
      throw new Error("EMAIL_PROVIDER=smtp requires SMTP_URL to be set");
    }
    return new SmtpMailer(env.SMTP_URL, env.MAIL_FROM);
  }
  return new LogMailer();
}
