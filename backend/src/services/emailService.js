/**
 * Email Service
 *
 * Handles all outbound email delivery with:
 *  - Retry logic: up to 3 attempts with exponential backoff (1s, 2s, 4s)
 *  - Transient vs permanent failure classification (no infinite retry)
 *  - Delivery audit trail (EMAIL_*_SENT / EMAIL_DELIVERY_FAILED)
 *  - Rich HTML templates for each email type
 *
 * Transport selection:
 *  - Development (default): logs to console only — no setup required
 *  - Production: set EMAIL_USER + EMAIL_PASSWORD and either:
 *      - EMAIL_HOST + EMAIL_PORT  (SMTP, e.g. Mailtrap, SendGrid, Mailgun SMTP)
 *      - EMAIL_SERVICE            (named service, e.g. 'gmail')
 */

const nodemailer = require('nodemailer');
const { createAuditLog } = require('./auditService');

// ─── Retry constants ──────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000; // delays: 1 s, 2 s, 4 s

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Classify a nodemailer/SMTP error as transient (safe to retry) or permanent.
 *
 * Transient: network blips, temporary server unavailability (4xx SMTP).
 * Permanent: bad credentials, invalid recipient address, domain not found.
 */
const isTransientError = (err) => {
  const code = err.code || '';
  const responseCode = err.responseCode || 0;
  const message = (err.message || '').toLowerCase();

  // Network-level errors → transient
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(code)) {
    return true;
  }

  // SMTP 4xx temporary failures (421 = service unavailable, 450/451 = mailbox temp issues)
  // 452 = mailbox full — treat as permanent (no point retrying immediately)
  if (responseCode >= 400 && responseCode < 500 && responseCode !== 452) {
    return true;
  }

  // Generic keyword hints
  if (message.includes('connection timed out') || message.includes('network')) {
    return true;
  }

  return false;
};

// ─── Transport factory ────────────────────────────────────────────────────────

const isDevMode = () => {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your-email@gmail.com') return true;
  return !(process.env.EMAIL_HOST || process.env.EMAIL_SERVICE);
};

const createTransporter = () => {
  if (isDevMode()) return null;

  if (process.env.EMAIL_HOST) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number.parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  }

  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

// ─── Core retry sender ────────────────────────────────────────────────────────

/**
 * Send mail with up to MAX_ATTEMPTS attempts, exponential backoff between tries.
 *
 * Returns:
 *   { success: true,  messageId, attempts }
 *   { success: false, error, attempts, permanent }
 */
