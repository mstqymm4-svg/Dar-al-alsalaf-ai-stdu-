import nodemailer, { type Transporter } from 'nodemailer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Helper to ensure .env is parsed and loaded into process.env
function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let val = (match[2] || '').trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          process.env[key] = val;
        }
      }
    }
  } catch (err) {
    console.warn('[OTP Service] Error reading .env file:', err);
  }
}

// Initial load
loadEnv();

interface OtpRecord {
  hashedOtp: string;
  expiresAt: number;
  lastSentAt: number;
  attempts: number;
}

// In-memory store for OTP records: email -> OtpRecord
const otpStore = new Map<string, OtpRecord>();

// In-memory store for IP rate limiting: ip -> timestamps[]
const ipRequests = new Map<string, number[]>();

// Constants
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 15 * 1000; // 15 seconds
const MAX_ATTEMPTS = 5;
const MAX_IP_REQUESTS_PER_WINDOW = 50;
const IP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Clean up expired records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, record] of otpStore.entries()) {
    if (record.expiresAt < now) {
      otpStore.delete(email);
    }
  }
  for (const [ip, timestamps] of ipRequests.entries()) {
    const valid = timestamps.filter((t) => now - t < IP_WINDOW_MS);
    if (valid.length === 0) {
      ipRequests.delete(ip);
    } else {
      ipRequests.set(ip, valid);
    }
  }
}, 5 * 60 * 1000);

// Helper to hash an OTP
function hashOtp(email: string, otp: string): string {
  return crypto
    .createHash('sha256')
    .update(`${email.toLowerCase().trim()}:${otp}`)
    .digest('hex');
}

// Email format validator
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email.trim());
}

// IP rate limiter
export function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const history = ipRequests.get(ip) || [];
  const recent = history.filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= MAX_IP_REQUESTS_PER_WINDOW) {
    return false; // Rate limit exceeded
  }
  recent.push(now);
  ipRequests.set(ip, recent);
  return true;
}

const OFFICIAL_EMAIL = 'daraltawhid25@gmail.com';
const LEGACY_EMAILS = new Set(['daraluloom258@gmail.com']);

function normalizeSmtpEmail(raw?: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || LEGACY_EMAILS.has(trimmed.toLowerCase())) {
    return OFFICIAL_EMAIL;
  }
  return trimmed;
}

// Configure single Gmail SMTP transporter using daraltawhid25@gmail.com and process.env.SMTP_PASS
function getSmtpConfig() {
  loadEnv();
  const smtpUser = normalizeSmtpEmail(process.env.SMTP_USER);
  const smtpPass = (process.env.SMTP_PASS || '').replace(/\s+/g, '').trim();
  process.env.SMTP_USER = smtpUser;
  process.env.CONTACT_EMAIL = normalizeSmtpEmail(process.env.CONTACT_EMAIL);
  return { smtpUser, smtpPass };
}

let cachedTransporter: Transporter | null = null;
let cachedTransporterKey = '';

function getSingleTransporter() {
  const { smtpUser, smtpPass } = getSmtpConfig();
  if (!smtpUser || !smtpPass) {
    console.error(
      `[OTP Service] Missing required SMTP credentials: SMTP_USER=${smtpUser ? 'set' : 'MISSING'}, SMTP_PASS=${smtpPass ? 'set' : 'MISSING'}`
    );
    return { transporter: null, smtpUser, error: 'Missing SMTP_USER or SMTP_PASS in environment variables.' };
  }

  const key = `${smtpUser}:${smtpPass}`;
  if (!cachedTransporter || cachedTransporterKey !== key) {
    cachedTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    cachedTransporterKey = key;
  }

  return { transporter: cachedTransporter, smtpUser, error: null };
}

export function logSmtpStatusOnStart() {
  const { smtpUser, smtpPass } = getSmtpConfig();
  if (!smtpUser || !smtpPass) {
    console.error(
      `[OTP Service] Startup check FAILED — SMTP_USER: "${smtpUser || 'MISSING'}", SMTP_PASS: ${smtpPass ? 'PROVIDED' : 'MISSING'}`
    );
  } else {
    console.log(
      `[OTP Service] Startup check OK — Using SMTP_USER: ${smtpUser} (host: smtp.gmail.com, port: 465, secure: true)`
    );
  }
}

