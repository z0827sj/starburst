import nodemailer from 'nodemailer';
import type { Burst } from './database';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !NOTIFY_EMAIL) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendNotification(burst: Burst): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;

  const emoji = burst.star_count > 100 ? '🚀' : burst.star_count > 50 ? '🔥' : '⭐';
  const subject = `${emoji} Star Burst: ${burst.repo_name} (+${burst.star_count} in ${burst.window_minutes}min)`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0c0c14; color: #e0e0e0; border-radius: 12px; overflow: hidden; border: 1px solid #27272a;">
      <div style="background: linear-gradient(135deg, #8b5cf6, #06b6d4); padding: 24px; text-align: center;">
        <h1 style="margin: 0; color: #fff; font-size: 24px;">✦ StarBurst Alert</h1>
      </div>
      <div style="padding: 24px;">
        <h2 style="margin: 0 0 8px; color: #fafafa;">
          <a href="${burst.repo_url}" style="color: #8b5cf6; text-decoration: none;">${burst.repo_name}</a>
        </h2>
        <p style="font-size: 36px; font-weight: 800; margin: 16px 0; background: linear-gradient(135deg, #f59e0b, #ef4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
          +${burst.star_count} stars
        </p>
        <p style="color: #a1a1aa; margin: 4px 0;">
          in ${burst.window_minutes} minutes · ${burst.burst_ratio || burst.star_count}x vs baseline
        </p>
        <p style="color: #71717a; margin: 16px 0 0; font-size: 14px;">
          ${burst.description}
        </p>
        <a href="${burst.repo_url}" style="display: inline-block; margin-top: 16px; padding: 10px 24px; background: #8b5cf6; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">
          View on GitHub
        </a>
      </div>
    </div>
  `;

  try {
    await t.sendMail({
      from: SMTP_USER,
      to: NOTIFY_EMAIL,
      subject,
      html,
    });
    console.log(`  📧 Notification sent for ${burst.repo_name}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to send notification:`, error);
    return false;
  }
}