const sendWithRetry = async (transporter, mailOptions) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      return { success: true, messageId: info.messageId, attempts: attempt };
    } catch (err) {
      lastError = err;

      if (!isTransientError(err)) {
        // Permanent failure — stop immediately
        console.error(`[EMAIL] Permanent failure (attempt ${attempt}) to ${mailOptions.to}:`, err.message);
        return { success: false, error: err.message, attempts: attempt, permanent: true };
      }

      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[EMAIL] Transient failure (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms:`,
          err.message
        );
        await sleep(delay);
      } else {
        console.error(`[EMAIL] All ${MAX_ATTEMPTS} attempts exhausted for ${mailOptions.to}:`, err.message);
      }
    }
  }

  return { success: false, error: lastError?.message, attempts: MAX_ATTEMPTS, permanent: false };
};

// ─── Delivery audit helper ────────────────────────────────────────────────────

/**
 * Best-effort audit log for email delivery.
 * Never throws — email failures must not cascade into request errors.
 */
const logDelivery = async ({ action, userId, email, extra = {} }) => {
  if (!userId) return;
  try {
    await createAuditLog({
      action,
      actorId: userId,
      targetId: userId,
      changes: { email, ...extra },
    });
  } catch (err) {
    console.error(`[EMAIL] Audit log failed for ${action} (non-fatal):`, err.message);
  }
};

// ─── HTML templates ───────────────────────────────────────────────────────────

const baseHtml = (title, bodyContent) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f4f6f9; margin: 0; padding: 24px; }
    .card { background: #ffffff; border-radius: 8px; max-width: 560px;
            margin: 0 auto; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h2   { color: #1a1a2e; margin-top: 0; }
    p    { color: #4a4a6a; line-height: 1.6; }
    .btn { display: inline-block; padding: 12px 28px; background: #4f46e5;
           color: #ffffff !important; text-decoration: none; border-radius: 6px;
           font-weight: 600; margin: 20px 0; }
    .note { font-size: 13px; color: #888; margin-top: 24px; }
    code  { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    ${bodyContent}
    <p class="note">Senior Project Management System</p>
  </div>
</body>
</html>`;

const templates = {
  verification: (verifyUrl, token) => ({
    subject: 'Verify your email address',
    text: [
      'Please verify your email address to continue setting up your account.',
      '',
      `Verification link: ${verifyUrl}`,
      `Token: ${token}`,
      '',
      'This link expires in 24 hours.',
      'If you did not create this account, you can ignore this email.',
    ].join('\n'),
    html: baseHtml('Verify your email', `
      <h2>Verify your email address</h2>
      <p>Click the button below to verify your email and continue your account setup.</p>
      <a href="${verifyUrl}" class="btn">Verify Email</a>
      <p>Or copy this link into your browser:<br/><code>${verifyUrl}</code></p>
      <p><strong>This link expires in 24 hours.</strong></p>
      <p class="note">If you did not create an account, you can safely ignore this email.</p>
    `),
  }),

  passwordReset: (resetUrl) => ({
    subject: 'Reset your password',
    text: [
      'You requested a password reset for your Senior Project Management System account.',
      '',
      `Reset link: ${resetUrl}`,
      '',
      'This link expires in 15 minutes.',
      'If you did not request a password reset, please ignore this email — your password has not changed.',
    ].join('\n'),
    html: baseHtml('Reset your password', `
      <h2>Reset your password</h2>
      <p>We received a request to reset your password. Click the button below to choose a new one.</p>
      <a href="${resetUrl}" class="btn">Reset Password</a>
      <p>Or copy this link into your browser:<br/><code>${resetUrl}</code></p>
      <p><strong>This link expires in 15 minutes.</strong></p>
      <p class="note">
        If you did not request a password reset, ignore this email — your password has not changed.
      </p>
    `),
  }),

  accountReady: {
    student: () => ({
      subject: 'Your student account is ready!',
      text: 'Your student account has been activated. You can now log in and access the Senior Project Management System. Welcome aboard!',
      html: baseHtml('Your account is ready', `
        <h2>Welcome to the Senior Project Management System!</h2>
        <p>Your <strong>student</strong> account has been activated.</p>
        <p>You can now log in to manage your senior project, connect with advisors, and track your progress.</p>
      `),
    }),
    professor: () => ({
      subject: 'Your professor account is ready!',
      text: 'Your professor account has been activated. You can now access advisor features and review senior projects. Welcome!',
      html: baseHtml('Your account is ready', `
        <h2>Welcome to the Senior Project Management System!</h2>
        <p>Your <strong>professor</strong> account has been activated.</p>
        <p>You can now advise students, review project proposals, and manage your assigned projects.</p>
      `),
    }),
    admin: () => ({
      subject: 'Your admin account is ready',
      text: 'Your admin account has been activated. You have full system access. Welcome!',
      html: baseHtml('Your account is ready', `
        <h2>Welcome!</h2>
        <p>Your <strong>admin</strong> account is now active. You have full access to the system.</p>
      `),
    }),
    committee_member: () => ({
      subject: 'Your coordinator account is ready',
      text: 'Your coordinator account has been activated. You can now manage student onboarding. Welcome!',
      html: baseHtml('Your account is ready', `
        <h2>Welcome to the Senior Project Management System!</h2>
        <p>Your <strong>coordinator</strong> account has been activated.</p>
        <p>You can now manage student onboarding and oversee project registrations.</p>
      `),
    }),
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send email verification link (flow f13).
 *
 * @param {string} email    - Recipient email address
 * @param {string} token    - Plain verification token
 * @param {string} [userId] - User ID for delivery audit log
 * @returns {{ messageId, recipient, status, attempts }}
 */
const sendVerificationEmail = async (email, token, userId) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verifyUrl = `${frontendUrl}/onboarding?step=verify-email&token=${token}`;

  console.log('\n[EMAIL] ── Verification Email ──────────────────');
  console.log(`[EMAIL] To:    ${email}`);
  console.log(`[EMAIL] Token: ${token}`);
  console.log(`[EMAIL] URL:   ${verifyUrl}`);
  console.log('[EMAIL] ────────────────────────────────────────\n');

  const transporter = createTransporter();
  if (!transporter) {
    await logDelivery({ action: 'EMAIL_VERIFICATION_SENT', userId, email, extra: { mode: 'dev' } });
    return { messageId: 'dev-mode', recipient: email, status: 'sent', attempts: 0 };
  }

  const { subject, text, html } = templates.verification(verifyUrl, token);
  const result = await sendWithRetry(transporter, {
    from: `"Senior Project System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    text,
    html,
  });

  if (result.success) {
    await logDelivery({
      action: 'EMAIL_VERIFICATION_SENT',
      userId,
      email,
      extra: { messageId: result.messageId, attempts: result.attempts },
    });
    return { messageId: result.messageId, recipient: email, status: 'sent', attempts: result.attempts };
  }

  await logDelivery({
    action: 'EMAIL_DELIVERY_FAILED',
    userId,
    email,
    extra: { type: 'verification', error: result.error, attempts: result.attempts, permanent: result.permanent },
  });
  return { messageId: null, recipient: email, status: 'failed', attempts: result.attempts, permanent: result.permanent };
};

/**
 * Send password reset link (flow f20).
 *
 * @param {string} email    - Recipient email address
 * @param {string} token    - Plain reset token
 * @param {string} [userId] - User ID for delivery audit log
 * @returns {{ messageId, recipient, status, attempts }}
 */
const sendPasswordResetEmail = async (email, token, userId) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

  console.log('\n[EMAIL] ── Password Reset Email ─────────────────');
  console.log(`[EMAIL] To:    ${email}`);
  console.log(`[EMAIL] Token: ${token}`);
  console.log(`[EMAIL] URL:   ${resetUrl}`);
  console.log('[EMAIL] ────────────────────────────────────────\n');

  const transporter = createTransporter();
  if (!transporter) {
    await logDelivery({ action: 'EMAIL_PASSWORD_RESET_SENT', userId, email, extra: { mode: 'dev' } });
    return { messageId: 'dev-mode', recipient: email, status: 'sent', attempts: 0 };
  }

  const { subject, text, html } = templates.passwordReset(resetUrl);
  const result = await sendWithRetry(transporter, {
    from: `"Senior Project System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    text,
    html,
  });

  if (result.success) {
    await logDelivery({
      action: 'EMAIL_PASSWORD_RESET_SENT',
      userId,
      email,
      extra: { messageId: result.messageId, attempts: result.attempts },
    });
    return { messageId: result.messageId, recipient: email, status: 'sent', attempts: result.attempts };
  }

  await logDelivery({
    action: 'EMAIL_DELIVERY_FAILED',
    userId,
    email,
    extra: { type: 'password_reset', error: result.error, attempts: result.attempts, permanent: result.permanent },
  });
  return { messageId: null, recipient: email, status: 'failed', attempts: result.attempts, permanent: result.permanent };
};

/**
 * Send account-ready notification with role-specific content (flows f23/f24).
 *
 * @param {string} email    - Recipient email address
 * @param {string} role     - User role (student | professor | admin | committee_member)
 * @param {string} [userId] - User ID for delivery audit log
 * @returns {{ messageId, recipient, status, attempts }}
 */
const sendAccountReadyEmail = async (email, role, userId) => {
  const templateFn = templates.accountReady[role] || templates.accountReady.student;
  const { subject, text, html } = templateFn();

  console.log('\n[EMAIL] ── Account Ready Email ─────────────────');
  console.log(`[EMAIL] To:      ${email}`);
  console.log(`[EMAIL] Role:    ${role}`);
  console.log(`[EMAIL] Subject: ${subject}`);
  console.log('[EMAIL] ────────────────────────────────────────\n');

  const transporter = createTransporter();
  if (!transporter) {
    await logDelivery({ action: 'EMAIL_ACCOUNT_READY_SENT', userId, email, extra: { role, mode: 'dev' } });
    return { messageId: 'dev-mode', recipient: email, status: 'sent', attempts: 0 };
  }

  const result = await sendWithRetry(transporter, {
    from: `"Senior Project System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    text,
    html,
  });

  if (result.success) {
    await logDelivery({
      action: 'EMAIL_ACCOUNT_READY_SENT',
      userId,
      email,
      extra: { role, messageId: result.messageId, attempts: result.attempts },
    });
    return { messageId: result.messageId, recipient: email, status: 'sent', attempts: result.attempts };
  }

  await logDelivery({
    action: 'EMAIL_DELIVERY_FAILED',
    userId,
    email,
    extra: { type: 'account_ready', role, error: result.error, attempts: result.attempts, permanent: result.permanent },
  });
  return { messageId: null, recipient: email, status: 'failed', attempts: result.attempts, permanent: result.permanent };
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountReadyEmail,
  // Exported for unit testing
  _internal: { sendWithRetry, isTransientError, isDevMode, createTransporter },
};
