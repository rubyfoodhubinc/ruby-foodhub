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

## Building Android — from the command line (no Android Studio needed)

This works on Windows. Requires JDK 21 (Capacitor 7's Android module targets
Java 21 — a separate JDK 17 also works for running Gradle itself, but 21 is
simplest since it covers both) and the Android SDK command-line tools
(platform-tools, `platforms;android-35`, `build-tools;35.0.0`).

If `dl.google.com` / Maven fail with a Java `PKIX path building failed`
error but work fine in a browser or `curl`, this environment has a
TLS-inspecting proxy whose root CA Windows trusts but Java's separate
cacerts store doesn't. Point Java at the Windows trust store instead of
installing anything: `set JAVA_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`
(and `GRADLE_OPTS` to the same for Gradle itself).

```
npm run sync                     # rebuild www/ and sync into android/
cd android
./gradlew assembleDebug          # unsigned debug APK — good for sanity checks
./gradlew bundleRelease          # signed .aab — what you upload to Play Console
```

`bundleRelease` needs `android/keystore.properties` (git-ignored, see below)
pointing at a real upload keystore — without it the release build produces
an **unsigned** bundle Play Console will reject.

### The upload keystore — read this before doing anything else with it

Each app has its own keystore (`android/rubyfoodhub-admin-upload.jks` and
`android/rubyfoodhub-wholesale-upload.jks`), generated once with:

```
keytool -genkeypair -v -keystore <name>-upload.jks -alias <alias> \
  -keyalg RSA -keysize 2048 -validity 10957 -storetype PKCS12
```

**This keystore IS the app, forever.** Losing it — or losing the password —
means you can never publish an update to that app again; you'd have to ship
it as a brand-new listing with zero reviews and zero installs. Google
cannot recover it for you. Right now:

1. Back up both `.jks` files AND `keystore.properties` (which holds the
   passwords) to somewhere outside this machine — a password manager that
   supports file attachments, or encrypted cloud storage. Today, not later.
2. Never commit them — `.gitignore` already excludes `apps/*/android/*.jks`
   and `apps/*/android/keystore.properties`, so a normal `git add` /
   `git commit` is safe, but don't override that.
3. If you ever move to a new machine, copy both files over — `npm install`
   alone will not bring them back.

## Building iOS

**Requires a Mac** with Xcode + CocoaPods — Apple does not allow building,
signing, or archiving an iOS app anywhere else, no exceptions.

```
npm install && npm run sync
npm run open:ios        # opens the project in Xcode
# Product > Archive, then distribute via App Store Connect
```

## App icons & splash screens

Generated via `@capacitor/assets` from the Ruby FoodHub logo mark — white
background for Wholesale, charcoal (`#241F1B`) for Admin, so the two are
instantly distinguishable on a home screen. To regenerate after a logo
change, put a 1024×1024 source in `assets/icon.png` (per app) and run:

```
npm install -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#241F1B'
```
