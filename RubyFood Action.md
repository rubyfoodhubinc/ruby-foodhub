# Ruby FoodHub — Engineering Handoff Note
> **This file (`RubyFood Action.md`) is the live, daily-maintained copy of the handoff note.** It was forked from `July Action.md` on 2026-07-22 and is auto-updated every day at 12:00 AM (America/New_York) by a scheduled agent — see §13 for the update log and §0 below for how the automation works. `July Action.md` is now a frozen historical snapshot as of 2026-07-22 and will not receive further updates; treat this file as the source of truth going forward.

**Prepared by:** outgoing session (acting as Chief Engineer for this stretch of work), now maintained by a daily scheduled update
**Date:** July 2026 (forked from July Action.md on 2026-07-22)
**Last updated:** 2026-07-22 — forked from `July Action.md` at commit `fc44664`; no content changes yet beyond this header. See §12 for the full 2026-07-22 session record (unchanged from the source file) and §13 for the daily-update log going forward.

> ⚠️ **ACTION REQUIRED:** confirm migrations 013 and 014 have been run in the Supabase SQL Editor (user reported running "the SQL" before this session's app-store work began, but this has not been independently verified — no database access from this environment). See §4.
**Purpose:** Full record of what was built, current state, and exactly what the next analyst/engineer needs to pick up.

Repo: `github.com/rubyfoodhubinc/ruby-foodhub` (branch `main`)
Local working copy: `C:\Users\rubyn\OneDrive\rubyfoofhub web\Ruby FoodHub landing page 7.3`
Hosting: Vercel (project `ruby-foodhub`, org `ruby-food-hub`) — auto-deploys on push to `main`
Database: Supabase project `mitwckjiiivflhzhcvou`
Payments: Stripe (Checkout + webhook)
Email: Resend

---

## 1. What this project is

Ruby FoodHub is a beverage e-commerce business with three connected surfaces:

1. **Public storefront** (`Home.dc.html`, `Checkout.dc.html`, `Account.dc.html`, etc.) — the "DC" component framework (`support.js`), retail checkout, Stripe payments, coupons, customer accounts (Supabase Auth, email + Google).
2. **Admin dashboard** (`admin.html`) — single page, sidebar-tabbed: Home (KPI overview), Orders, Sales, Products, Emails (promotional), Wholesale, Wholesale Sales, Retailer Emails, Users.
3. **Retailer/Wholesale portal** (`retailer.html`) — separate login system for B2B retailer accounts: place orders, view/pay invoices, track stock, profile, help/support.

All three now also ship as **native iOS/Android apps** via Capacitor (added this session — see §6).

---

## 2. Everything built, in order (full session history)

This is the complete build sequence, oldest to newest, for context on *why* things are shaped the way they are:

1. Stripe Checkout payments wired up; checkout template/404/webhook/email bugs fixed
2. Coupon system (WELCOME5, TAKEOFF20, WILLDOPSY) shared between Cart and Checkout
3. Supabase `orders` table + password-protected `/admin` page
4. `reconcile-orders` backfill endpoint (daily cron) as a safety net for missed webhooks
5. Admin Orders tab: every column, filters (date range, name/phone/email/address search)
6. Full admin dashboard build-out: Sales KPIs, Products (live-editable prices drive storefront), Users
7. Named admin accounts (bcrypt, roles owner/manager) replacing shared password + full `audit_log`
8. Customer accounts: guest or signed-in checkout, email verification, Google OAuth, forgot-password, saved addresses, order history
9. Google OAuth branding-verification fixes (crawler-visible `<title>`/hero copy — Google's reviewer doesn't run JS)
10. Real logo/favicon uploaded, replacing placeholder graphics
11. Promotional Emails tab (Resend Broadcast API) — unsubscribe/rate-limit handling confirmed against Resend docs *before* building
12. **Retailer/Wholesale Portal** — separate `retailer_accounts` login, admin-approval flow, `wholesale_prices`, `wholesale_orders`, Stripe-or-pay-on-delivery checkout, retailer dashboard, admin Wholesale tab
13. Admin: cancel wholesale order with required typed reason (emailed to retailer)
14. Wholesale Sales KPI tab (mirrors retail Sales tab) + month-over-month + CSV export
15. Retailer Emails — bulk email tool, its own tab, quick-select reasons
16. Admin Home — dynamic overview dashboard (first tab), combined retail+wholesale KPIs
17. Per-retailer stock ledger (`retailer_stock` + `stock_movements`), admin can adjust with attribution; low-stock auto-targets Retailer Emails
18. Retailer portal upgrade: KPI Home dashboard, company logo upload, professional polish
19. Retailer → Sales team contact/support form (Help & Support tab)
20. **Billable delivery flow fix**: admin "Add Order to This Account" with a "Mark as delivered now" checkbox — stocks the retailer immediately and makes the order payable, closing the gap where stock adjustments bypassed billing entirely
21. Bug sweep from that review: canceled orders no longer pollute retailer stats; Amount Due counts all unpaid states; payment_method correctly reflects how an order actually got paid
22. **Retailer sold-stock reporting**: "Record Sold" in My Stock so on-hand counts reflect real depletion, not just what was delivered
23. **Cash/Zelle payment claims**: retailer can report paying by cash/Zelle from a payment chooser (Stripe / Cash / Zelle); claim does **not** clear the balance — order sits in `awaiting_confirmation` until admin confirms or rejects
24. Zelle ID (`bankpay@rubyfoodhub.com`) and the real Zelle QR tag wired into the payment chooser and relevant emails
25. **Capacitor native apps** for Admin and Retailer/Wholesale portals — see §6
26. **App Store compliance**: in-app account deletion (retailer) + updated privacy policy — see §7
27. **Cash/Zelle at order placement** (2026-07-21, `d194889`): retailer Place Order tab now offers Stripe / Zelle / cash-on-delivery, matching the Pay Now chooser; a Zelle order immediately opens the payment chooser (QR tag + bankpay@rubyfoodhub.com) so the payment can be sent and reported on the spot — see §10
28. **Payment push in the retailer portal** (`d194889`): standing "Payment due: $X — Pay Now" banner on every portal view while any order is unpaid — see §10
29. **Billable stock-ins + Add Order defaults** (`d194889`): admin "Stock at This Location" positive additions now create a delivered, payable order; "Add Order to This Account" defaults to "Mark as delivered now" — see §10
30. **Portal layout fix** (`d194889`): expanded admin detail rows no longer force sideways page scrolling; page-level horizontal overflow disabled on both portals — see §10
31. **App icons & splash screens** (`8910150`): real Ruby FoodHub logo artwork generated via `@capacitor/assets` for both apps, Android + iOS — the former store-submission blocker is cleared — see §6
32. **Retailer-scoped order numbers** (2026-07-21, `a79512a`): `WHS-######` replaced by `XXXX` + `MMDDYYYY` + per-retailer serial (e.g. `MONE12242026-05`) — see §11
33. **Production batch tracking** (`a79512a`, migration **014**): 8-character batch key required whenever goods ship to a retailer, shown to admin and retailer and carried into emails and the stock ledger — see §11
34. **Real Android build pipeline stood up** (2026-07-22, `2989749`): JDK 17 + JDK 21 + Android SDK cmdline-tools installed on this Windows machine; both apps build real signed release `.aab` files from the command line — no Android Studio GUI required. A per-app upload keystore was generated for each. See §12.1.
35. **`/delete-account` page** (`af8181b`): static page satisfying Google Play's account-deletion-URL store-listing requirement — names both apps, gives the in-app deletion steps, an email fallback, and states exactly what's deleted vs. retained. See §12.2.
36. **Package name corrections** (`d2c3d85`, `d43ec45`): Wholesale app renamed `com.rubyfoodhub.wholesale` → `com.rubyfoodhub.retailer`; Admin app renamed `com.rubyfoodhub.admin` → `com.Ruby.FoodHub.Admin` — both to match the package name each app's Play Console listing had already locked in. See §12.3.
37. **Play Store listing graphics** (`fa972f8`, `aab7381`): 512×512 store icon + 1024×500 feature graphic for both apps. First version was a logo+tagline lockup; Google's review flagged it as a "marketing illustration that does not show the in-app experience," so it was rebuilt as a phone mockup of the *real* sign-in screen, with colors sampled live from the running site (not guessed). See §12.4.
38. **Android 16 (API 36) targeting** (`24622db`): both apps bumped from `targetSdkVersion 35` to `36` after a Play Console policy rejection on the Wholesale app's production submission (deadline Aug 30, 2026). `minSdkVersion` unchanged at 23 — no device-support loss. See §12.5.

---

## 3. Architecture cheat-sheet

- **Templating**: public storefront pages use the proprietary "DC" framework (`.dc.html` + `support.js`, `<x-dc>`/`sc-if`/`sc-for`). **Must be served over http(s)** — `file://` breaks its internal `fetch`/`import()`. `admin.html` and `retailer.html` are plain single-file HTML/JS (no DC framework).
- **Three fully separate auth systems** (deliberate):
  - Admin: `admin_users` / `admin_sessions` — bcrypt + server-side session tokens, `sessionStorage`
  - Retailer: `retailer_accounts` / `retailer_sessions` — same pattern, 7-day expiry, `localStorage`
  - Customer: Supabase Auth (storefront only)
- **Server-side price authority**: retail (`products`) and wholesale (`wholesale_prices`) checkout always look up price server-side by id — client-submitted prices are never trusted.
- **Audit logging**: `audit_log` table, `logAudit()` helper, used on nearly every mutating action. `admin_user_id = null` means a system action.
- **Stock ledger**: `retailer_stock` (current qty) + `stock_movements` (full history) via `applyStockChange()` in `api/_lib/stock.js` (shared by admin adjustments, order fulfillment, and retailer sold-reports).
- **Wholesale order payment states**: `pending` → (`awaiting_confirmation` if a cash/Zelle claim is filed) → `confirmed_by_admin`, or `paid` directly via Stripe. Canceled orders are excluded from all financial rollups. `payment_method` may now be `stripe`, `zelle`, `cash`, or legacy `pay_on_delivery` **at placement time** (constraint from migration 012 already allows all four); admins can confirm payment received on any unpaid non-Stripe order.
- **Billing rule (owner decision, 2026-07-21)**: anything that puts product at a retailer's location must bill them. Positive "Stock at This Location" adjustments route through the billable `create-order` path (`markFulfilled: true`); only negative adjustments are inventory-only corrections. Do not reintroduce unbilled stock-in paths.
- **Order numbering (owner decision, 2026-07-21)**: wholesale order numbers are generated **in application code**, not by the DB trigger — `orderNumberFor()` / `insertWholesaleOrder()` in `api/_lib/wholesale.js`, shared by retailer `place-order` and admin `create-order`. Format: first 4 alphanumerics of the business name (padded with `X`) + order date `MMDDYYYY` in **US Eastern** + `-` + zero-padded per-retailer serial (lifetime order count + 1). The serial is *not* zero-padded beyond 2 digits, so a retailer's 105th order reads `-105`. `order_number` is `unique`; the insert retries with the next serial up to 5 times on a `23505` collision. The old `WHS-######` sequence trigger is intentionally left in place as a fallback for any insert that supplies no number, and historical `WHS-` numbers remain valid.
- **Production batch**: `wholesale_orders.production_batch` (migration 014), 8 chars `[A-Z0-9]`, uppercased server-side. **Required** on admin `create-order` when `markFulfilled` is true, and on the first transition to `fulfilled` in `set-order-status` (existing batch on the row satisfies it). Validated on both client and server. Surfaced on admin + retailer order rows, the delivery email, `stock_movements` notes, and the audit log.
- **Verification discipline used all session**: every backend change `node --check`'d; every inline `<script>` block extracted and `node --check`'d; HTML tag/div balance grep-counted; a cross-check that every frontend API action call has a matching backend handler. No code pushed without this pass. *(No live browser click-through was possible from the sandbox — no outbound network for `vercel dev` in most sessions. This is a known gap; see §8.)*

---

## 4. Database migrations — RUN STATUS

All files live in `supabase/`, are safe to re-run, and are also appended to the master `supabase/schema.sql`. Run each in the Supabase SQL Editor **in order** if not already applied:

| # | File | What it adds | Status |
|---|---|---|---|
| 002 | `002_add_terms_agreed_at.sql` | terms timestamp on orders | ✅ confirmed run (older session) |
| 003 | `003_add_coupon_columns.sql` | coupon/discount columns | ✅ confirmed run |
| 004 | `004_add_order_status_and_accounts.sql` | order_status, customer_id, profiles | ✅ confirmed run |
| 005 | `005_admin_users_and_audit.sql` | admin_users, admin_sessions, audit_log | ✅ confirmed run |
| 006 | `006_products_and_admin_extras.sql` | products table + seed | ✅ confirmed run |
| 007 | `007_email_campaigns.sql` | email_campaigns, email_templates | ✅ confirmed run |
| 008 | `008_wholesale_portal.sql` | retailer_accounts, wholesale_orders, wholesale_prices | ✅ confirmed run |
| 009 | `009_wholesale_cancel.sql` | canceled status, cancel_reason | ✅ confirmed run |
| 010 | `010_retailer_stock.sql` | retailer_stock, stock_movements | ✅ confirmed run |
| 011 | `011_retailer_logo.sql` | logo_url column | ✅ confirmed run |
| 012 | `012_payment_claims.sql` | awaiting_confirmation state, cash/zelle method, claimed_* columns | ✅ confirmed run |
| **013** | **`013_account_deletion.sql`** | **`account_status` gains `'closed'`; `deleted_at` column** | 🟡 **user reported running "the SQL" on 2026-07-22 before app-store work began — not independently verified (no DB access from this environment). Confirm in Supabase before relying on account deletion in production.** |
| **014** | **`014_production_batch.sql`** | **`wholesale_orders.production_batch` column (8-char batch key)** | 🟡 **same as 013 — user-reported run, not independently verified. No `PGRST204`/unknown-column errors have surfaced in subsequent sessions, which is consistent with (but not proof of) both migrations being applied.** |

**→ First task for next analyst: get an explicit yes/no from the owner on 013 and 014, or check the Supabase table editor directly (`retailer_accounts.deleted_at` and `wholesale_orders.production_batch` should both exist as columns if run).**

- **014 is blocking day-to-day operations**: admin "Add Order → mark delivered", billable stock-ins, and marking any order fulfilled all now send a `production_batch` value. Until the column exists those inserts/updates fail (PostgREST `PGRST204`, unknown column). The whole migration is one line:
  ```sql
  alter table wholesale_orders add column if not exists production_batch text;
  ```
- **013** affects account deletion only — if deletion is used before it runs, it hard-fails on the status constraint.

---

## 5. Environment variables (Vercel project settings)

Required and already configured per prior confirmations: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (+ webhook secret), `RESEND_API_KEY`, `CRON_SECRET`, `ADMIN_PASSWORD` (bootstrap-only, first admin setup). No new env vars were introduced this session.

Known historical gotcha: the Stripe webhook must point at `www.rubyfoodhub.com` (apex redirects, which Stripe does not follow), and must be subscribed to `checkout.session.completed` (not `charge.succeeded`/`charge.updated`).

---

## 6. Capacitor native apps — STATE: Wholesale app in Google Play review (production); Admin app built, signed, uploaded, package-corrected, pending re-submission with API 36

Two separate app projects under `apps/`. **Package/bundle IDs below are current as of 2026-07-22** — both were renamed mid-submission to match what each app's Play Console listing had already locked in (see §12.3); do not use the IDs originally chosen when the projects were scaffolded.

| App | Folder | Bundle ID (current) | Wraps |
|---|---|---|---|
| Ruby FoodHub Admin | `apps/admin-app/` | `com.Ruby.FoodHub.Admin` *(non-standard capitalization — locked in by the Play listing before the rename; cosmetic only, builds and ships fine)* | `admin.html` |
| Ruby FoodHub Wholesale | `apps/retailer-app/` | `com.rubyfoodhub.retailer` | `retailer.html` |

**Current versionCode / versionName** (bump on every future upload — see §12.5 for the exact mechanics): Wholesale is at **3 / "1.1"**, Admin is at **2 / "1.1"**. Both target `compileSdk`/`targetSdk` **36**, `minSdk` **23**.

Each app bundles its portal page as `www/index.html` (via `sync-www.js`, gitignored output) rather than loading a live URL — better for store review. Both `android/` and `ios/` native projects have been generated (Capacitor 7) and verified: correct bundle IDs, correct app display names, and the API-base shim present in all four bundled copies.

**Web-side changes made to support this** (website behavior unchanged — these are no-ops in a normal browser):
- `API_BASE` shim in `admin.html`/`retailer.html`: routes all API calls to `https://www.rubyfoodhub.com` when running inside the Capacitor webview (`window.Capacitor.isNativePlatform()`), otherwise stays same-origin.
- `api/_lib/cors.js`: answers CORS preflight for the app's webview origins (`capacitor://localhost`, `https://localhost`), wired into all 12 portal endpoints. Auth is a session token in the request body, never a cookie, so this doesn't create a credential-exposure risk.
- `api/retailer-portal.js`: Stripe success/cancel return-URLs no longer trust `capacitor://localhost` as an origin — they fall back to the live site so payments started inside the app return somewhere valid.

Full day-to-day workflow (rebuilding `www/`, the CLI Android build/sign commands, the TLS-truststore gotcha) is documented in **`apps/README.md`** — read that before touching the app folders. It was substantially rewritten in this session; it is now the source of truth for build commands, not this doc.

### What is DONE for the apps (as of 2026-07-22)
- **App icons & splash** — real logo artwork, both platforms, both apps (§2 item 31).
- **Real signed Android builds** — JDK/SDK installed on this machine, both apps produce genuinely signed `.aab` files via `./gradlew bundleRelease`; verified with `jarsigner -verify` (not just "the build didn't error"). See §12.1.
- **Store listing graphics** — 512 icon + feature graphic, both apps, now depicting real UI after a Google policy flag on the first version. See §12.4.
- **`/delete-account` page** — live, linked from both the privacy policy and the retailer sign-in screen. See §12.2.
- **Package names** — corrected to match each Play Console listing. See §12.3.
- **API 36 targeting** — both apps, after a Play policy rejection. See §12.5.
- **Wholesale app**: uploaded to Google Play (internal testing, then open testing, then production), package-corrected. The **production submission came back from Google review flagged** for targeting API 35 instead of 36 (§12.5) — the API-36 rebuild (`versionCode 3`) exists locally and has been **handed to the user with upload instructions, but is NOT yet confirmed uploaded to Play Console.** This is the single most important unconfirmed action in this doc — see §9 item 1.
- **Admin app**: built, signed, package-corrected, successfully uploaded to Play Console at least once (`versionCode 1`, API 35, user was mid-setup on a testing track). The API-36 rebuild (`versionCode 2`) also exists locally and is **also not yet confirmed uploaded** — the Admin app hadn't gone to review yet as of this doc's last update, so it may not have hit the API-36 flag, but there's no reason to upload the stale `versionCode 1` build now that `versionCode 2` exists.

### What is NOT done for the apps
- **iOS: nothing started.** No Xcode archive, no TestFlight, no App Store Connect listing. iOS **cannot be built on this Windows machine at all** — genuinely requires a Mac. This has been true all session and remains the single largest remaining gap.
- No screenshots captured for either Play listing. **This environment's browser tool can render and view app screens but cannot export the pixels to a file** — real screenshots must come from a device (the Wholesale app is installable via the testing track now, so this is unblocked on the user's end; see §12.4 and §9).
- Data Safety / App Privacy questionnaire answers have been drafted in chat (data collected: name, email, phone, address, purchase/order history; linked to identity; not used for tracking/advertising) but not confirmed as entered into either console.
- No demo reviewer credentials created (dedicated demo admin + demo retailer accounts) — worth doing before the Admin app goes to any review track wider than testers-with-real-accounts.
- Admin app's distribution track decision (Internal/Closed testing vs. Unlisted vs. public Production) — flagged repeatedly as "probably shouldn't be a public listing" but the user has not made a final call; currently in a testing track, not production.

