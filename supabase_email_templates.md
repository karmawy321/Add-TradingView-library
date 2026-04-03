# Supabase Auth Email Templates

Copy and paste each of these blocks into your Supabase Dashboard -> Authentication -> Email Templates.

## 1. Invite User
This is sent when you invite a new user from the Supabase dashboard.

**Subject:** Invitation: Join Fractal AI Agent

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1018;border:1px solid rgba(201,168,76,0.2);border-radius:16px;overflow:hidden;max-width:560px;">
        <tr>
          <td align="center" style="padding:40px 40px 24px;border-bottom:1px solid rgba(201,168,76,0.1);">
            <img src="https://fractalaiagent.com/logo.svg" width="64" height="64" alt="Fractal AI Agent" style="display:block;margin:0 auto 16px;">
            <p style="margin:0;color:rgba(201,168,76,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Fractal AI Agent</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;color:#f0d878;font-size:22px;font-weight:600;">You have been invited</h1>
            <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">You've been invited to join Fractal AI Agent. Click the button below to accept the invitation and set up your account.</p>
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">Accept Invitation →</a>
            <p style="margin:24px 0 0;color:rgba(255,255,255,0.3);font-size:12px;">This link will expire soon. If you were not expecting this invitation, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(201,168,76,0.1);">
            <p style="margin:0;color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;">You're receiving this because you were invited to fractalaiagent.com<br>© 2026 Fractal AI Agent</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

## 2. Magic Link
This is sent when a user requests to sign in without a password via a magic link.

**Subject:** Your Magic Link for Fractal AI Agent

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1018;border:1px solid rgba(201,168,76,0.2);border-radius:16px;overflow:hidden;max-width:560px;">
        <tr>
          <td align="center" style="padding:40px 40px 24px;border-bottom:1px solid rgba(201,168,76,0.1);">
            <img src="https://fractalaiagent.com/logo.svg" width="64" height="64" alt="Fractal AI Agent" style="display:block;margin:0 auto 16px;">
            <p style="margin:0;color:rgba(201,168,76,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Fractal AI Agent</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;color:#f0d878;font-size:22px;font-weight:600;">Your Magic Link</h1>
            <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">Click the secure link below to instantly sign in to your Fractal AI Agent account. No password required.</p>
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">Sign In Securely →</a>
            <p style="margin:24px 0 0;color:rgba(255,255,255,0.3);font-size:12px;">This link empowers a one-time login. If you didn't request a magic link, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(201,168,76,0.1);">
            <p style="margin:0;color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;">You're receiving this because a login was requested at fractalaiagent.com<br>© 2026 Fractal AI Agent</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

## 3. Change Email Address
This is sent when a user requests to change the email associated with their account.

**Subject:** Confirm Your New Email Address

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1018;border:1px solid rgba(201,168,76,0.2);border-radius:16px;overflow:hidden;max-width:560px;">
        <tr>
          <td align="center" style="padding:40px 40px 24px;border-bottom:1px solid rgba(201,168,76,0.1);">
            <img src="https://fractalaiagent.com/logo.svg" width="64" height="64" alt="Fractal AI Agent" style="display:block;margin:0 auto 16px;">
            <p style="margin:0;color:rgba(201,168,76,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Fractal AI Agent</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;color:#f0d878;font-size:22px;font-weight:600;">Confirm email update</h1>
            <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">A request was made to update the email address linked to your account. Please click the button below to confirm this change.</p>
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">Update Email →</a>
            <p style="margin:24px 0 0;color:rgba(255,255,255,0.3);font-size:12px;">If you didn't initiate this change, immediately secure your account and ignore this action.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(201,168,76,0.1);">
            <p style="margin:0;color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;">You're receiving this because an email update was requested at fractalaiagent.com<br>© 2026 Fractal AI Agent</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

## 4. Reset Password
This is sent when a user uses the "Forgot password?" link we just implemented.

**Subject:** Reset Your Password

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1018;border:1px solid rgba(201,168,76,0.2);border-radius:16px;overflow:hidden;max-width:560px;">
        <tr>
          <td align="center" style="padding:40px 40px 24px;border-bottom:1px solid rgba(201,168,76,0.1);">
            <img src="https://fractalaiagent.com/logo.svg" width="64" height="64" alt="Fractal AI Agent" style="display:block;margin:0 auto 16px;">
            <p style="margin:0;color:rgba(201,168,76,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Fractal AI Agent</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;color:#f0d878;font-size:22px;font-weight:600;">Reset your password</h1>
            <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">We received a request to recover your account. Click the button below to securely set a new password.</p>
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">Reset Password →</a>
            <p style="margin:24px 0 0;color:rgba(255,255,255,0.3);font-size:12px;">This link will expire in 24 hours. If you did not request a password reset, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(201,168,76,0.1);">
            <p style="margin:0;color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;">You're receiving this because a password reset was requested at fractalaiagent.com<br>© 2026 Fractal AI Agent</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

## 5. Reauthentication
This is sent when a user performs a highly sensitive action that requires them to re-verify their identity. Supabase provides a 6-digit OTP code for this.

**Subject:** Verify Your Identity

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1018;border:1px solid rgba(201,168,76,0.2);border-radius:16px;overflow:hidden;max-width:560px;">
        <tr>
          <td align="center" style="padding:40px 40px 24px;border-bottom:1px solid rgba(201,168,76,0.1);">
            <img src="https://fractalaiagent.com/logo.svg" width="64" height="64" alt="Fractal AI Agent" style="display:block;margin:0 auto 16px;">
            <p style="margin:0;color:rgba(201,168,76,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Fractal AI Agent</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;color:#f0d878;font-size:22px;font-weight:600;">Verify your identity</h1>
            <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">A sensitive action was requested on your account. To proceed, please use the secure code below or click the link to reauthenticate.</p>
            
            <div style="background:rgba(201,168,76,0.05);border:1px dashed rgba(201,168,76,0.4);border-radius:6px;padding:16px;text-align:center;margin-bottom:24px;">
              <span style="font-family:'DM Mono',monospace;font-size:32px;font-weight:500;color:#f0d878;letter-spacing:8px;">{{ .Token }}</span>
            </div>

            <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">Auto Reauthenticate →</a>
            <p style="margin:24px 0 0;color:rgba(255,255,255,0.3);font-size:12px;">This token expires quickly. If you did not trigger this request, secure your account immediately.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(201,168,76,0.1);">
            <p style="margin:0;color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;">You're receiving this because an identity check was requested at fractalaiagent.com<br>© 2026 Fractal AI Agent</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```