// Clean English HTML email template designed for high deliverability to Primary Inbox
function createEmailTemplate(otp: string): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DAR AL TAWHID</title>
</head>
<body style="margin:0;padding:24px 12px;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;direction:ltr;text-align:left;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#065f46;padding:24px 20px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;letter-spacing:0.5px;">DAR AL TAWHID</h1>
      <p style="color:#d1fae5;margin:6px 0 0;font-size:13px;">Islamic Knowledge &amp; Digital Library</p>
    </div>
    <div style="padding:28px 24px;text-align:center;">
      <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
        Assalamu Alaikum,<br>
        Welcome to <strong>DAR AL TAWHID</strong>. Here is your 6-digit code:
      </p>
      <div dir="ltr" style="font-size:34px;font-weight:800;letter-spacing:8px;color:#065f46;background:#f0fdf4;border:2px solid #059669;border-radius:12px;padding:16px 12px;margin:18px auto;max-width:260px;font-family:'Segoe UI',Roboto,Helvetica,Arial,monospace;">
        ${otp}
      </div>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
        This code is valid for <strong>10 minutes</strong>.
      </p>
    </div>
    <div style="background-color:#f9fafb;padding:16px 20px;text-align:center;border-top:1px solid #f3f4f6;font-size:12px;color:#6b7280;">
      <strong>DAR AL TAWHID</strong> &bull; daraltawhid25@gmail.com
    </div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business Logic Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates and sends OTP to the specified email
 */
