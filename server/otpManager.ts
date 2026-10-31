import nodemailer from 'nodemailer';
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
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_ATTEMPTS = 5;
const MAX_IP_REQUESTS_PER_WINDOW = 10;
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

// Configure Gmail SMTP transporter
function getTransporter() {
  loadEnv();
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || 'daraluloom258@gmail.com').trim();
  const rawPass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || 'jtdjjxasqtswagnr';
  const pass = rawPass.replace(/\s+/g, '').trim();

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user,
      pass: pass,
    },
  });
}

// Generate styled English HTML email template with premium modern design
function createEmailTemplate(otp: string): string {
  const digits = (otp || '').split('');
  const digitCells = digits
    .map(
      (d) =>
        `<td style="width:48px;height:60px;background:#f0fdf4;border:2px solid #059669;border-radius:14px;font-size:32px;font-weight:800;color:#065f46;text-align:center;font-family:'Segoe UI',Roboto,Helvetica,Arial,monospace;line-height:60px;box-shadow:0 3px 8px rgba(5,150,105,0.12);letter-spacing:1px;">${d}</td>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Dar Al Uloom — Verification Code</title>
</head>
<body style="margin:0;padding:32px 14px;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;direction:ltr;text-align:left;">
  
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,0.08);border:1px solid #e5e7eb;">
    
    <!-- Top Header Banner -->
    <div style="background:linear-gradient(135deg,#064e3b 0%,#047857 55%,#0d9488 100%);padding:38px 28px;text-align:center;">
      <div style="display:inline-block;padding:5px 16px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);border-radius:999px;margin-bottom:14px;">
        <span style="color:#d1fae5;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Official Verification</span>
      </div>
      <h1 style="color:#ffffff;margin:0;font-size:30px;font-weight:900;letter-spacing:0.5px;">DAR AL ULOOM</h1>
      <p style="color:#a7f3d0;margin:8px 0 0;font-size:14px;font-weight:500;">Light of Knowledge &amp; Learning</p>
    </div>

    <!-- Gold Accent Divider -->
    <div style="height:4px;background:linear-gradient(90deg,#d97706,#f59e0b,#fbbf24,#f59e0b,#d97706);"></div>

    <!-- Main Content Card -->
    <div style="padding:36px 30px;text-align:center;">
      
      <h2 style="margin:0 0 14px;color:#064e3b;font-size:22px;font-weight:800;letter-spacing:-0.2px;">Verify Your Email Address</h2>
      
      <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.7;">
        Hello,<br>
        Please use the 6-digit verification code below to verify your email address and secure your account on <strong>Dar Al Uloom</strong>:
      </p>

      <!-- 6-Digit Verification Code Table -->
      <table align="center" border="0" cellpadding="0" cellspacing="8" dir="ltr" style="margin:20px auto 28px auto;">
        <tr>
          ${digitCells}
        </tr>
      </table>

      <!-- Security & Expiration Info Box -->
      <div style="background-color:#f0fdf4;border-radius:16px;padding:18px 20px;border:1px solid #bbf7d0;text-align:left;margin-top:20px;">
        <div style="display:flex;align-items:flex-start;margin-bottom:10px;">
          <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;">
            ⏱ <strong>Expires in:</strong> This code is valid for <strong>10 minutes</strong> only from the time requested.
          </p>
        </div>
        <div>
          <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.6;">
            🔒 <strong>Security Notice:</strong> Never share this code with anyone. Dar Al Uloom will never ask you for this code.
          </p>
        </div>
      </div>

      <p style="margin:28px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
        If you did not request this verification code, you can safely ignore this email.
      </p>

    </div>

    <!-- Email Footer -->
    <div style="background-color:#fafafa;padding:22px 28px;text-align:center;border-top:1px solid #f1f5f9;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#064e3b;">
        Dar Al Uloom
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">
        Islamic Knowledge &amp; Research Platform
      </p>
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        &copy; 2026 Dar Al Uloom. All rights reserved.
      </p>
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

  // 3. Resend Cooldown Check (60 seconds)
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

  // 6. Send email via Gmail SMTP
  loadEnv();
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || 'daraluloom258@gmail.com').trim();
  const rawPass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || 'jtdjjxasqtswagnr';
  const pass = rawPass.replace(/\s+/g, '').trim();

  try {
    const transporter = getTransporter();
    const senderName = process.env.SENDER_NAME || 'Dar Al Uloom';
    const senderAddress = (process.env.SENDER_EMAIL || user).trim();

    await transporter.sendMail({
      from: `"${senderName}" <${senderAddress}>`,
      to: normalizedEmail,
      subject: `Dar Al Uloom — Your Verification Code: ${otpCode}`,
      text: [
        'Hello,',
        '',
        `Your verification code for Dar Al Uloom is: ${otpCode}`,
        '',
        'This code is valid for 10 minutes only.',
        'Security Notice: Never share this code with anyone.',
        '',
        'If you did not request this verification code, please ignore this email.',
        '',
        'Dar Al Uloom — Light of Knowledge & Learning',
        '© 2026 Dar Al Uloom. All rights reserved.',
      ].join('\n'),
      html: createEmailTemplate(otpCode),
    });

    console.log(`[OTP Service] Email successfully sent to ${normalizedEmail}`);
    return {
      status: 200,
      data: {
        success: true,
        message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني بنجاح',
      },
    };
  } catch (err: any) {
    console.error('[OTP Service] Failed to send email via Gmail SMTP:', err?.message);
    return {
      status: 500,
      data: {
        success: false,
        error: 'تعذر إرسال البريد الإلكتروني حالياً. يرجى التأكد من إعدادات كلمة مرور التطبيق (App Password).',
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