---

## 7. App Store compliance work (commit `3800fa1`)

Two blockers were identified and closed:

**Privacy policy** — a policy page already existed (`Privacy Policy.dc.html`), predating the wholesale portal and apps. Updated with: wholesale/retailer account data section, a mobile-apps section (explicitly states no device ID/location/contacts/analytics/ad-tracking collection; session token only; Stripe opens in the device browser — this framing matters for Apple's App Privacy questionnaire), and a deletion section. Served at a clean `/privacy` URL (see `vercel.json` rewrite) and linked from the retailer sign-in screen and profile so a reviewer can reach it without needing an account.

**Account deletion** (Apple Guideline 5.1.1(v) — mandatory for any app with account creation, which the Wholesale app has):
- Retailer Portal → Profile → new "Privacy & Account" section → "Delete My Account": explains consequences, requires typing `DELETE` to confirm, immediate and in-app (no "email us" workaround, which Apple explicitly rejects).
- Backend (`retailer-portal.js`, action `delete-account`): **anonymizes** rather than hard-deletes — business name/contact/email/phone/address/logo wiped, password scrambled, status set to `'closed'`, all sessions revoked, stored logo file removed. Order rows are **kept** (financial records; `wholesale_orders.retailer_id` is `NOT NULL`) but now point at an anonymized account — disclosed in the privacy policy.
- Outstanding balance never blocks deletion (can't hold someone's account hostage over money owed) but is reported back to the retailer at deletion time, emailed to them, and flagged to `sales@` for manual follow-up.
- Closed accounts are locked out permanently: explicit `'closed'` checks added directly in `verifyRetailerLogin` and `requireRetailerSession` (not relying on the scrambled password hash to fail — belt and suspenders), cannot be reactivated by an admin, excluded from the retailer list/bulk emails/low-stock targeting. Past orders still display, labeled "Deleted Account."
- Migration 013 (see §4) backs this — **confirm it's been run**.

App bundles (`apps/*/www/`) were re-synced so the native projects ship this flow immediately once built.

**Follow-up, 2026-07-22 (`af8181b`)**: Google Play separately requires a *public URL* on the store listing — distinct from the in-app flow and the privacy policy — that names the app/developer, prominently shows deletion steps, and states what's deleted vs. retained. Built as a static page at `delete-account.html`, routed to `/delete-account`, covering both apps (Wholesale in-app steps + email fallback; Admin staff-account removal by email). Cross-linked from the privacy policy. This is the URL to paste into Play Console's "Delete account URL" field for both apps.

---

## 8. Known gaps / things to watch

1. **Migrations 013 and 014 run-status: user-reported, not independently verified** — see §4. Get an explicit confirmation or check the table editor directly.
2. **Partial live verification** — the 2026-07-21 sessions click-tested the new retailer UI (payment options, due banner, pay modal, layout containment) in a real browser against a local static server and confirmed the new markup deployed to production; the order-number generator was unit-tested directly. Still **not** exercised end-to-end with real money/data: retailer account deletion, the cash/Zelle claim → confirm/reject cycle, the billable stock-in path (order insert + stock movement + email), Stripe checkout for a placed order, and a real order insert under the new numbering + batch flow. Recommend a logged-in click-through of those.
3. **Order-number serial is a live COUNT, not a stored counter** — `insertWholesaleOrder()` counts the retailer's existing orders (including canceled ones) and adds 1. That is deliberate (numbers stay meaningful and gap-free per retailer), but it means: hard-deleting an order row would let a future order reuse a number, and two simultaneous orders rely on the `unique` constraint + retry. Don't hard-delete wholesale orders; cancel them.
4. ~~App icons~~ **cleared 2026-07-21.**
5. ~~No signed Android builds~~ **cleared 2026-07-22** — see §12.1. Both apps produce real, verified-signed release bundles from this machine via the command line.
6. ~~Package names don't match Play Console~~ **cleared 2026-07-22** — see §12.3. Both apps renamed to match their locked-in listings.
7. ~~Feature graphic flagged as a marketing illustration~~ **cleared 2026-07-22** — see §12.4.
8. ~~Targeting API 35, Play requires within 1 year of latest~~ **cleared 2026-07-22 in code** — see §12.5. **Not yet confirmed uploaded to either Play Console entry — this is the top open item, see §9.**
9. **iOS build requires a Mac — still completely unstarted.** Cannot be done from this Windows machine at all. Needs a borrowed Mac, MacinCloud, or a CI service like Codemagic. This has been flagged every session and remains the largest single gap in the whole app-store effort.
10. **No screenshot files can be produced from this environment** — the browser tooling available here can render and view app pages (confirmed working, real colors/layout sampled directly from them) but has no mechanism to export those pixels as a file. Screenshots must come from an installed device build. Not a one-time gap — this will recur for every app that needs store screenshots unless the tooling changes.
11. **Admin app package name has non-standard capitalization** (`com.Ruby.FoodHub.Admin`) — locked in by the Play Console listing before the correction, not something later code chose. Builds and ships correctly; purely cosmetic. Changing it now would require deleting the (unpublished) Console app and starting a new listing — only worth doing if the user explicitly wants it before the app ever goes to production.
12. **Admin app should likely not be a public store listing** — Apple tends to reject internal/staff-only tools from the public App Store, and the same instinct applies to Google Play's public search/browse. Recommended path: Apple's "Unlisted App Distribution" or TestFlight-only; Google Play closed/internal testing track, not Production. Flagged to the user repeatedly; no final track decision made as of this update — currently sitting in a testing track.
13. **Google Play new personal accounts** require a 14-day/12-tester closed test before going to production; enrolling as an *organization* (recommended, already advised) skips this.
14. The Wholesale app being a wrapped web view carries some risk of Apple's "minimum functionality" (guideline 4.2) pushback on first iOS submission — if it happens, the standard fix is adding one native capability (push notifications for order status was the suggested candidate, not yet built). Not relevant until iOS work starts.
15. **This machine's default shell (`Bash` tool) cannot make outbound TLS connections without workarounds** — plain `curl` fails even against github.com (`git push` works regardless). Two workarounds discovered and now standard practice: `curl --ssl-no-revoke` for simple downloads, and for JVM-based tools (Gradle, the Android `sdkmanager`) setting `JAVA_OPTS`/`GRADLE_OPTS` to `-Djavax.net.ssl.trustStoreType=Windows-ROOT` so Java uses the Windows certificate store instead of its own — this machine has a TLS-inspecting proxy whose root CA Windows trusts but Java's separate cacerts store doesn't. Documented in `apps/README.md`. Use the in-app browser (Claude Browser tools) for any live-site verification regardless; don't conclude the site is down from a failed plain `curl`.
16. **Building inside a OneDrive-synced folder can cause file locks mid-build** — `./gradlew clean` failed once with `Unable to delete directory ...\app\build` because OneDrive had a lock on it. Fix used: delete the `build/` folder directly (`rm -rf app/build`) instead of relying on Gradle's `clean` task. Worth knowing before assuming a build failure is a real code problem.

---

## 9. Immediate next steps, in priority order

1. **Upload the API-36 rebuilds to Play Console for both apps** — this is the single most important unfinished action. Local files, already built and verified this session:
   - Wholesale: `apps\retailer-app\android\app\build\outputs\bundle\release\app-release.aab` (`versionCode 3`, targetSdk 36) — needed to clear the production-review rejection.
   - Admin: `apps\admin-app\android\app\build\outputs\bundle\release\app-release.aab` (`versionCode 2`, targetSdk 36).
   If either has been rebuilt again since 2026-07-22, check `apps/*/android/app/build.gradle` for the current `versionCode` before assuming these exact numbers are still current.
2. **Get an explicit confirmation (or check directly) that migrations 013 and 014 have actually been run** in Supabase — see §4. Not blocking app-store work, but blocking safe reliance on account deletion and production-batch/delivery flows.
3. **Screenshots for the Wholesale Play listing** — capture from an installed device (the app is on a testing track and installable now): Home, Place New Order, My Orders, My Stock, and the payment chooser (card/cash/Zelle). This environment cannot produce these files itself (see §8.10) — they must come from the user's phone or from someone with device access.
4. **iOS — needs a Mac to make any progress at all.** Nothing can move here until Mac access exists (borrowed machine, MacinCloud, or a CI service like Codemagic). Once available: `cd apps/<app>; npm install && npm run sync; npm run open:ios`, then follow the normal Xcode archive/TestFlight/App Store Connect flow. `apps/README.md` has the commands.
5. **Admin app distribution-track decision** — confirm with the user whether it stays on a testing track (Internal/Closed on Play, Unlisted/TestFlight on Apple) or is intended for public listing; current default is testing-only per the "internal tool" concern in §8.12.
6. **Data Safety / App Privacy questionnaire** — answers have been discussed in chat (collects name/email/phone/address/order history; identity-linked; no tracking/advertising use; deletion via `/delete-account`) but confirm they've actually been entered into both consoles.
7. **Demo reviewer credentials** — create a dedicated demo admin account and a demo retailer account before either app goes in front of a human reviewer who needs to log in.
8. **Place one real test order** once 013/014 are confirmed run, and check: the order number comes out as `XXXX MMDDYYYY-NN` for that retailer, the production-batch field accepts 8 characters and rejects anything else, and the batch shows on both the admin and retailer views plus the delivery email.
9. **Live-verify with a real login** the remaining untested flows in §8.2: cash/Zelle claim → confirm/reject, billable stock-in, Zelle order placement, account deletion.
10. No other feature work is currently requested or pending. Confirm with the user before starting anything not on this list.

---

## 10. Session record — 2026-07-21 afternoon (payment push + layout + icons)

User request: review this handoff, then fix four issues on the retailer/admin portals and push. All four were implemented, verified, and deployed (commit `d194889`), followed by the app-icon commit (`8910150`) and this doc being added to the repo (`ae3c83b`).

### 10.1 Place Order tab now offers Stripe / Zelle / Cash
*Problem:* the Pay Now chooser on existing orders offered Stripe/cash/Zelle, but the Place Order tab only offered Stripe/pay-on-delivery.
- `retailer.html`: pay-choice radios are now **Pay now via Stripe / Pay by Zelle / Pay by cash on delivery**. Selecting Zelle places the order and immediately opens the existing payment chooser (Zelle QR tag + `bankpay@rubyfoodhub.com`) so the retailer can send and report payment on the spot. Method column maps all four values (Stripe / Zelle / Cash / Pay on delivery).
- `api/retailer-portal.js` `place-order`: accepts `cash` and `zelle` (schema already allowed them via migration 012 — **no new migration needed**); non-Stripe orders return the created order row so the frontend can open the chooser; the sales@ notification email is method-aware.
- `admin.html`: order tables show the new method labels; **Confirm Payment Received** now appears for any unpaid non-Stripe order (was pay-on-delivery only); Home KPI card renamed to "Payments To Collect" and counts all unpaid non-Stripe orders.

### 10.2 Sideways-scrolling / wide-page fix (both portals)
*Problem:* pages went wider than the screen; vertical position had to be given up to reach the horizontal scrollbar at the bottom and pan across.
*Root cause:* expanding a retailer (admin Wholesale tab) or an order (admin Orders tab) put wide nested tables inside a `<td>` of the outer table — intrinsic table sizing ignores `overflow`, so the nested tables forced the outer table (and page) wide.
- `admin.html`: expanded detail rows are wrapped in `<div class="detail-contain">` with `contain: inline-size`, so nested tables scroll inside their own `.table-scroll` wrappers instead of widening the page. Verified with an injected 3,455px-wide nested table: inner container scrolls, page stays at viewport width.
- Both `admin.html` and `retailer.html`: `html, body { max-width: 100%; overflow-x: hidden; }` — the page itself can never pan sideways; every wide table has its own scroller. Also fixed the pay-choice labels clipping long tokens (`overflow-wrap: anywhere`).

### 10.3 Stock at This Location now bills the retailer
*Problem:* admin stock additions only updated inventory — product reached the retailer with no order to pay.
*Owner decision:* **anything that puts product at a retailer's location must bill them.**
- `admin.html`: a **positive** adjustment now routes through `create-order` with `markFulfilled: true` — creates a delivered, unpaid order at the current wholesale price, increments stock, emails the retailer that payment is due, refreshes the orders + stock panels. Distinct confirm dialogs for add (billable) vs. remove (correction). Friendly error if the product has no wholesale price set yet.
- **Negative** adjustments still use `stock-adjust` (inventory-only: recounts, damage, sold-through) and never bill. The `stock-adjust` API itself is unchanged (still accepts positives if ever needed programmatically); the UI is what enforces the billing rule.

### 10.4 Add Order to This Account pushes for payment
- `admin.html`: "Mark as delivered now" **defaults to checked**; button renamed **"Create Order & Request Payment"**; helper text rewritten around payment being due.
- `retailer.html`: new standing **payment-due banner** (`#due-banner`, `updateDueBanner()`) at the top of every portal view whenever any order is unpaid: "Payment due: $X across N orders" + a **Pay Now** button (opens the chooser directly for a single unpaid order, else jumps to My Orders). Also shows an "awaiting confirmation" notice when claims are pending. Refreshed by both `loadOrders()` and `renderHomeView()`.

### 10.5 Verification performed
- `node --check` on `api/retailer-portal.js`, `api/admin-wholesale.js`, and both extracted inline portal scripts; div/tr tag-balance counts clean.
- Real-browser click-through against a local static server (`.claude/launch.json` in the Desktop entry folder has a `portal-static` config on port 4173): three payment options render and select correctly, due banner renders with mock orders, pay modal opens with Zelle QR, layout containment proven, zero console errors.
- Production check after deploy: `/retailer` and `/admin` on www.rubyfoodhub.com confirmed serving the new markup (Zelle/cash options, due banner, overflow guards, detail-contain rule).
- `apps/admin-app` and `apps/retailer-app`: `node sync-www.js` + `npx cap sync` re-run, so the native bundles ship all of the above on next build.
- Note for future sessions: the sandboxed shell on this machine **cannot make outbound TLS connections** (curl fails even to github.com, though git push works) — use the in-app browser for any live-site checks.

### 10.6 App icons (follow-up commit `8910150`)
Icon/splash artwork for both apps was found generated-but-uncommitted in the working tree (real logo: dark background Admin, light Wholesale; `@capacitor/assets` output for Android + iOS, manifest reformat, `@capacitor/assets` devDependency). Reviewed and committed at the user's request, clearing the store-submission blocker. Source artwork: `apps/*/assets/`.

---

---

## 11. Session record — 2026-07-21 evening (order numbers + production batch)

User request, verbatim intent: (1) change the `WHS` invoice/order number to the first four letters of the retailer's name + the order date + a serial — *"a retailer named MoneyMart who ordered on the 24th december 2026 … and has four previous orders … will be MONE12242026-05"*; (2) add an 8-character production batch number that the admin includes when an order is sent to a retailer, visible to both admin and retailer.

Both shipped in commit **`a79512a`**. **Migration 014 still needs to be run by the owner** — see §4.

### 11.1 Retailer-scoped order numbers
New shared helpers in `api/_lib/wholesale.js`:
- `orderNumberFor(businessName, priorOrderCount, when)` — pure function, easy to test. Uppercases the business name, strips everything non-alphanumeric, takes the first 4 characters padded with `X`, appends `MMDDYYYY` formatted in **America/New_York** (so an order placed late evening Eastern doesn't jump a day via UTC), then `-` and the serial (`priorOrderCount + 1`, zero-padded to 2).
- `insertWholesaleOrder(row, businessName)` — counts the retailer's existing orders, generates the number, inserts, and retries with the next serial on a `23505` unique violation (up to 5 attempts).

Wired into **both** creation paths so numbering can never drift: `place-order` in `api/retailer-portal.js` and `create-order` in `api/admin-wholesale.js`.

Tested directly against the helper:

| Business name | Prior orders | Date | Result |
|---|---|---|---|
| MoneyMart | 4 | 2026-12-24 | `MONE12242026-05` ← matches the spec example |
| BJ's | 0 | 2026-07-21 | `BJSX07212026-01` (padded to 4) |
| A & B Grocery #7 | 104 | 2026-01-02 | `ABGR01022026-105` (serial grows past 99) |
| *(empty)* | 0 | 2026-07-21 23:30 ET | `XXXX07212026-01` (no day-rollover bug) |

Backwards compatibility: existing `WHS-######` numbers are untouched and still display/pay/confirm normally; the DB trigger that generated them is intentionally left in place as a fallback for any insert that supplies no `order_number`.

### 11.2 Production batch number
Migration **014** adds `wholesale_orders.production_batch` (text). Format enforced as exactly 8 characters `[A-Z0-9]`, uppercased and validated **server-side** as well as in the browser.

Required at every point where goods actually reach a retailer:
- **Admin → Wholesale → Add Order to This Account**: batch field beside the note; required whenever "Mark as delivered now" is ticked (the default). Blocked client-side with a clear message and server-side with a 400.
- **Admin → Stock at This Location**: required on positive (billable) additions; not required on negative inventory corrections.
- **Admin → order status → Fulfilled**: if the order has no batch yet, the admin is prompted for one; cancelling the prompt or entering an invalid value reverts the dropdown and makes no change.

Where the batch appears once set: admin order rows and retailer order rows (under the item list), the "delivery added / payment due" email to the retailer, the `stock_movements` note for each stocked line, and the audit-log entries for both `wholesale_order_created_by_admin` and `wholesale_order_status_change`.

### 11.3 Verification performed
- `node --check` clean on `api/_lib/wholesale.js`, `api/retailer-portal.js`, `api/admin-wholesale.js`, and both portals' extracted inline scripts; div balance 232/232 (admin) and 98/98 (retailer).
- `orderNumberFor()` exercised directly for the four cases in the table above, including the spec's own example.
- Production confirmed serving the new admin markup after deploy (batch inputs on both forms + the fulfil prompt present).
- `sync-www.js` + `npx cap sync` re-run for both native apps.
- **Not** verifiable from here: a real order insert, because migration 014 has not been run and the sandbox has no DB access.

---

## 12. Session record — 2026-07-22 (Android app-store submission: real builds, keystores, package fixes, store graphics, API 36)

User request, across the session: "set up Capacitor... generate the iOS and Android build folders" (earlier session, produced the scaffolding referenced in §6/§7), then this session picked up with actual Play Console submission — uploading, hitting and fixing a sequence of real store-console errors one at a time as they appeared. Everything below actually happened, in order; nothing here is aspirational.

### 12.1 Real signed Android build pipeline (commit `2989749`)
Previously the apps were scaffolded but never actually built — no JDK, no Android SDK, no keystore existed on this machine. This session installed all of it and produced genuinely signed release bundles:

- **JDK 17** installed via `winget` (needed to run Gradle itself) and **JDK 21** installed separately after discovering Capacitor 7's Android module hard-requires Java 21 (`sourceCompatibility JavaVersion.VERSION_21` in its `build.gradle` — Gradle ran fine on 17, but compiling `capacitor-android` failed with `invalid source release: 21` until 21 was installed and `JAVA_HOME` pointed at it).
- **Android SDK command-line tools** downloaded directly from `dl.google.com` (no Android Studio GUI installed or needed) to `C:\Android`, with `platform-tools`, `platforms;android-35`, and `build-tools;35.0.0` (later also `;android-36`/`;36.0.0`, see §12.5).
- **Hit and worked around the TLS-inspecting-proxy issue** described in §8.15 — both for `curl` (SDK zip download) and for the JVM (`sdkmanager`, Gradle itself hitting Maven). This was the single most time-consuming part of the setup and is now documented so it isn't rediscovered from scratch.
- Ran `./gradlew assembleDebug` for both apps successfully (proof the pipeline works end to end) before moving to release builds.
- **Generated one upload keystore per app** (not shared — a compromise of one can't affect the other): `apps/admin-app/android/rubyfoodhub-admin-upload.jks` and `apps/retailer-app/android/rubyfoodhub-wholesale-upload.jks`, via `keytool -genkeypair`, RSA 2048, 30-year validity (10957 days), PKCS12 format. Both `.jks` files and their `android/keystore.properties` (which holds the passwords in plaintext) are **git-ignored** — confirmed via `git status` before every commit in this session that they never appear as trackable changes.
- **The generated passwords were shown to the user once, in chat, with an explicit instruction to back them up immediately** to a password manager. They are not recorded anywhere in this repo or doc. If they're lost: Google Play has enrolled both apps in **Play App Signing** ("Releases are signed by Google Play" was on when uploading) — meaning the `.jks` on this machine is only the *upload key*, not the actual signing key that reaches devices. Google holds the real signing key and has a slower key-reset/recovery process for a lost upload key, which is meaningfully less catastrophic than it would be without Play App Signing. Still, losing the keystore is a real problem to avoid, not a non-issue.
- `apps/admin-app/android/app/build.gradle` and `apps/retailer-app/android/app/build.gradle` both gained a `signingConfigs { release { ... } }` block that reads `keystore.properties` and falls back to an **unsigned** release build if the file is missing, so a fresh checkout without the keystores still builds `assembleDebug` with zero setup.
- `apps/README.md` was substantially rewritten with the exact CLI commands, the TLS-truststore workaround, and — most importantly — the keystore backup warning, since it previously only documented the (never-actually-used) Android-Studio-GUI signing path.

### 12.2 `/delete-account` page (commit `af8181b`)
Uploading the Wholesale app to Play Console surfaced a requirement distinct from the privacy policy and the in-app deletion flow already built in §7: Google Play's store listing wants a **public URL** specifically for account deletion, which must name the app/developer, prominently show the steps, and state what's deleted vs. retained with any retention period. Built `delete-account.html` (plain static HTML, no JS dependency, same reasoning as the original Google-OAuth-branding fix — reviewers may not execute JS), routed at `/delete-account` via `vercel.json`, covering:
- Wholesale: the in-app self-service steps (Profile → Privacy & Account → Delete My Account → type DELETE), plus an email fallback (`contactus@rubyfoodhub.com`, 7-day processing) for users who can't sign in.
- Admin: staff-account removal by email (these aren't self-service accounts).
- What's deleted immediately vs. what's retained (anonymized order/payment records, ~7-year tax/accounting retention) — matching exactly what §7's `delete-account` backend action actually does, not aspirational copy.
Cross-linked from the privacy policy's deletion section. **Use this same URL for both apps' Play Console "Delete account URL" field.**

### 12.3 Package name corrections (commits `d2c3d85`, `d43ec45`)
Both apps were originally scaffolded with lowercase, standard-convention package names (`com.rubyfoodhub.wholesale`, `com.rubyfoodhub.admin`). When the user actually created each app's entry in Play Console, they had (independently, outside this repo/session) set different package names — `com.rubyfoodhub.retailer` for Wholesale and `com.Ruby.FoodHub.Admin` (non-standard capitalization) for Admin. **A Play Console app entry's package name is permanent once set** — there's no renaming it on Google's side — so both times the fix was to rename the *build* to match the already-created listing, not to create a new listing.

Each rename touched every location a package/bundle ID appears: `capacitor.config.json` `appId`, the Gradle `namespace`/`applicationId`, the `MainActivity.java` package declaration **and its file path** (Java package = directory structure, so e.g. `com/rubyfoodhub/wholesale/MainActivity.java` physically moved to `com/rubyfoodhub/retailer/MainActivity.java`), `strings.xml`'s `package_name`/`custom_url_scheme`, and iOS's `PRODUCT_BUNDLE_IDENTIFIER` in `project.pbxproj` (untouched practically since iOS isn't being built, but kept consistent for whenever it is).

After each rename: `rm -rf android/app/build` (OneDrive file-lock issue, see §8.16) then a full `./gradlew bundleRelease`, then **verified the actual built manifest** (not just "the build succeeded") — `grep`'d the merged `AndroidManifest.xml` inside `build/intermediates/bundle_manifest/release/.../AndroidManifest.xml` for the `package=` attribute and the `MainActivity` reference, confirming an exact string match including the Admin app's capitalization, before telling the user which file to upload.

Signing was unaffected by either rename — the keystore is tied to the app/Console entry, not to the package name string.

### 12.4 Play Store listing graphics (commits `fa972f8`, `aab7381`)
Play Console's app-bundle upload flow doesn't require store graphics, but the **production** listing does, and separately Google runs an automated content-quality check against them. Two rounds:

**Round 1** (`fa972f8`): generated `store-icon-512.png` (512×512) and `feature-graphic.png` (1024×500) for both apps from the existing logo mark — a straightforward logo + app-name + tagline lockup, cream background for Wholesale, charcoal for Admin. Both verified as the correct dimensions with **no alpha channel** (Play rejects icons/feature graphics with transparency, a common trip-up since the in-app launcher icons *do* have alpha).

**Round 2** (`aab7381`): Google's review of the Wholesale app came back with *"Your store listing does not clearly describe your app's features... the feature graphics are placeholder images or stock photos that do not show the in-app experience."* The round-1 feature graphic — logo/text only — qualified as exactly that. Fix: sampled the **real, live** app colors via the browser tool's `javascript_tool` (`canvas.getImageData` after setting `fillStyle` to the site's actual CSS, since `getComputedStyle` returned the raw unresolved `oklch()` string rather than RGB in this browser — button `#9E122B`, background `#FDF3EB`, both traced back to the site's `oklch(0.45 0.17 20)` / `oklch(0.97 0.015 60)` CSS values), then rebuilt both feature graphics as a phone-mockup illustration of the **actual verified sign-in screen** (matching card layout, field labels, and button text confirmed via real screenshots taken through the browser tool during this session) rather than generic marketing art.

**A real tooling limit surfaced here and is worth remembering**: the browser tool available in this environment can *render and view* pages (confirmed real screens, real colors, real layout) but has **no mechanism to export those pixels to a file on disk**. This is why the feature graphic fix had to be a faithful hand-drawn recreation (via .NET `System.Drawing`, matching sampled real values) rather than a composited real screenshot, and it's also why **actual screenshot files for the Play listing could not be produced from this environment at all** — see §8.10 and §9.3. If this limitation is ever lifted (a tool that can save a browser screenshot to disk), revisit this — it would let the feature graphics use genuine screenshots instead of recreations, which is stronger evidence for Google's review than even an accurate recreation.

### 12.5 Android 16 (API 36) targeting (commit `24622db`)
The Wholesale app's **production** submission came back from Google Play review with a policy flag: *"App must target Android 16 (API level 36) or higher... From Aug 30, 2026, if your target API level is not within 1 year of the latest Android release, you won't be able to update your app."* Both apps were targeting API 35.

Fix: installed `platforms;android-36` and `build-tools;36.0.0` via the same `sdkmanager` pipeline from §12.1 (same TLS workaround needed again), bumped `compileSdkVersion`/`targetSdkVersion` from 35 to 36 in **both** apps' `android/variables.gradle` (shared by the whole project, not per-app duplicated logic — a lucky existing structure that made this a two-line change), left `minSdkVersion` at 23 untouched (confirmed via manifest diff that this doesn't drop any device support — see §12.6), bumped `versionCode`/`versionName` in each app's `android/app/build.gradle` (Wholesale 2→3, Admin 1→2; both to `versionName "1.1"`), rebuilt, and **verified the built manifest's `targetSdkVersion="36"` attribute directly** rather than trusting the Gradle config alone.

**As of this doc's update, these rebuilt bundles have been handed to the user with upload instructions but their upload to Play Console has not been confirmed.** This is §9's top item.

### 12.6 Play Console troubleshooting notes worth keeping
A few Play Console mechanics came up as real errors during this session and are worth remembering rather than rediscovering:
- **`versionCode` must strictly increase on every upload** — re-uploading the same `.aab` after a rejected/errored release attempt fails with "version code already used." If a bundle was already successfully uploaded to *any* track for an app, reuse it via Console's **"Add from library"** control rather than rebuilding — no new `versionCode` needed for that.
- **An empty release (no bundle attached) throws confusing device-support-loss errors** (a real one seen: "-100%... 20,159 devices... will not be available") — the fix is just attaching a bundle, not a real device-compatibility regression.
- **The "no deobfuscation file" warning is expected and harmless** for this project — `minifyEnabled false` in both apps means there's no R8/ProGuard mapping file to upload, and Play shows this warning on every unobfuscated bundle. It never blocks a release; only **errors** do.
- **Release notes must start with a language tag as literally the first character** (`<en-US>...</en-US>`, matching a language actually added to the listing) — a leading blank line or space before the tag throws "text outside language tags."
- **Device-compatibility verification technique used**: rather than trusting config, directly diffed the built bundle manifests' `minSdkVersion`/`targetSdkVersion` between apps, and checked `uses-feature`/`uses-permission`/native `.so` library count inside the actual `.aab` (both apps: zero hardware features declared, `INTERNET` the only permission, zero native libraries) — this is what actually determines Play's device-count filtering, not just the SDK version numbers.

### 12.7 Verification performed this session
- Every backend/config change checked at the actual artifact level, not just "the command didn't error": `jarsigner -verify` on both signed `.aab` files (both returned "jar verified"), `grep`-extracted `package=`/`versionCode=`/`targetSdkVersion=` from the real merged manifest inside each build output after every rename and every SDK bump, `git status` confirmed before every commit that no keystore/password file was ever staged.
- Live-sampled real CSS values from the running production site via the browser tool rather than eyeballing colors from a screenshot.
- Confirmed via `diff` that both apps' `variables.gradle` files are identical and that neither app declares any hardware feature/permission beyond `INTERNET`, supporting the "same device compatibility" answer given to the user.
- **Not verified**: whether either app's rebuilt (`versionCode 3` / `versionCode 2`, API 36) bundle has actually been uploaded to Play Console — this requires the user to do it and confirm back. See §9.1.
- **Not possible from this environment**: exporting real screenshot files (§12.4), anything iOS-related (§8.9).

---

*Historical sections above (through §12) are carried over unchanged from `July Action.md` at the point this file was forked (2026-07-22, commit `fc44664`). All commits referenced through §12 are on `main` and pushed to `github.com/rubyfoodhubinc/ruby-foodhub`. The keystore files and their passwords are deliberately NOT in this repo — see §12.1 — back them up outside git; this doc never repeats the actual password values.*

---

## 13. Daily update log (automated — see top-of-file note)

This section is appended to by a scheduled agent every day at **12:00 AM America/New_York**. Each entry should summarize what changed in the repo (`git log` since the previous entry) and refresh anything in §1–§9 above that drifted stale (migration status, app submission state, open blockers) — it should **not** just restate old commits. If a day has zero commits and zero state changes, the entry says so in one line rather than being skipped, so a gap in this log always means the automation itself failed (see the retry rule below), never "nothing happened."

**If the midnight run fails for any reason** (no git changes to inspect yet, environment unavailable, etc.), it retries **at the next earliest opportunity** rather than waiting for the next scheduled midnight — that retry, whenever it lands, is still logged as that calendar day's entry.

<!-- New entries are appended below this line, newest last. -->

### 2026-07-22 — automation initialized
`RubyFood Action.md` forked from `July Action.md` (commit `fc44664`) and the daily update routine was scheduled. No repo changes to report yet beyond the fork itself. First automated entry expected 2026-07-23 00:00 America/New_York.

### 2026-07-23 — iOS App Store work (the Windows-era blocker is gone)
This session ran on a **Mac** with a synced clone of the repo, which clears the single largest gap every prior session flagged: iOS could not be built at all on the old Windows machine. Major progress on the iOS front plus two production bug fixes.

**Commits pushed to `main` this session:**
- `154db52` — stop iOS zooming into form fields on both portals. iOS force-zooms into any form control with text under 16px and never zooms back, which left the layout panned sideways with the header/buttons clipped. Found live in the Simulator. Fixed for touch devices only via `@media (pointer: coarse)` bumping controls to 16px; desktop type scale untouched. Also added `ITSAppUsesNonExemptEncryption=false` to both iOS `Info.plist`s, and committed the CocoaPods workspace/lockfiles from the first Mac `cap sync ios`.
- `3a5ed03` — stack retailer tables into cards under 620px. The order/catalog/stock tables were wider than a phone and side-scrolled, hiding the column a row described (e.g. product name scrolled off before you reached its qty box). `labelCells()` stamps each `<th>` onto its cells as `data-label`; CSS turns each row into a labelled card on narrow screens. iPad still renders the full table.

Both fixes affect the **live web portals too**, not just the apps — pushed to `main` (Vercel auto-deploys).

**iOS apps — both uploaded to App Store Connect, build 1.0 (1):**
- Node installed, both Capacitor iOS projects synced, iOS 26.1 SDK downloaded into Xcode 26.1.1. Both apps archived + signed with a **Cloud Managed Apple Distribution** cert (team `R7A65YU39K`, RUBYNAV INC) and uploaded via `altool` with an App Store Connect API key (Key ID `992P7733ZH`, key saved at `~/.appstoreconnect/private_keys/`). Both builds show **Ready to Submit**.
- **Admin app record created** in App Store Connect (`com.Ruby.FoodHub.Admin`, SKU `rubyfoodhub-admin`) — previously only Wholesale existed.
- Decisions locked: **Wholesale → public App Store**, **Admin → TestFlight only** for staff (per §8.12 internal-tool concern).

**Screenshots captured** (old doc listed this as a permanent env gap — no longer true on the Mac): 5 iPhone (1320×2868) + 4 iPad (2064×2752), at `~/Desktop/RubyFoodHub-iOS-builds/screenshots/`. Listing copy drafted at `~/Desktop/RubyFoodHub-iOS-builds/LISTING-COPY.md`.

**Migration 014 CONFIRMED APPLIED in production** — the retailer app displays `Batch: ABTCHIGH` on order `MONE07212026-08`, direct evidence the `production_batch` column exists. Resolves the top open question in §4/§8.1 for 014. (013/account-deletion still not independently verified.)

**Admin TestFlight:** internal group "Ruby FoodHub Staff" created, build attached. 3 testers invited and active (one already installed on a real iPhone 17 Pro): `widokpesi@icloud.com`, `rubynavinctech@gmail.com`, `dianadopsy@gmail.com`.

**Still open / needs the owner:**
- **Wholesale listing not submitted.** Browser automation could not type into App Store Connect's fields (verified 3 ways — nothing saved), and screenshot upload needs the native macOS file picker. The owner must fill the listing by hand from `LISTING-COPY.md`, drag in the screenshots, attach build 1.0 (1), add the demo-account password (`moneymarttvllc@gmail.com`) to App Review notes, complete App Privacy + age rating, set price Free, then Submit.
- **Wholesale app has a stray macOS platform** in "Prepare for Submission" — delete it from the sidebar (won't block iOS).
- **6 more Admin testers requested but only partially added** — 2 created (`ladydokpesi@icloud.com`, `dianadokpesi@gmail.com`, both got Marketing+Sales, not yet in a TestFlight group); 4 not created. Adding external users to forms was blocked by a safety guardrail this session.
- **iOS demo password** for App Review still needed from owner.