export async function sendOtp(email: string, clientIp: string) {
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Validate email format
  if (!isValidEmail(normalizedEmail)) {
    return {
      status: 400,
      data: { success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' },
    };
  }

  // 2. IP Rate Limit
  if (!checkIpRateLimit(clientIp)) {
    return {
      status: 429,
      data: {
        success: false,
        error: 'تم تجاوز الحد المسموح من الطلبات، يرجى الانتظار والمحاولة لاحقاً.',
      },
    };
  }

  // 3. Resend Cooldown Check (15 seconds)
  const existingRecord = otpStore.get(normalizedEmail);
  const now = Date.now();
  if (existingRecord) {
    const elapsed = now - existingRecord.lastSentAt;
    if (elapsed < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      return {
        status: 429,
        data: {
          success: false,
          error: `يرجى الانتظار ${waitSeconds} ثانية قبل طلب رمز جديد.`,
          retryAfter: waitSeconds,
        },
      };
    }
  }

  // 4. Generate 6-digit cryptographic random OTP
  const randomNum = crypto.randomInt(100000, 999999);
  const otpCode = randomNum.toString();
  const hashedOtp = hashOtp(normalizedEmail, otpCode);

  // 5. Store hashed OTP with 10-minute expiry
  otpStore.set(normalizedEmail, {
    hashedOtp,
    expiresAt: now + OTP_EXPIRY_MS,
    lastSentAt: now,
    attempts: 0,
  });

  // 6. Send email via single SMTP transporter (SMTP_USER & SMTP_PASS)
  const { transporter, smtpUser } = getSingleTransporter();
  if (!transporter || !smtpUser) {
    otpStore.delete(normalizedEmail);
    return {
      status: 503,
      data: {
        success: false,
        error: 'إعدادات SMTP_USER و SMTP_PASS مطلوبة في الخادم لإرسال رمز التحقق.',
      },
    };
  }

  try {
    await transporter.sendMail({
      from: `"DAR AL TAWHID" <${smtpUser}>`,
      to: normalizedEmail,
      subject: `DAR AL TAWHID - Code: ${otpCode}`,
      text: [
        'Assalamu Alaikum,',
        '',
        `Welcome to DAR AL TAWHID. Here is your 6-digit code: ${otpCode}`,
        '',
        'This code is valid for 10 minutes.',
        '',
        'DAR AL TAWHID',
        'daraltawhid25@gmail.com',
      ].join('\n'),
      html: createEmailTemplate(otpCode),
    });

    console.log(`[OTP Service] Email successfully sent from ${smtpUser} to ${normalizedEmail}`);
    return {
      status: 200,
      data: {
        success: true,
        sender: smtpUser,
        message: `تم إرسال رمز التحقق بنجاح من ${smtpUser}`,
      },
    };
  } catch (err: any) {
    console.error('[OTP Service] Failed to send email via Gmail SMTP:', err?.message);
    return {
      status: 500,
      data: {
        success: false,
        error: `تعذر إرسال رمز التحقق من ${smtpUser}. تأكد من صحة SMTP_USER و SMTP_PASS.`,
        details: err?.message,
      },
    };
  }
}

/**
 * Verifies the provided OTP for the email
 */
export async function verifyOtp(email: string, otp: string) {
  const normalizedEmail = (email || '').toLowerCase().trim();
  const cleanedOtp = (otp || '').trim();

  // 1. Basic validation
  if (!isValidEmail(normalizedEmail)) {
    return {
      status: 400,
      data: { success: false, error: 'صيغة البريد الإلكتروني غير صحيحة' },
    };
  }

  if (!cleanedOtp || !/^\d{6}$/.test(cleanedOtp)) {
    return {
      status: 400,
      data: { success: false, error: 'يجب أن يتكون رمز التحقق من 6 أرقام' },
    };
  }

  // 2. Fetch record
  const record = otpStore.get(normalizedEmail);
  if (!record) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'لم يتم العثور على رمز تحقق لهذا البريد أو أنه منتهي الصلاحية. يرجى طلب رمز جديد.',
      },
    };
  }

  // 3. Expiration Check
  const now = Date.now();
  if (record.expiresAt < now) {
    otpStore.delete(normalizedEmail);
    return {
      status: 400,
      data: {
        success: false,
        error: 'انتهت صلاحية رمز التحقق (10 دقائق). يرجى طلب رمز جديد.',
      },
    };
  }

  // 4. Maximum attempts check
  if (record.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(normalizedEmail);
    return {
      status: 400,
      data: {
        success: false,
        error: 'تم تجاوز الحد الأقصى للمحاولات الخاطئة (5 محاولات). تم إلغاء الرمز، يرجى طلب رمز جديد.',
      },
    };
  }

  // 5. Compare Hash
  const incomingHash = hashOtp(normalizedEmail, cleanedOtp);
  if (incomingHash !== record.hashedOtp) {
    record.attempts += 1;
    const remaining = MAX_ATTEMPTS - record.attempts;

    if (remaining <= 0) {
      otpStore.delete(normalizedEmail);
      return {
        status: 400,
        data: {
          success: false,
          error: 'تم تجاوز الحد الأقصى للمحاولات الخاطئة. يرجى طلب رمز جديد.',
        },
      };
    }

    return {
      status: 400,
      data: {
        success: false,
        error: `رمز التحقق غير صحيح. المتبقي: ${remaining} ${remaining === 1 ? 'محاولة واحدة' : 'محاولات'}.`,
        remainingAttempts: remaining,
      },
    };
  }

  // 6. Success! Remove OTP so it cannot be reused
  otpStore.delete(normalizedEmail);

  return {
    status: 200,
    data: {
      success: true,
      message: 'تم التحقق من البريد الإلكتروني بنجاح ✓',
      email: normalizedEmail,
      verifiedAt: new Date().toISOString(),
    },
  };
}

/**
 * Sends user contact form submissions directly to DAR AL TAWHID official email
 */
export interface ContactMessagePayload {
  name: string;
  email: string;
  message: string;
  subject?: string;
}

