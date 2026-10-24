# Dar-ul-Uloom (دار العلوم): Independent Backend and Android Migration Plan

Dar-ul-Uloom is an Arabic-first (RTL) Islamic digital library of books, PDFs, videos and YouTube channels. It currently runs on Base44 (repository: DAR-AS-SALAF).
This plan moves the library onto a backend, database and file storage that the owner controls, keeps the existing React interface unchanged, and publishes it on Google Play as a Capacitor Android app whose content updates without app releases.

---

## Who it's for

- **Readers and viewers.** Arabic-speaking users (also Urdu, English and French) who browse, read PDFs offline, save favourites, continue where they stopped, and watch lessons and live streams.
- **Library administrators.** They publish, edit, unpublish and delete books, PDFs, images, uploaded videos, YouTube links and channels from a dashboard, without touching code.
- **The owner/operator.** Owns every account, credential, bill and backup. No step depends on Base44 or Emergent once the migration is finished.

---

## What the repository shows today (verified, not assumed)

| Earlier audit claim | Verified result |
|---|---|
| React 18 + Vite 6 + Tailwind, JSX | Confirmed. `vite.config.js` also loads `@base44/vite-plugin`, which adds an analytics tracker and a visual-edit agent. |
| PWA + offline reading | Confirmed: `public/sw.js`, `src/lib/offlineDB.js`, `offlineSync.js`, `contentSyncEngine.js`. The sync engine checks for changes every 5 minutes, downloads only changed items, deletes removed ones and never touches favourites or reading position. This is reused as is. |
| Express/TS/Prisma backend split between `backend/` and `src/backend/` | Confirmed, and it is **broken today**. `backend/src/app.ts` imports 12 route groups, but `backend/src/routes/` contains only `auth` and `health`. The other 10 (books, authors, categories, favourites, settings, social channels, uploads, users, videos, video channels) are in `src/backend/src/routes/`. As a result the backend cannot compile. |
| Backend is incomplete | Confirmed. `package.json` lists `migrate-from-base44` and `seed` scripts whose files do not exist. There is no Prisma migrations folder, only `schema.prisma`. Uploads go to a local `uploads/` folder. The S3 driver is marked "TODO". |
| Partial API abstraction | Confirmed. `src/lib/dataSource.js` maps 8 entities to the new API behind the `VITE_USE_INDEPENDENT_API` flag (default off). Pages such as `Admin.jsx` still call `base44.entities.*` and `base44.integrations.Core.UploadFile` directly. |
| Base44 auth, entities, uploads, email, AI, functions | Confirmed. `AuthContext.jsx` relies fully on Base44 (hosted login redirect, public-settings check). There are 5 server functions (`deleteAccountRequest`, `fetchVideoMeta`, `gmailNotify`, `sendContactMessage`, `sendRegistrationVerification`) and a Gmail connector. `AISearch.jsx` is also present. |
| Base44 data model | 12 entities: AccountData, AppSettings, Book, BookTranslation, Favorite, SocialChannel, Translation, TranslationGlossary, TranslationLanguage, User, Video, VideoChannel. The Prisma schema covers 11. **AccountData is missing**, and there is **no reading-progress, YouTube-sync, live-status or publication-state model for videos**. |
| No Capacitor/Android project | Confirmed. There is no `android/` folder and no `capacitor.config`. |
| Hidden Base44 dependencies | The app icons in `public/manifest.json` load from `media.base44.com`. Uploaded files most likely use Base44 URLs too. These links may stop working once Base44 is cancelled. |
| **Repository is two-way synced with Base44** | The latest commits come from `base44-builder[bot]`, and the README says pushes are mirrored into the Base44 Builder. The live site `dar-as-salaf.vercel.app` is also built from this repository. **Pushing migration work to `main` could change the live Base44 app and the live website**, so all work happens on a separate branch. |
| Data backup in code | None. The repository holds no live records or media. The live database exists only in Base44. |

Data-quality issue already visible: the admin form saves language as Arabic words ("العربية", "اورد"), while the new schema expects codes (`ar`, `ur`). Categories are free text from a hard-coded list. The migration must map both.

---

## Core features and experience

