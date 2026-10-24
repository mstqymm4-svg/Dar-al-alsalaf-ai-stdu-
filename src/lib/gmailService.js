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
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'consent' });

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory ONLY (never in localStorage or sessionStorage).
let cachedAccessToken = null;
let currentGoogleUser = null;
const authListeners = new Set();

function notifyListeners() {
  const snapshot = {
    user: currentGoogleUser,
    accessToken: cachedAccessToken,
    isAuthenticated: Boolean(currentGoogleUser && cachedAccessToken),
  };
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
  listener({
    user: currentGoogleUser,
    accessToken: cachedAccessToken,
    isAuthenticated: Boolean(currentGoogleUser && cachedAccessToken),
  });
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
      throw new Error('Failed to get access token from Firebase Auth');
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

async function gmailFetch(endpoint, options = {}) {
  const token = await getAccessToken();
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
    const err = new Error(errBody?.error?.message || 'Gmail authentication expired or insufficient permissions');
    err.code = res.status === 401 ? 'AUTH_REQUIRED' : 'PERMISSION_DENIED';
    throw err;
  }

  if (res.status === 204) {
    return null;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gmail API error (${res.status})`);
  }
  return data;
}

export async function fetchGmailProfile() {
  return gmailFetch('/profile');
}

export async function fetchGmailLabels() {
  const data = await gmailFetch('/labels');
  return data?.labels || [];
}

function decodeBase64Url(base64Url) {
  if (!base64Url) return '';
  try {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

export function encodeMimeMessage({ to, subject, body, fromName, fromEmail, cc, bcc }) {
  const utf8Subject = `=?utf-8?B?${btoa(
    Array.from(new TextEncoder().encode(subject || ''), (b) => String.fromCharCode(b)).join('')
  )}?=`;

  const headers = [];
  if (fromEmail) {
    headers.push(fromName ? `From: "${fromName}" <${fromEmail}>` : `From: ${fromEmail}`);
  }
  headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${utf8Subject}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 8bit');

  const rawMessage = `${headers.join('\r\n')}\r\n\r\n${body || ''}`;
  const bytes = new TextEncoder().encode(rawMessage);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function extractMessageBody(payload) {
  if (!payload) return { text: '', html: '' };

  let text = '';
  let html = '';

  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body?.data && !text) {
      text = decodeBase64Url(part.body.data);
    } else if (mime === 'text/html' && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  };

  walk(payload);

  if (!text && !html && payload.body?.data) {
    text = decodeBase64Url(payload.body.data);
  }

  return { text, html };
}

export function parseGmailMessage(msg) {
  if (!msg) return null;
  const headers = msg.payload?.headers || [];
  const getHeader = (name) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

  const { text, html } = extractMessageBody(msg.payload);
  const labelIds = msg.labelIds || [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    snippet: msg.snippet || '',
    internalDate: msg.internalDate ? Number(msg.internalDate) : Date.now(),
    subject: getHeader('Subject') || '(بدون عنوان)',
    from: getHeader('From') || '',
    to: getHeader('To') || '',
    date: getHeader('Date') || '',
    labelIds,
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isTrash: labelIds.includes('TRASH'),
    bodyText: text,
    bodyHtml: html,
  };
}

export async function fetchGmailMessageDetail(id) {
  const raw = await gmailFetch(`/messages/${encodeURIComponent(id)}?format=full`);
  return parseGmailMessage(raw);
}

export async function fetchGmailMessages({ maxResults = 15, q = '', labelIds = [] } = {}) {
  const params = new URLSearchParams();
  params.set('maxResults', String(maxResults));
  if (q && q.trim()) params.set('q', q.trim());
  labelIds.forEach((l) => {
    if (l) params.append('labelIds', l);
  });

  const listData = await gmailFetch(`/messages?${params.toString()}`);
  const items = listData?.messages || [];
  if (items.length === 0) return [];

  const details = await Promise.all(
    items.map((item) => fetchGmailMessageDetail(item.id).catch(() => null))
  );
  return details.filter(Boolean);
}

export async function sendGmailMessage({ to, subject, body, cc, bcc }) {
  const raw = encodeMimeMessage({
    to,
    subject,
    body,
    fromName: currentGoogleUser?.displayName || 'دار العلوم',
    fromEmail: currentGoogleUser?.email || '',
    cc,
    bcc,
  });

  return gmailFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
}

export async function createGmailDraft({ to, subject, body, cc, bcc }) {
  const raw = encodeMimeMessage({
    to,
    subject,
    body,
    fromName: currentGoogleUser?.displayName || 'دار العلوم',
    fromEmail: currentGoogleUser?.email || '',
    cc,
    bcc,
  });

  return gmailFetch('/drafts', {
    method: 'POST',
    body: JSON.stringify({
      message: { raw },
    }),
  });
}

export async function trashGmailMessage(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/trash`, {
    method: 'POST',
  });
}

export async function untrashGmailMessage(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/untrash`, {
    method: 'POST',
  });
}

export async function deleteGmailMessagePermanently(messageId) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  });
}

export async function modifyGmailMessageLabels(messageId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  return gmailFetch(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
  });
}
