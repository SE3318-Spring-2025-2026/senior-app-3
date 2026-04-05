/**
 * Email Service
 * In development: logs emails to console instead of sending.
 * In production: requires EMAIL_USER and EMAIL_PASSWORD in .env (nodemailer/gmail).
 */

const ROLE_TEMPLATES = {
  student: (email) => ({
    subject: 'Your student account is ready!',
    text: `Hi ${email},\n\nYour student account has been activated. You can now log in and access the Senior Project Management System.\n\nWelcome aboard!`,
    html: `<h2>Welcome!</h2><p>Your <strong>student</strong> account is now active. Log in to get started with your senior project.</p>`,
  }),
  professor: (email) => ({
    subject: 'Your professor account is ready!',
    text: `Hi ${email},\n\nYour professor account has been activated. You can now access advisor features.\n\nWelcome!`,
    html: `<h2>Welcome!</h2><p>Your <strong>professor</strong> account is now active. You can now advise and review senior projects.</p>`,
  }),
  admin: (email) => ({
    subject: 'Your admin account is ready',
    text: `Hi ${email},\n\nYour admin account is active. You have full system access.\n\nWelcome!`,
    html: `<h2>Welcome!</h2><p>Your <strong>admin</strong> account is now active.</p>`,
  }),
  committee_member: (email) => ({
    subject: 'Your coordinator account is ready',
    text: `Hi ${email},\n\nYour coordinator account is active. You can now manage student onboarding.\n\nWelcome!`,
    html: `<h2>Welcome!</h2><p>Your <strong>coordinator</strong> account is now active.</p>`,
  }),
};

const isDev = () =>
  process.env.NODE_ENV !== 'production' ||
  !process.env.EMAIL_USER ||
  process.env.EMAIL_USER === 'your-email@gmail.com';

const getTransporter = () => {
  if (isDev()) return null;
  try {
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
  } catch {
    return null;
  }
};

/**
 * Send email verification link to user.
 * In dev mode: logs the token to the console.
 */
const sendVerificationEmail = async (email, token) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verifyUrl = `${frontendUrl}/onboarding?step=verify-email&token=${token}`;

  console.log('\n[EMAIL] ── Verification Email ──────────────────');
  console.log(`[EMAIL] To:    ${email}`);
  console.log(`[EMAIL] Token: ${token}`);
  console.log(`[EMAIL] URL:   ${verifyUrl}`);
  console.log('[EMAIL] ────────────────────────────────────────\n');

  const transporter = getTransporter();
  if (!transporter) {
    return { messageId: 'dev-mode', recipient: email, status: 'sent' };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify your email address',
      text: `Verify your email: ${verifyUrl}`,
      html: `<p>Click to verify your email: <a href="${verifyUrl}">Verify Email</a></p><p>Token: <code>${token}</code></p>`,
    });
    return { messageId: info.messageId, recipient: email, status: 'sent' };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return { messageId: null, recipient: email, status: 'failed' };
  }
};

/**
 * Send "account ready" email with role-specific content.
 */
const sendAccountReadyEmail = async (email, role) => {
  const template = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.student;
  const { subject, text, html } = template(email);

  console.log('\n[EMAIL] ── Account Ready Email ─────────────────');
  console.log(`[EMAIL] To:      ${email}`);
  console.log(`[EMAIL] Role:    ${role}`);
  console.log(`[EMAIL] Subject: ${subject}`);
  console.log('[EMAIL] ────────────────────────────────────────\n');

  const transporter = getTransporter();
  if (!transporter) {
    return { messageId: 'dev-mode', recipient: email, status: 'sent' };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject,
      text,
      html,
    });
    return { messageId: info.messageId, recipient: email, status: 'sent' };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return { messageId: null, recipient: email, status: 'failed' };
  }
};

/**
 * Send password reset link to user.
 * In dev mode: logs the token to the console.
 */
const sendPasswordResetEmail = async (email, token) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

  console.log('\n[EMAIL] ── Password Reset Email ─────────────────');
  console.log(`[EMAIL] To:    ${email}`);
  console.log(`[EMAIL] Token: ${token}`);
  console.log(`[EMAIL] URL:   ${resetUrl}`);
  console.log('[EMAIL] ────────────────────────────────────────\n');

  const transporter = getTransporter();
  if (!transporter) {
    return { messageId: 'dev-mode', recipient: email, status: 'sent' };
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Reset your password',
      text: `Reset your password: ${resetUrl}\n\nThis link expires in 15 minutes. If you did not request this, ignore this email.`,
      html: `<p>Click to reset your password: <a href="${resetUrl}">Reset Password</a></p><p>This link expires in <strong>15 minutes</strong>. If you did not request a password reset, please ignore this email.</p>`,
    });
    return { messageId: info.messageId, recipient: email, status: 'sent' };
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return { messageId: null, recipient: email, status: 'failed' };
  }
};

module.exports = { sendVerificationEmail, sendAccountReadyEmail, sendPasswordResetEmail };
