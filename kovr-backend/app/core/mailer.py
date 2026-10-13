"""
Outbound email via SMTP (env-configured). Used for account recovery.

SMTP settings (e.g. Gmail app password, Brevo, Resend SMTP):
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM
"""
import os
import smtplib
from email.message import EmailMessage


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"))


def _from_address() -> str:
    return os.getenv("MAIL_FROM") or f"KOVR <{os.getenv('SMTP_USER')}>"


def send_email(to: str, subject: str, html: str, text: str = "") -> None:
    """Send one email. Raises on failure so callers can surface an error
    instead of silently dropping a recovery message."""
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = _from_address()
    msg["To"] = to
    msg.set_content(text or "Please use an HTML-capable mail client.")
    msg.add_alternative(html, subtype="html")

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")

    with smtplib.SMTP(host, port, timeout=30) as server:
        server.starttls()
        server.login(user, password)
        server.send_message(msg)


def send_temp_password_email(to: str, temp_password: str) -> None:
    """Account-recovery email, styled like the product (dark, cyan accent).
    Inline styles + table layout only — email clients ignore stylesheets."""
    subject = "Your KOVR temporary password"
    text = (
        "KOVR account recovery\n\n"
        f"Temporary password: {temp_password}\n\n"
        "Use it as your current password on the reset page to set a new "
        "password. If you did not request this, you can ignore this email — "
        "your password only changes when the reset form is completed.\n"
    )
    html = f"""\
<div style="margin:0;padding:0;background:#0b0f16;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0f16;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111826;border:1px solid #1f2b3d;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="padding:28px 32px 0 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:12px;">
                <div style="width:40px;height:40px;border:1px solid rgba(34,211,238,0.3);background:rgba(34,211,238,0.1);border-radius:12px;text-align:center;font-size:20px;line-height:40px;">&#128737;</div>
              </td>
              <td>
                <div style="font-family:Consolas,monospace;font-size:16px;font-weight:700;color:#f4f7fb;letter-spacing:0.5px;">KOVR</div>
                <div style="font-size:10px;color:#7d8ea3;text-transform:uppercase;letter-spacing:1.5px;">AI security scanner</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:24px 32px 8px 32px;">
            <h1 style="margin:0 0 12px 0;font-size:20px;color:#f4f7fb;">Account recovery</h1>
            <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#b7c3d2;">
              Someone (hopefully you) requested a password reset for this email address.
              Use the temporary password below to set a new one.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px;">
            <div style="background:#0b111c;border:1px solid rgba(34,211,238,0.25);border-radius:10px;padding:16px;text-align:center;">
              <div style="font-size:10px;color:#7d8ea3;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">Temporary password</div>
              <div style="font-family:Consolas,monospace;font-size:20px;font-weight:700;color:#22d3ee;letter-spacing:1px;">{temp_password}</div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 8px 32px;">
            <p style="margin:0 0 12px 0;font-size:13px;line-height:1.6;color:#b7c3d2;">
              <strong style="color:#f4f7fb;">Next steps:</strong><br/>
              1. Open KOVR and choose &ldquo;Forgot password&rdquo; &rarr; reset form<br/>
              2. Enter this temporary password as the <em>current</em> password<br/>
              3. Choose your new password
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 28px 32px;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#7d8ea3;">
              Your password only changes after the reset form is completed. If you did not
              request this, you can safely ignore this email.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;background:#0d1420;border-top:1px solid #1f2b3d;">
            <p style="margin:0;font-size:11px;color:#5c6b7d;">
              KOVR &mdash; Intelligent Code Shield &amp; Auto-Fixer &middot; this is an automated message
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</div>"""
    send_email(to, subject, html, text)
