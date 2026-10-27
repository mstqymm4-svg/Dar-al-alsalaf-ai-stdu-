import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
  'https://www.googleapis.com/auth/gmail.addons.current.message.action',
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.insert',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Filter out Workspace Add-on manifest-only scopes (.addons.current.) and conflicting
// metadata/admin-only scopes when building the web OAuth popup request so Google OAuth
// does not reject the popup with Error 400: invalid_scope.
SCOPES.filter(
  (scope) =>
    !scope.includes('.addons.current.') &&
    !scope.includes('.settings.') &&
    !scope.endsWith('/gmail.metadata')
).forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory ONLY (never in localStorage or sessionStorage).
let cachedAccessToken = null;
let currentGoogleUser = null;
const authListeners = new Set();

function getSnapshot() {
  const isAuthenticated = Boolean(currentGoogleUser && cachedAccessToken);
  return {
    user: currentGoogleUser,
    accessToken: cachedAccessToken,
    isAuthenticated,
    hasToken: isAuthenticated,
  };
}

function notifyListeners() {
  const snapshot = getSnapshot();
  authListeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // ignore listener errors
    }
  });
}

export const subscribeToGmailAuth = (listener) => {
  authListeners.add(listener);
  listener(getSnapshot());
  return () => authListeners.delete(listener);
};

// Initialize auth state listener. Call this on app load.
export const initAuth = (onAuthSuccess, onAuthFailure) => {
  return onAuthStateChanged(auth, async (user) => {
    currentGoogleUser = user;
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
    notifyListeners();
  });
};

// Must be called from a button click or user interaction
export const googleSignIn = async () => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('تعذر الحصول على صلاحية الوصول إلى Gmail من حساب Google');
    }

    cachedAccessToken = credential.accessToken;
    currentGoogleUser = result.user;
    notifyListeners();
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async () => {
  return cachedAccessToken;
};

export const hasCachedAccessToken = () => {
  return Boolean(cachedAccessToken);
};

export const getCurrentGoogleUser = () => {
  return currentGoogleUser;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  currentGoogleUser = null;
  notifyListeners();
};

// ─── Gmail REST API Helpers ───────────────────────────────────────────────────
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailFetch(endpoint, options = {}, explicitToken = null) {
  const token = explicitToken || cachedAccessToken;
  if (!token) {
    const err = new Error('AUTH_REQUIRED');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${GMAIL_API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) {
      cachedAccessToken = null;
      notifyListeners();
    }
    const errBody = await res.json().catch(() => ({}));
    const err = new Error(
      errBody?.error?.message || 'انتهت صلاحية الجلسة أو لا توجد صلاحية كافية لإرسال البريد عبر Gmail'
    );
    err.code = res.status === 401 ? 'AUTH_REQUIRED' : 'PERMISSION_DENIED';
    throw err;
  }

  if (res.status === 204) {
    return null;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `خطأ في خدمة Gmail (${res.status})`);
  }
  return data;
}

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str || '');
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function wrapBase64Lines(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

export function encodeMimeMessage({ to, subject, body, html, fromName, fromEmail, cc, bcc }) {
  const utf8Subject = `=?utf-8?B?${toBase64Utf8(subject || '')}?=`;
  const encodedFromName = fromName ? `=?utf-8?B?${toBase64Utf8(fromName)}?=` : '';

  const headers = [];
  if (fromEmail) {
    headers.push(encodedFromName ? `From: ${encodedFromName} <${fromEmail}>` : `From: ${fromEmail}`);
  }
  headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${utf8Subject}`);
  headers.push('MIME-Version: 1.0');

  let rawMessage = '';
  if (html) {
    const boundary = `dau_boundary_${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64Lines(toBase64Utf8(body || '')),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64Lines(toBase64Utf8(html)),
      `--${boundary}--`,
    ];
    rawMessage = `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: base64');
    rawMessage = `${headers.join('\r\n')}\r\n\r\n${wrapBase64Lines(toBase64Utf8(body || ''))}`;
  }

  return toBase64Utf8(rawMessage).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendGmailMessage({ to, subject, body, html, cc, bcc, token = null }) {
  const raw = encodeMimeMessage({
    to,
    subject,
    body,
    html,
    fromName: currentGoogleUser?.displayName || 'دار العلوم | Dar Al Uloom',
    fromEmail: currentGoogleUser?.email || '',
    cc,
    bcc,
  });

  return gmailFetch(
    '/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({ raw }),
    },
    token
  );
}

export async function sendVerificationEmailViaGmail(recipientEmail, code) {
  // Check cachedAccessToken synchronously so signInWithPopup is invoked directly
  // within the user's click gesture without any preceding await.
  let token = cachedAccessToken;
  if (!token) {
    const authRes = await googleSignIn();
    token = authRes?.accessToken;
  }
  if (!token) {
    const err = new Error('يرجى تسجيل الدخول بحساب Google لإرسال رمز التحقق');
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  const subject = 'رمز التحقق — دار العلوم | Verification code';
  const plain = [
    'السلام عليكم ورحمة الله وبركاته',
    '',
    'رمز التحقق الخاص بك هو:',
    '',
    code,
    '',
    'الرمز صالح لمدة 10 دقائق. لا تشاركه مع أحد.',
    '',
    '---',
    '',
    'Your verification code is: ' + code,
    'Valid for 10 minutes. Do not share it with anyone.',
    '',
    'دار العلوم | Dar Al Uloom',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<body style="margin:0;padding:24px;background:#f7f5f0;font-family:Tahoma,Arial,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8e2d5;">
    <div style="background:linear-gradient(135deg,#1c5c46,#2e7d5b);padding:24px;text-align:center;">
      <h1 style="color:#fdfaf2;margin:0;font-size:20px;">دار العلوم</h1>
      <p style="color:#cfe6d9;margin:6px 0 0;font-size:13px;">رمز التحقق من البريد الإلكتروني</p>
    </div>
    <div style="padding:28px 24px;color:#24312b;font-size:14px;line-height:2;text-align:center;">
      <p style="margin:0 0 16px;">رمز التحقق الخاص بك هو:</p>
      <div dir="ltr" style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#1c5c46;background:#f7f5f0;border:1px solid #e8e2d5;border-radius:8px;padding:14px 0;margin:0 0 16px;">${code}</div>
      <p style="margin:0 0 8px;color:#4a6357;font-size:13px;">الرمز صالح لمدة 10 دقائق، ولا تشاركه مع أحد.</p>
      <p dir="ltr" style="margin:16px 0 0;color:#7a8a82;font-size:12px;">Your code is valid for 10 minutes. Do not share it with anyone.</p>
    </div>
  </div>
</body>
</html>`;

  return sendGmailMessage({
    to: recipientEmail,
    subject,
    body: plain,
    html,
    token,
  });
}
