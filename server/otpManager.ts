import nodemailer from 'nodemailer';
import crypto from 'crypto';

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
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS
    requireTLS: true,
    auth: {
      user: user || '',
      pass: pass || '',
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

// Generate styled Arabic HTML email template
function createEmailTemplate(otp: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>رمز التحقق — دار العلوم</title>
</head>
<body style="margin:0;padding:24px;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e5e7eb;">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1c5c46 0%,#2d7a5e 100%);padding:32px 24px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:bold;letter-spacing:0.5px;">دار العلوم</h1>
      <p style="color:#d1fae5;margin:8px 0 0;font-size:14px;">رمز التحقق من البريد الإلكتروني</p>
    </div>

    <!-- Content -->
    <div style="padding:32px 28px;text-align:center;">
      <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
        السلام عليكم ورحمة الله وبركاته،<br>
        استخدم رمز التحقق التالي لتأكيد حسابك في تطبيق <strong>دار العلوم</strong>:
      </p>

      <!-- OTP Box -->
      <div style="margin:28px 0;padding:18px 24px;background-color:#f0fdf4;border:2px dashed #10b981;border-radius:12px;display:inline-block;">
        <span dir="ltr" style="font-size:36px;font-weight:900;letter-spacing:10px;color:#047857;font-family:Consolas,monaco,monospace;display:block;">
          ${otp}
        </span>
      </div>

      <!-- Info & Warnings -->
      <div style="background-color:#f9fafb;border-radius:10px;padding:16px;margin:20px 0 0;border:1px solid #e5e7eb;text-align:right;">
        <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">
          ⏳ <strong>الصلاحية:</strong> هذا الرمز صالح لمدة <strong>10 دقائق</strong> فقط.
        </p>
        <p style="margin:0;font-size:13px;color:#dc2626;">
          🔒 <strong>تنبيه أمني:</strong> لا تشارك هذا الرمز مع أي شخص حفاظاً على أمان حسابك.
        </p>
      </div>

      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
        إذا لم تكن قد طلبت هذا الرمز، يمكنك تجاهل هذه الرسالة بأمان.
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">
        © دار العلوم — جميع الحقوق محفوظة
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
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn(
      `[OTP Service] GMAIL_USER or GMAIL_APP_PASSWORD is not set in environment variables!`
    );
    console.log(
      `[OTP Simulation for Testing] Email: ${normalizedEmail} | OTP Code: ${otpCode}`
    );
    return {
      status: 200,
      data: {
        success: true,
        message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني بنجاح (وضع الاختبار)',
        simulated: true,
      },
    };
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"دار العلوم" <${user}>`,
      to: normalizedEmail,
      subject: 'رمز التحقق — دار العلوم',
      text: `رمز التحقق الخاص بك لتطبيق دار العلوم هو: ${otpCode} (صالح لمدة 10 دقائق)`,
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
