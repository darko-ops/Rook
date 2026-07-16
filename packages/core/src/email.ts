/**
 * Minimal email sender. Production: Resend via RESEND_API_KEY + EMAIL_FROM
 * (plain fetch, no SDK). Dev: log to stdout so the magic link is copyable
 * from the worker/server console. Swap providers by replacing one function.
 */
export interface Email {
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(email: Email): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Rook <hello@rook.ai>';
  if (!apiKey) {
    console.log(`\n[email:dev] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text }),
  });
  if (!res.ok) throw new Error(`email send failed: ${res.status} ${await res.text()}`);
}