export async function sendContactEmail(payload: ContactMessagePayload) {
  const { name, email, message, subject } = payload;
  const normalizedEmail = (email || '').toLowerCase().trim();
  const senderName = (name || 'مستخدم DAR AL TAWHID').trim();
  const bodyText = (message || '').trim();

  if (!bodyText || !normalizedEmail) {
    return {
      status: 400,
      data: { success: false, error: 'الاسم والبريد والرسالة حقول مطلوبة' },
    };
  }

  const { transporter, smtpUser } = getSingleTransporter();
  if (!transporter || !smtpUser) {
    return {
      status: 503,
      data: {
        success: false,
        error: 'تعذر إرسال الرسالة لأن إعدادات SMTP_USER و SMTP_PASS غير مضبوطة في الخادم.',
      },
    };
  }

  const officialRecipient = normalizeSmtpEmail(process.env.CONTACT_EMAIL || smtpUser);

  try {
    const mailSubject = subject || `[DAR AL TAWHID — رسالة تواصل جديدة]: ${senderName}`;

    await transporter.sendMail({
      from: `"DAR AL TAWHID" <${smtpUser}>`,
      replyTo: normalizedEmail,
      to: officialRecipient,
      subject: mailSubject,
      text: `رسالة تواصل جديدة من تطبيق DAR AL TAWHID:\n\nالاسم: ${senderName}\nالبريد: ${normalizedEmail}\n\nنص الرسالة:\n${bodyText}\n\n---\nتطبيق DAR AL TAWHID`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; direction: rtl; text-align: right; background-color: #f9fafb; padding: 24px;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <div style="background: linear-gradient(135deg, #064e3b, #047857); padding: 24px; color: #ffffff; text-align: center;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 800;">رسالة تواصل جديدة — DAR AL TAWHID</h2>
              <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">وصلت رسالة جديدة من أحد مستخدمي التطبيق عبر صفحة تواصل معنا</p>
            </div>
            <div style="padding: 24px;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
                <tr>
                  <td style="padding: 8px 0; color: #6b7280; width: 100px;"><strong>الاسم:</strong></td>
                  <td style="padding: 8px 0; color: #111827; font-weight: bold;">${senderName}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;"><strong>البريد:</strong></td>
                  <td style="padding: 8px 0; color: #047857;"><a href="mailto:${normalizedEmail}">${normalizedEmail}</a></td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #6b7280;"><strong>التاريخ:</strong></td>
                  <td style="padding: 8px 0; color: #374151;">${new Date().toLocaleString('ar-SA')}</td>
                </tr>
              </table>
              <div style="background: #f0fdf4; border-radius: 12px; padding: 18px; border: 1px solid #bbf7d0; border-right: 4px solid #059669;">
                <p style="margin: 0 0 8px; font-size: 13px; color: #065f46;"><strong>نص الرسالة:</strong></p>
                <p style="margin: 0; font-size: 15px; color: #1f2937; line-height: 1.8; white-space: pre-wrap;">${bodyText}</p>
              </div>
              <div style="margin-top: 24px; text-align: center;">
                <a href="mailto:${normalizedEmail}?subject=Re:%20DAR%20AL%20TAWHID" style="display: inline-block; background: #047857; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 13px; font-weight: bold;">الرد مباشرة على المرسل</a>
              </div>
            </div>
            <div style="background: #f9fafb; padding: 14px 24px; text-align: center; border-top: 1px solid #f3f4f6; font-size: 12px; color: #9ca3af;">
              تطبيق DAR AL TAWHID — منصة المعرفة والبحث الإسلامي
            </div>
          </div>
        </div>
      `,
    });

    console.log(`[Contact Service] Message from ${normalizedEmail} successfully delivered to ${officialRecipient}`);
    return {
      status: 200,
      data: {
        success: true,
        message: 'تم إرسال رسالتك بنجاح إلى إدارة تطبيق DAR AL TAWHID ✓',
      },
    };
  } catch (err: any) {
    console.error('[Contact Service] Failed to send contact email:', err?.message);
    return {
      status: 500,
      data: {
        success: false,
        error: 'تعذر إرسال الرسالة إلى بريد التطبيق حالياً. يرجى المحاولة لاحقاً أو مراسلتنا عبر الرابط المباشر.',
        details: err?.message,
      },
    };
  }
}