**Kept exactly as they are**
- The current interface, Arabic RTL layout, branding (green `#0d3b2e`), fonts, loaders, splash screen, home channels and hero banner.
- The PDF reader (ProBookViewer / pdf.js), offline reading, favourites, reading progress, search, settings, contact page and the existing admin and developer panels (books, videos, channels, social links, branding, colours, fonts, backgrounds, users, backup).

**Dynamic content, no app update needed**
- The website and the installed Android app load all content from the new API. They keep checking for changes every 5 minutes while open, and also when the app returns to the foreground or comes back online.
- A new "changes since" endpoint sends only new, changed and removed items. This saves data and server cost.

**Admin content management**
- Every content type has the states **Draft → Published → Unpublished**, plus **Delete**. Deleted items go to a Trash with restore for 30 days, then are purged.
- Drafts and unpublished items never appear in public lists or files. All admin actions require the ADMIN or SUPER_ADMIN role and are recorded in an admin activity log (who did what, and when).
- Uploads go directly from the browser to file storage with a progress bar: PDFs, cover images and other images, and MP4 videos up to 2 GB.

**Two different kinds of video**

| | YouTube videos (links and synced channels) | Uploaded videos |
|---|---|---|
| Where the file lives | On YouTube; the library stores only metadata | MP4 file in the library's own Cloudflare R2 storage |
| Playback | Embedded YouTube player, with an "Open in YouTube" fallback | Built-in video player, one fixed quality |
| Cost | Free | Storage only (no download fees on R2) |
| Offline | Never (YouTube terms) | Not offline in this plan |

**Automatic YouTube channel sync**
- An admin adds a channel by URL, @handle or channel ID. The server resolves it once and stores the permanent channel ID.
- The server checks each channel's uploads every 15 minutes. Upcoming and live broadcasts are rechecked every 5 minutes, so they move from "upcoming" to "live" to "ended". Videos that are deleted or made private on YouTube are hidden automatically.
- Each YouTube video exists only once, even if it is found repeatedly or appears in several channels.
- Each channel has a switch for auto-publish (on by default) or review-first.
- The admin panel shows the last sync time, errors, a "Sync now" button and today's API quota use.
- The YouTube key stays on the server. The expensive search call is never used on the schedule. Sync stops at 80% of the daily quota.
- The current `fetchVideoMeta` function reads YouTube watch pages directly, which is fragile. It is replaced by the official API.

**Accounts**
- Sign-up and login with email and password, email verification, password reset and secure session refresh.
- Account deletion is available both inside the app and on a web page. Google Play requires both.
- New login, register and reset screens replace Base44's hosted login page. They reuse the existing `AuthLayout` design.

**What needs an app release and what does not**

| Change | New Android release? |
|---|---|
| New or edited books, PDFs, images, videos, YouTube channels, social links, categories | No |
| Branding colours, fonts, backgrounds and texts stored in settings | No |
| New YouTube uploads and live streams | No (automatic) |
| New screens, new features, bug fixes in app code, new native permissions, icon or splash changes | Yes |

---

## User flow

**Reader**
1. Opens the app. The splash screen shows, and the home page appears immediately from the offline copy.
2. Fresh content syncs quietly in the background.
3. Browses books by category, opens a book and reads the PDF. The reading position is saved on the device and, when signed in, on the server.
4. Saves the book offline and marks it as a favourite. Without internet, offline books, favourites and progress still work.
5. Opens Videos and sees live, upcoming and latest items from the configured channels plus uploaded lessons.

**Administrator**
1. Signs in on the website or in the app. The admin entry appears only for admin accounts.
2. Adds a book: title, author, category, cover upload and PDF upload. Saves it as Draft, previews it, then publishes.
3. Within about 5 minutes, open apps show the book. No app update is needed.
4. Adds a YouTube channel and chooses auto-publish. Its recent videos appear after the first sync, and new uploads and live streams follow automatically.
5. Unpublishes or deletes an item. It disappears from lists, and devices remove their offline copy at the next sync.

---

## UI/UX feel

