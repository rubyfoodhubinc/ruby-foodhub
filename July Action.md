# Ruby FoodHub — Engineering Handoff Note
**Prepared by:** outgoing session (acting as Chief Engineer for this stretch of work)
**Date:** July 2026 (session ending 2026-07-21)
**Last updated:** 2026-07-21 (afternoon/evening session — payment-push changes, layout fix, app icons, retailer-scoped order numbers, production batch tracking; commits `d194889`, `8910150`, `ae3c83b`, `340745f`, `a79512a`; see §10 and §11)

> ⚠️ **ACTION REQUIRED BEFORE SHIPPING ORDERS:** migration `014_production_batch.sql` must be run in the Supabase SQL Editor. Batch entry fails until it is. See §4.
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
| **013** | **`013_account_deletion.sql`** | **`account_status` gains `'closed'`; `deleted_at` column** | ⚠️ **NEEDS VERIFICATION — confirm this has been run in Supabase before relying on account deletion in production** |
| **014** | **`014_production_batch.sql`** | **`wholesale_orders.production_batch` column (8-char batch key)** | 🔴 **NOT RUN — written 2026-07-21, handed to the owner to run. Required before any order can be marked delivered/fulfilled.** |

**→ First task for next analyst: run migration 014, then confirm 013 has been run.**

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

## 6. Capacitor native apps (added this session) — STATE: scaffolded, NOT submitted

Two separate app projects under `apps/`:

| App | Folder | Bundle ID | Wraps |
|---|---|---|---|
| Ruby FoodHub Admin | `apps/admin-app/` | `com.rubyfoodhub.admin` | `admin.html` |
| Ruby FoodHub Wholesale | `apps/retailer-app/` | `com.rubyfoodhub.wholesale` | `retailer.html` |

Each app bundles its portal page as `www/index.html` (via `sync-www.js`, gitignored output) rather than loading a live URL — better for store review. Both `android/` and `ios/` native projects have been generated (Capacitor 7) and verified: correct bundle IDs, correct app display names, and the API-base shim present in all four bundled copies.

**Web-side changes made to support this** (website behavior unchanged — these are no-ops in a normal browser):
- `API_BASE` shim in `admin.html`/`retailer.html`: routes all API calls to `https://www.rubyfoodhub.com` when running inside the Capacitor webview (`window.Capacitor.isNativePlatform()`), otherwise stays same-origin.
- `api/_lib/cors.js`: answers CORS preflight for the app's webview origins (`capacitor://localhost`, `https://localhost`), wired into all 12 portal endpoints. Auth is a session token in the request body, never a cookie, so this doesn't create a credential-exposure risk.
- `api/retailer-portal.js`: Stripe success/cancel return-URLs no longer trust `capacitor://localhost` as an origin — they fall back to the live site so payments started inside the app return somewhere valid.

Full day-to-day workflow (rebuilding `www/`, opening in Android Studio/Xcode) is documented in **`apps/README.md`** — read that before touching the app folders.

### What is NOT done for the apps
- ~~App icons~~ **DONE (2026-07-21, commit `8910150`)**: real logo artwork generated via `@capacitor/assets` for both apps (dark background for Admin, light for Wholesale), Android + iOS sets committed, `cap sync` run. Source artwork lives in `apps/*/assets/`.
- No screenshots, no store listings, no Data Safety/App Privacy forms filled in on either console.
- No signed builds produced (no keystore created yet for Android; no Xcode archive — also iOS **cannot be built on this Windows machine**, needs a Mac).
- No demo reviewer credentials created (dedicated demo admin + demo retailer accounts).

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

---

## 8. Known gaps / things to watch

1. **Migration 014 NOT RUN** — see §4. This blocks marking orders delivered/fulfilled. Run it first.
2. **Migration 013 run-status unconfirmed** — see §4. Verify before relying on account deletion.
3. **Partial live verification** — the 2026-07-21 sessions click-tested the new retailer UI (payment options, due banner, pay modal, layout containment) in a real browser against a local static server and confirmed the new markup deployed to production; the order-number generator was unit-tested directly. Still **not** exercised end-to-end with real money/data: retailer account deletion, the cash/Zelle claim → confirm/reject cycle, the billable stock-in path (order insert + stock movement + email), Stripe checkout for a placed order, and **a real order insert under the new numbering + batch flow** (needs migration 014 first). Recommend a logged-in click-through of those before leaning on them hard.
4. **Order-number serial is a live COUNT, not a stored counter** — `insertWholesaleOrder()` counts the retailer's existing orders (including canceled ones) and adds 1. That is deliberate (numbers stay meaningful and gap-free per retailer), but it means: hard-deleting an order row would let a future order reuse a number, and two simultaneous orders rely on the `unique` constraint + retry. Don't hard-delete wholesale orders; cancel them.
5. ~~App icons~~ **cleared 2026-07-21** — see §6; remaining store blockers are signed builds, listings, and Mac access for iOS.
6. **iOS build requires a Mac** — cannot be done from this Windows machine at all. Needs a borrowed Mac, MacinCloud, or a CI service like Codemagic.
7. **Admin app should likely not be a public store listing** — Apple tends to reject internal/staff-only tools from the public App Store. Recommended path: Apple's "Unlisted App Distribution" or TestFlight-only; Google Play closed testing track. This was flagged to the user but no submission-track decision has been made yet.
8. **Google Play new personal accounts** require a 14-day/12-tester closed test before going to production; enrolling as an *organization* (recommended, already advised) skips this.
9. The Wholesale app being a wrapped web view carries some risk of Apple's "minimum functionality" (guideline 4.2) pushback on first submission — if it happens, the standard fix is adding one native capability (push notifications for order status was the suggested candidate, not yet built).
10. **The sandboxed shell on this machine cannot make outbound TLS connections** — `curl` fails even against github.com, though `git push` works. Use the in-app browser (Claude Browser tools) for any live-site verification; don't conclude the site is down from a failed `curl`.

---

## 9. Immediate next steps, in priority order

1. **Run migration 014 in Supabase** (one line, see §4). **Blocking** — until it's run, admins cannot mark orders delivered or fulfilled.
2. **Verify migration 013 ran in Supabase.** (5 minutes — still unconfirmed as of 2026-07-21.)
3. **Place one real test order** after 014 is run, and confirm: the number comes out as `XXXX MMDDYYYY-NN` for that retailer, the batch field accepts 8 characters and rejects anything else, and the batch shows on both the admin and retailer views plus the delivery email.
4. **Live-verify with a real login** the remaining flows in §8.3: cash/Zelle claim → confirm/reject, billable stock-in, Zelle order placement, account deletion.
5. Pick up the still-open App Store submission checklist: developer account enrollment (org, not personal), signed Android build + keystore, Mac access for iOS, store listing content + screenshots (icons are now real, so screenshots can be taken), demo reviewer credentials, Data Safety/App Privacy form answers, and a distribution-track decision for the Admin app (unlisted/TestFlight vs. public).
6. No other feature work is currently requested or pending. Confirm with the user before starting anything not on this list.

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

*End of handoff note. All commits referenced above are on `main` and already pushed to `github.com/rubyfoodhubinc/ruby-foodhub`. Nothing is stashed or uncommitted as of the 2026-07-21 evening update.*
