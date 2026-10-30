# بناء تطبيق دار العلوم كملف AAB

## 1) انشر السيرفر أولًا
التطبيق يحتاج سيرفر لإرسال رمز OTP. انشر `server.ts` على استضافة Node (Render أو Railway...) بالأمر:

```
NODE_ENV=production npx tsx server.ts
```

وأضف متغيرات البيئة في الاستضافة (لا تضعها في التطبيق أبدًا):
`SMTP_HOST` و`SMTP_PORT` و`SMTP_USER` و`SMTP_PASS`
(إن استخدمت موقع ويب بجانب التطبيق: `ALLOWED_ORIGINS=https://موقعك`).

## 2) أنشئ مفتاح التوقيع (مرة واحدة فقط)
```
keytool -genkey -v -keystore release.keystore -alias daralulom -keyalg RSA -keysize 2048 -validity 10000
```
احفظ الملف وكلمة المرور في مكان آمن. إن ضاع لن تستطيع تحديث التطبيق على Google Play.
لا ترفع الملف إلى GitHub.

## 3) الطريقة أ: البناء التلقائي عبر GitHub Actions
في المستودع: Settings > Secrets and variables > Actions

**Secrets:**
- `KEYSTORE_BASE64`: ناتج الأمر `base64 -w0 release.keystore`
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS` (مثل daralulom)
- `KEY_PASSWORD`

**Variables:**
- `VITE_API_BASE_URL`: رابط السيرفر، بدون `/` في آخره
- `VITE_BASE44_APP_ID` و`VITE_BASE44_APP_BASE_URL`: القيم نفسها التي تستخدمها حاليًا

ثم Actions > Build signed AAB > Run workflow، وحمّل الملف من Artifacts.

## 3) الطريقة ب: على جهازك (Android Studio)
```
npm install
# ضع القيم في ملف .env.production ثم:
npm run build
npx cap sync android
npx cap open android
```
ثم Build > Generate Signed Bundle / APK > Android App Bundle.

## قبل كل تحديث جديد
ارفع `versionCode` (و`versionName`) في `android/app/build.gradle`.

## قبل أول رفع على Google Play
معرّف التطبيق الحالي `com.daralulom.app` (في `capacitor.config.json` و`android/app/build.gradle`).
غيّره الآن إن أردت معرّفًا آخر، فلا يمكن تغييره بعد النشر.