- **Unchanged visual identity.** The existing RTL layout, palette, typography, shadcn/Tailwind components, loaders and animations stay as they are. Each migrated page is checked against "before" screenshots at phone size.
- **New screens** (login/register/reset, YouTube channel manager, Trash, content status badges, quota panel) are built from existing components so they look native to the app.
- **Android polish.** Icon and splash come from the current logo. The status bar uses the brand green. The hardware back button behaves correctly, safe areas are respected, and there is no web-style zoom in the reader.

---

## Hosting choice and recurring costs

**Options compared**

| Option | Approx. monthly | Strengths | Weaknesses |
|---|---|---|---|
| **Railway (API + PostgreSQL) + Cloudflare R2: chosen** | $8–15 (+R2) | Runs the existing Dockerfile, cheapest managed start, simple | Usage-based bill; Railway charges $0.05/GB for data sent out, so files must be served from R2, not through the API |
| Render + Render PostgreSQL + R2 | $13–26 | Flat, predictable | Higher base cost |
| Single VPS (Hetzner) + R2 | €5–10 | Cheapest at scale | Owner handles security updates, backups and uptime |
| Supabase + separate API host | $25+ | Built-in auth/storage | Overlaps the existing backend; more lock-in |
| Fly.io | $40+ | Global | Managed PostgreSQL starts around $38 |
| Emergent-managed hosting/database | — | — | Built for Expo/Python/MongoDB; would require rewriting the Express/Prisma/PostgreSQL backend. Not used. |

**Every recurring charge in the chosen setup**

