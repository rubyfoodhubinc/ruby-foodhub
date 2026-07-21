# Ruby FoodHub — Native Apps (Capacitor)

Two separate native apps wrap the existing portals:

| App | Folder | App ID | Wraps |
|---|---|---|---|
| Ruby FoodHub Admin | `admin-app/` | `com.rubyfoodhub.admin` | `admin.html` |
| Ruby FoodHub Wholesale | `retailer-app/` | `com.rubyfoodhub.wholesale` | `retailer.html` |

## How it works

- The portal page is **bundled into the app** (`www/index.html`), not loaded
  from a URL. `sync-www.js` copies the current `admin.html` / `retailer.html`
  plus their images from the repo root.
- Inside the app, the page detects Capacitor and points every API call at
  `https://www.rubyfoodhub.com` (see `API_BASE` in each HTML file). On the
  website nothing changes.
- The API answers the app's cross-origin requests via `api/_lib/cors.js`
  (allowed origins: `capacitor://localhost`, `https://localhost`).
- Stripe checkout opens in the device browser; the webhook still marks the
  order paid, and the app shows it on the next refresh.

## Day-to-day workflow

After changing `admin.html` / `retailer.html` on the website, refresh the
app bundles (run inside `apps/admin-app` and/or `apps/retailer-app`):

```
npm run sync        # rebuild www/ from repo root + cap sync into android/ios
```

Then rebuild/re-release the app **only if you want the new UI inside the
app** — the API/backend always updates instantly for existing app installs
since data comes from the live site.

## Building

Android (works on Windows — requires Android Studio):

```
npm run open:android    # opens the project in Android Studio
# Build > Generate Signed App Bundle (.aab) for the Play Store
```

iOS (**requires a Mac** with Xcode + CocoaPods — cannot be built on Windows):

```
npm install && npm run sync
npm run open:ios        # opens the project in Xcode
# Product > Archive, then distribute via App Store Connect
```

## App icons & splash screens

Native projects currently use the default Capacitor icons. Generate real
ones from a 1024×1024 logo (run inside each app folder):

```
npm install -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#ffffff'
```

with `assets/icon.png` (1024×1024) and optionally `assets/splash.png`
(2732×2732) placed in an `assets/` folder first.
