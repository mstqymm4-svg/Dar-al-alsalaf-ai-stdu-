import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
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
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.addScope('https://www.googleapis.com/auth/gmail.send');
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
  return () => { authListeners.delete(listener); };
};

function createCodedError(message, code) {
  /** @type {Error & { code?: string }} */
  const err = new Error(message);
  err.code = code;
  return err;
}

function isEmbeddedNativeWebView() {
  if (typeof window === 'undefined') return false;
  try {
    if (/** @type {any} */ (window).Capacitor?.isNativePlatform?.()) return true;
    const { protocol, hostname, port } = window.location || {};
    if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') return true;
    if (hostname === 'localhost' && !port) return true;
    const ua = navigator.userAgent || '';
    if (/;\s*wv\)/i.test(ua)) return true;
  } catch {
    // ignore
  }
  return false;
}

// Initialize auth state listener. Call this on app load.
export const initAuth = (onAuthSuccess, onAuthFailure) => {
  getRedirectResult(auth)
    .then((result) => {
      if (result) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          cachedAccessToken = credential.accessToken;
        }
        currentGoogleUser = result.user;
        notifyListeners();
        if (cachedAccessToken && onAuthSuccess) {
          onAuthSuccess(result.user, cachedAccessToken);
        }
      }
    })
    .catch(() => {
      // ignore redirect errors on boot
    });

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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw createCodedError(
      'لا يوجد اتصال بالإنترنت حالياً. يرجى التحقق من الشبكة والمحاولة مرة أخرى.',
      'NETWORK_ERROR'
    );
  }

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw createCodedError(
        'تعذر الحصول على صلاحية الوصول من حساب Google',
        'TOKEN_MISSING'
      );
    }

    cachedAccessToken = credential.accessToken;
    currentGoogleUser = result.user;
    notifyListeners();
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    const code = error?.code || '';
    const msg = String(error?.message || '');
    const inWebView = isEmbeddedNativeWebView();
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;

    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw createCodedError(
        'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.',
        'POPUP_CLOSED'
      );
    }

    // Standard mobile browser blocked popup -> retry with redirect outside WebView/iframe
    if (
      !inWebView &&
      !inIframe &&
      (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment')
    ) {
      try {
        await signInWithRedirect(auth, provider);
        return null;
      } catch {
        throw createCodedError(
          'تعذر فتح نافذة تسجيل الدخول. يرجى السماح بالنوافذ المنبثقة أو استخدام رمز التحقق (OTP).',
          'POPUP_BLOCKED'
        );
      }
    }

    if (code === 'auth/network-request-failed' || code === 'NETWORK_ERROR') {
      throw createCodedError(
        'تعذر الاتصال بخادم مصادقة Google. تحقق من اتصال الإنترنت أو استخدم تسجيل الدخول برمز التحقق (OTP).',
        'NETWORK_ERROR'
      );
    }

    if (
      inWebView ||
      code === 'auth/unauthorized-domain' ||
      code === 'auth/operation-not-supported-in-this-environment' ||
      msg.includes('disallowed_useragent')
    ) {
      throw createCodedError(
        'تسجيل الدخول عبر نافذة Google غير مدعوم في هذا المتصفح أو النطاق. يرجى استخدام التحقق بالبريد الإلكتروني (رمز OTP).',
        'WEBVIEW_GOOGLE_BLOCKED'
      );
    }

    throw createCodedError(
      'تعذر إتمام تسجيل الدخول عبر Google حالياً. يمكنك استخدام التحقق بالبريد الإلكتروني (رمز OTP).',
      code || 'AUTH_ERROR'
    );
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
    throw createCodedError('AUTH_REQUIRED', 'AUTH_REQUIRED');
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
    throw createCodedError(
      errBody?.error?.message || 'انتهت صلاحية الجلسة أو لا توجد صلاحية كافية لإرسال البريد عبر Gmail',
      res.status === 401 ? 'AUTH_REQUIRED' : 'PERMISSION_DENIED'
    );
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

export async function sendGmailMessage({ to, subject, body, html, cc = undefined, bcc = undefined, token = null }) {
  const raw = encodeMimeMessage({
    to,
    subject,
    body,
    html,
    fromName: currentGoogleUser?.displayName || 'DAR AL TAWHID',
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
  let token = cachedAccessToken;
  if (!token) {
    const authRes = await googleSignIn();
    token = authRes?.accessToken;
  }
  if (!token) {
    throw createCodedError('يرجى تسجيل الدخول بحساب Google لإرسال رمز التحقق', 'AUTH_REQUIRED');
  }

  const appLogoUrl =
    'https://media.base44.com/images/public/69c8e483a69a0d215eee4ef7/d46293c8d_C06AC024-1230-4B65-91B9-B30DDE077171.png';
  const subject = `DAR AL TAWHID - Code: ${code}`;
  const plain = [
    'Verify your email address',
    '',
    `Use this code to complete setting up and verifying ${recipientEmail} on DAR AL TAWHID:`,
    '',
    code,
    '',
    'This code will expire in 10 minutes.',
    '',
    "If you don't recognize DAR AL TAWHID, you can safely ignore this email.",
  ].join('\n');

  const html = `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head>
  <meta charset="utf-8">
  <title>DAR AL TAWHID</title>
</head>
<body style="margin:0;padding:0;direction:ltr;text-align:left;">
  <table width="100%" height="100%" style="min-width:348px;" border="0" cellspacing="0" cellpadding="0" lang="en">
    <tbody>
      <tr height="32" style="height:32px;"><td></td></tr>
      <tr align="center">
        <td>
          <table border="0" cellspacing="0" cellpadding="0" style="padding-bottom:20px;max-width:516px;min-width:220px;">
            <tbody>
              <tr>
                <td width="8" style="width:8px;"></td>
                <td>
                  <div style="border-style:solid;border-width:thin;border-color:#dadce0;border-radius:8px;padding:40px 20px;" align="center">
                    <img src="${appLogoUrl}" width="68" height="68" aria-hidden="true" style="margin-bottom:16px;display:block;width:68px;height:68px;object-fit:contain;" alt="DAR AL TAWHID">
                    <div style="font-family:'Google Sans',Roboto,RobotoDraft,Helvetica,Arial,sans-serif;border-bottom:thin solid #dadce0;color:rgba(0,0,0,0.87);line-height:32px;padding-bottom:24px;text-align:center;word-break:break-word;">
                      <div style="font-size:24px;">Verify your email address</div>
                    </div>
                    <div style="font-family:Roboto-Regular,Helvetica,Arial,sans-serif;font-size:14px;color:rgba(0,0,0,0.87);line-height:20px;padding-top:20px;text-align:left;">
                      Use this code to complete setting up and verifying <b>${recipientEmail}</b> on <b>DAR AL TAWHID</b>:
                      <div style="text-align:center;font-size:36px;margin-top:20px;line-height:44px;">${code}</div>
                      <br>
                      This code will expire in 10 minutes.
                      <br><br>
                      If you don't recognize <b>DAR AL TAWHID</b>, you can safely ignore this email.
                    </div>
                  </div>
                </td>
                <td width="8" style="width:8px;"></td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>
      <tr height="32" style="height:32px;"><td></td></tr>
    </tbody>
  </table>
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