| Service | Purpose | Cost |
|---|---|---|
| Railway Hobby | API, scheduler, PostgreSQL | $5/month minimum, which includes $5 of usage; expected $8–15/month |
| Railway staging environment | Testing during Stages 2–3 only | +$3–6/month while it exists |
| Cloudflare R2 | PDFs, images, MP4s, nightly backups | Free up to 10 GB; then $0.015/GB/month (100 GB ≈ $1.35; 500 GB ≈ $7.35); no download fees |
| Domain name | API and file addresses (R2's default address is not meant for production) | ~$10–15/year |
| Resend | Verification, password reset, contact-form emails | Free up to 3,000 emails/month |
| YouTube Data API | Channel sync | Free within 10,000 units/day |
| Vercel Hobby | The existing website | Free |
| GitHub Actions | Android builds | Free within the included minutes |
| Google Play developer account | Publishing | $25 one-time (likely already paid) |
| Base44 | Kept read-only as a fallback | Current plan, until 30 days after cutover, then cancelled with approval |
| **Total after cutover** | | **About $9–20/month plus the domain** |

**Vendor dependencies and portability.** PostgreSQL moves anywhere with a standard dump. R2 uses the S3 standard and can move to Backblaze or AWS. The API is a Docker image. Resend can be swapped for any SMTP service. Google (YouTube, Play) cannot be avoided for these features.

---

## Implementation phases

The seven requested phases are grouped into three stages. **Only Stage 1 is built after approval.** It runs entirely locally on a separate branch and does not touch production, live data, Base44 or the Play Console. Each later stage starts only after explicit approval.

### Stage 1: MVP (built now): Phases 1–3, local only

#### Phase 1: Protect the source code and assess the Android build and Play error
- **Work:**
  - Create a read-only snapshot tag, `pre-migration-snapshot`, and a full repository backup bundle.
  - Do all work on a new branch, `independent-migration`. Nothing is pushed to `main`, which syncs to Base44 and Vercel.
  - Write an inventory of every Base44 call, by file.
  - Inspect the supplied `.aab` and record:
    - package name, version code and name, minimum and target Android level
    - the signing certificate fingerprint
    - which tool produced it (Capacitor, a Trusted Web Activity from PWABuilder/Bubblewrap, a Base44 wrapper, or other)
    - whether it bundles the app or only loads a website
    - whether its web files match the current commit or the laptop source
  - Diagnose the upload error against known causes:
    - package name already taken or reserved
    - target level below Android 15 (API 35), or below API 36 for submissions after 31 Aug 2026
    - debug-signed bundle
    - wrong upload key
    - reused version code
    - missing store or policy items
    - the closed-test rule for new personal accounts (12 testers for 14 days)
- **Files:** no app code changes. New: `docs/migration/BASE44_INVENTORY.md`, `docs/migration/AAB_REPORT.md`.
- **Depends on:** nothing.
- **Acceptance:**
  - The snapshot exists.
  - The report states the package ID, certificate fingerprint, target level, the build's origin and the root cause of the error.
  - It recommends either reusing the existing identity or making a new build (no change without approval).
- **Risks and rollback:** The keystore is never requested. Only its fingerprint is needed. Read-only work, so nothing to roll back.
- **Needs from you:** the `.aab`, the exact error text or a screenshot, the laptop's Android project folder without keystore or passwords, and the Play account type.
- **Complexity / cost:** Low / $0.

#### Phase 2: Consolidate and repair the independent backend
- **Work:**
  - Move the misplaced half of the backend from `src/backend/src/` into `backend/src/` with history preserved.
  - Compare duplicate files one by one and keep the more complete version. Every decision is recorded.
  - After merging, remove the empty `src/backend/` folder so server code is never bundled into the app. Nothing is discarded: its contents now live in `backend/`.
  - Create the first database migration and add environment validation that stops startup when settings are missing.
  - Add a health check that includes the database, prepare the Dockerfile for Railway, and stop committing local uploads.
- **Files:**
  - `backend/src/{routes,controllers,services,validators,utils,config,scripts}`
  - `backend/src/app.ts`, `server.ts`
  - `backend/package.json` (real scripts only), `backend/prisma/migrations/`, `backend/.env.example`, `backend/Dockerfile`
  - `docs/migration/BACKEND_MERGE.md`
- **Depends on:** Phase 1 (snapshot and branch).
- **Acceptance:** The backend builds with zero errors and starts against a throwaway local PostgreSQL. All 12 route groups respond. The automated tests pass. The website and Base44 app are untouched.
- **Risks and rollback:** The two halves may disagree; conflicts are documented. Rollback means reverting branch commits.
- **Needs from you:** nothing.
- **Complexity / cost:** Medium / $0.

#### Phase 3: Database, authentication, admin authorization and file storage
- **Database additions:**
  - account data (ported from Base44) and reading progress per user and book
  - publication state and trash on all content types
  - video source (YouTube link, synced YouTube, uploaded), with a unique YouTube video ID, live status and scheduled/actual start times
  - YouTube channel ID, uploads list, auto-sync and auto-publish switches, last sync and last error
  - sync-run log with quota used, and the admin activity log
  - file records (bucket, key, size, checksum, status)
  - a "Base44 ID" column on every imported table so each record traces back to its source
- **Authentication:**
  - Keep the existing short-lived access and refresh tokens, hashed refresh tokens and roles (USER, ADMIN, SUPER_ADMIN).
  - Add email verification, password reset, account deletion, login rate limits and lockout, and a role check on every admin route.
  - Public endpoints never return drafts.
- **Storage:**
  - One storage layer with a local driver for development and a Cloudflare R2 driver.
  - Uploads go directly to storage through short-lived signed links, in parts for large MP4s, with type and size checks.
  - Two buckets: **public** for published files (stable, cacheable, offline-friendly links) and **private** for drafts (temporary preview links).
  - Publishing copies a file to public; unpublishing or deleting removes the public copy.
- **Files:**
  - `backend/prisma/schema.prisma` plus a new migration
  - `backend/src/middleware/{auth,authorize}.ts`
  - `services/auth.service.ts`, `services/email.service.ts`, `services/storage/*`
  - `routes/{auth,upload,account}.routes.ts`, `scripts/createAdmin.ts`
- **Depends on:** Phase 2.
- **Acceptance:**
  - Anonymous or USER requests to any admin endpoint are refused.
  - Drafts never appear publicly.
  - An admin can upload a PDF and cover locally and attach them to a book.
  - Refresh and logout behave correctly.
  - The role-by-endpoint test matrix passes.
- **Risks and rollback:** Auth mistakes are covered by the automated role tests. Secrets live only in server settings. Rollback means reverting the migration on the branch.
- **Needs from you:** nothing for local work.
- **Complexity / cost:** Medium–High / $0.

**End of Stage 1: you review the reports and test results, then approve or reject Stage 2.**

### Stage 2: Phases 4–5, staging deployment (after approval)

#### Phase 4: Content management and automatic YouTube sync
- **Work:**
  - Connect the existing admin and developer panels to the API, with Draft/Publish/Unpublish/Delete/Restore controls, upload progress and the activity log.
  - Add the YouTube Channels manager.
  - Add the server scheduler inside the API process, with a database lock so a sync never runs twice at once.
  - Add the "changes since" endpoint.
  - Deploy to a **staging** environment: Railway, R2 staging buckets and the `api-staging` address.
- **Quota estimate:** about 192 units per channel per day at a 15-minute cadence, so roughly 40 channels fit comfortably in the free 10,000 units. Push notifications from YouTube (WebSub) can be added later for near-instant detection at no cost.
- **YouTube rules:** videos are only embedded, never downloaded. Metadata is refreshed regularly, and YouTube attribution is shown.
- **Files:**
  - `backend/src/services/youtube/{client,resolver,sync}.ts`, `backend/src/jobs/scheduler.ts`
  - `routes/{youtubeChannels,content}.routes.ts`
  - `src/components/dev/DevVideos.jsx`, `DevBooks.jsx`, `DevSocialChannels.jsx`, `DevUsers.jsx`, `DevBackup.jsx`, `src/pages/Admin.jsx`
  - new `src/components/dev/DevYouTubeChannels.jsx`, `DevTrash.jsx`
- **Depends on:** Phase 3.
- **Acceptance:**
  - A test channel imports its latest 50 videos in one cycle, and repeated runs create no duplicates.
  - A scheduled stream shows as upcoming, then live, then ended.
  - Quota use stays below budget.
  - A book published on staging appears on the staging website within 5 minutes with no redeploy.
- **Risks and rollback:** Quota exhaustion is handled by backoff and the 80% stop. Staging is separate from production, and rollback means redeploying the previous version.
- **Needs from you:**
  - a Railway account (Hobby)
  - a Cloudflare account with R2 and a domain
  - a Google Cloud project with a restricted YouTube Data API key
  - a Resend account
  - the list of YouTube channels
- **Complexity / cost:** High / Railway about $8–20/month starts here; R2 likely inside the free tier at first.

#### Phase 5: Move frontend pages off Base44
- **Approach:**
  - Migrate page by page behind the existing `VITE_USE_INDEPENDENT_API` flag: read-only pages first, then favourites and progress, then admin, then sign-in last.
  - `AuthContext` keeps the same interface, so pages need few changes.
  - AI search is replaced by fast server-side full-text search with Arabic normalisation.
- **Files:**
  - `src/lib/AuthContext.jsx`, `dataSource.js` (all 12 entities), `src/lib/api/*`
  - `contentSyncEngine.js`, `offlineSync.js`, `accountSync.js`, `activeUser.js`, `uploadFacade.js`, `uploadWithProgress.js`
  - pages: `Home`, `Books`, `BookDetails`, `ReadBook`, `Videos`, `Favorites`, `Settings`, `Contact`, `DevPanel`, `OAuthConsent`, `SplashPreview`
  - components: `AISearch`, `EmailVerification`, `UserNotRegisteredError`, `ProtectedRoute`, `AuthLayout`, all `src/components/dev/*`
  - `vite.config.js` (remove the Base44 plugin), `package.json` (remove `@base44/sdk`, `@base44/vite-plugin`, and the Stripe packages if confirmed unused)
  - `public/manifest.json` (local icons), `public/sw.js` (new API and file addresses)
  - finally `src/api/base44Client.js` is removed
- **Depends on:** Phase 4 (staging API).
- **Acceptance:**
  - No Base44 import is left, and the app builds with Base44 packages uninstalled.
  - Every page matches its "before" screenshots.
  - Offline reading, favourites and progress pass in airplane mode.
  - Network logs show no calls to Base44 domains.
- **Risks and rollback:** Regressions are caught by screenshot comparison. Until cutover, switching the flag off returns the site to Base44 instantly.
- **Needs from you:** approval of the new login, register and reset screens.
- **Complexity / cost:** High (largest phase) / no new charges.

### Stage 3: Phases 6–7, data cutover and Google Play (after approval)

#### Phase 6: Migrate live records and media, validate, test offline
- **Export (while Base44 access is active):**
  - (a) Use the Base44 dashboard's CSV export for all 12 entities, as a cross-check copy.
  - (b) Run a full-fidelity JSON export through the Base44 SDK with an admin login, keeping IDs, dates and creators.
  - Store both in a private archive bucket and give you a copy.
- **Media:**
  - Collect every file link from records, settings and the manifest.
  - Download each file, fingerprint it with SHA-256 and upload it to R2.
  - Keep an old-to-new link table.
- **Import:**
  - The missing `migrateFromBase44.ts` script is written. It can be run repeatedly safely and has a dry-run mode.
  - It maps language and category values and creates authors and categories from free text.
- **Users:** not migrated, since you chose new sign-ups. Admin accounts are recreated. Favourites and progress already stored on a device upload to the new account at first sign-in.
- **Cutover:**
  - A short content freeze on Base44 (about 1 hour), a final delta export, then the website and app point to the new API.
  - Base44 stays intact and read-only for 30 days as a fallback.
- **Files:** `backend/src/scripts/{exportBase44,migrateMedia,migrateFromBase44,verifyMigration}.ts`, `docs/migration/VERIFICATION_REPORT.md`.
- **Depends on:** Phases 4–5 in staging.
- **Acceptance:**
  - Record counts match 100% per entity, with a field-level comparison on a sample.
  - Every file's checksum matches and the file opens.
  - Zero Base44 links remain in the database.
  - Offline upgrade test: existing offline books survive; unpublished items disappear from devices after sync.
- **Risks and rollback:**
  - Base44 file links may expire after cancellation, so everything is downloaded first.
  - Edits made during cutover could be lost, which the freeze prevents.
  - Rollback means pointing the website back to Base44 within the 30-day window.
- **Needs from you:** a Base44 admin login session for export, the cutover date, and later approval before Base44 is cancelled.
- **Complexity / cost:** Medium–High / R2 storage based on library size.

#### Phase 7: Package, test and prepare for Google Play
- **Work:**
  - Add Capacitor 8 with the **web app bundled inside the APK**, so it opens offline and is not a thin website wrapper (which Play may reject).
  - Use the package name from Phase 1, unchanged unless you approve otherwise. Target Android 16 (API 36); minimum Android 7.
  - Handle the back button, status bar and splash, and store sessions securely on the device.
  - Skip the service worker in the native build: files are already local, and IndexedDB keeps offline books.
  - Bundle the pdf.js worker locally.
  - Fix YouTube embeds: set the referrer policy to avoid the known "Error 153" in Android WebViews, with an "Open in YouTube" fallback.
  - Create a GitHub Actions workflow that builds a signed AAB with an automatic version code.
- **Files:**
  - `capacitor.config.ts`, `android/` (committed without any keystore), `android/app/build.gradle`
  - `src/main.jsx`, `src/lib/api/config.ts`, `src/components/VideoPlayer.jsx`, `src/components/probook/*`
  - `.github/workflows/android-release.yml`
  - `docs/PLAY_RELEASE_CHECKLIST.md`
- **Play requirements prepared:**
  - privacy policy page and account-deletion web page
  - Data safety answers, content rating, target audience
  - reviewer test account
  - store listing texts and images
  - the 12-tester, 14-day closed test if the account is a personal account created after 13 Nov 2023
- **Depends on:** Phase 6 (production API live).
- **Acceptance:**
  - The AAB uploads to internal testing without errors.
  - On at least 3 physical devices (old, mid and current Android), these all pass: offline reading, PDF, favourites, progress, YouTube and MP4 playback, RTL and the back button.
  - Content published in admin appears in the installed app with no update.
- **Risks and rollback:**
  - A lost upload key can be reset through Play App Signing.
  - Large PDFs could be evicted from WebView storage; if so, they move to device file storage.
  - A bad release is rolled back by halting the rollout in Play Console.
- **Needs from you:**
  - Play Console access (you perform the uploads)
  - the upload key, added only as GitHub encrypted secrets if you approve; otherwise you build locally in Android Studio
  - testers, privacy-policy contact details and store graphics
- **Complexity / cost:** Medium / $0 recurring.

### Where each kind of work happens

| Local only (no accounts) | Needs deployed services | Needs Base44 access | Needs you manually |
|---|---|---|---|
| Phases 1–3: snapshot, inventory, AAB analysis, backend repair, schema, auth, storage code, tests | Phases 4–5: Railway staging, R2, YouTube key, email; Phase 7 production API | Phase 6 export (CSV and SDK), media download, final delta | AAB, Play error, account sign-ups, keys, cutover approval, Play uploads, testers |

### Top risks overall
1. **Base44 two-way sync and Vercel auto-deploy from `main`.** Work stays on a branch until cutover.
2. **Base44 file links expire.** All media is downloaded and verified before any cancellation.
3. **Package name or signing mismatch.** This is diagnosed first; nothing changes without approval.
4. **Play's closed-test waiting period** can add at least 14 days to the launch date.
5. **YouTube embed restrictions in WebViews.** These are tested early in Phase 7, with a fallback in place.

### Smallest safe first milestone
**Phases 1 and 2 on the `independent-migration` branch:**
- the snapshot and backup
- the Base44 usage inventory
- the AAB and Play-error diagnosis report
- the consolidated backend, compiling and passing tests against a throwaway local database

There is no deployment, no data movement, no change to Base44, no push to `main`, and the live website and app are untouched.

### Information still needed (to start Stage 1)
1. The existing `.aab` file, uploaded here.
2. The exact Play Console error text or a screenshot.
3. The package name typed into Play Console, if an app entry was created, plus whether the developer account is **personal or organization** and roughly when it was created.
4. The laptop's Android project folder, zipped, **without** the keystore (`.jks`/`.keystore`) or passwords, and the tool used to create it, if known.
5. The signing certificate fingerprints only (SHA-1/SHA-256 from `keytool -list -v`), never the keystore itself.

Later, not needed now: Railway, Cloudflare (R2 and a domain), Google Cloud (YouTube API key), Resend, the YouTube channel list (Stage 2); a Base44 admin session and the cutover date (Stage 3).

---

## Assumptions

- Build work happens on a copy of the repository in this workspace and is saved to GitHub on the `independent-migration` branch. Emergent's Expo preview, Publish button, hosting and MongoDB are not used for this project.
- The website stays on Vercel (free Hobby plan) at its current address, switched to the new API at cutover.
- A custom domain is bought (about $10–15/year, Cloudflare Registrar) for the API and public files.
- Email (verification, password reset, contact form, admin notices) moves from the Gmail connector to Resend's free tier.
- AI search becomes standard Arabic-aware full-text search. Existing book translations are migrated and shown, but the automatic AI translation pipeline is not rebuilt in this migration.
- Stripe packages are removed only after confirming nothing uses them.
- YouTube defaults: uploads are checked every 15 minutes, live and upcoming streams every 5 minutes, and auto-publish is on for each channel (it can be set to review-first).
- Uploaded videos are MP4 (H.264), up to 2 GB per file, and online-only. YouTube videos are never available offline.
- Unpublishing or deleting removes the item from devices at the next sync. Deleted items stay in Trash for 30 days.
- Roles stay USER, ADMIN and SUPER_ADMIN. The admin dashboard remains reachable on the website and in the app for admin accounts only.
- End-user accounts are not migrated. Admins are recreated. Device-stored favourites and progress upload at first sign-in.
- Base44 stays intact and read-only for 30 days after cutover. It is cancelled only with your approval.
- Nightly database backups go to a private R2 bucket and are kept for 30 days, in addition to Railway's own storage.
- Android uses Capacitor 8, targets API 36 with a minimum of Android 7, keeps the existing package name and signing identity, and has no over-the-air code-update service. Code changes ship as normal Play releases.
- Signed release builds run in GitHub Actions only after you approve storing the upload key as encrypted GitHub secrets. Otherwise you build in Android Studio from the generated project.
- Imported records keep their Base44 ID in an extra column so every migrated item can be traced back to its source.
