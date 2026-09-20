import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

// docs/PLAN-PUBLIC.md §9: sending mail reliably from a self-run server is
// hard everywhere (cloud providers commonly block outbound port 25 too),
// so the real adapter speaks SMTP against a transactional provider's relay
// rather than raw sendmail — that keeps this provider-agnostic (Resend,
// Mailgun, Brevo, etc. all expose SMTP) without a vendor SDK dependency
// we can't test against here anyway.
export class SmtpMailer implements Mailer {
  #transport: ReturnType<typeof nodemailer.createTransport>;
  #from: string;

  constructor(smtpUrl: string, from: string) {
    this.#transport = nodemailer.createTransport(smtpUrl);
    this.#from = from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.#transport.sendMail({ from: this.#from, ...message });
  }
}

// Dev/test adapter: never touches the network, never needs real
// credentials, and captures sent messages so tests can assert on the
// verification/reset link that would have been emailed.
export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    console.log(`[mail:log] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}
