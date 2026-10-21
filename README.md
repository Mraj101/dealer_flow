# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
# dealer_flow
# dealer_flow

## Android app (Capacitor)

The web app is wrapped as an Android app. It keeps its own database on the phone and syncs to Supabase.

One-time setup on the computer that builds it:
1. Install [Android Studio](https://developer.android.com/studio) (it brings the JDK and the Android SDK).
2. On the phone: Settings > About phone > tap "Build number" 7 times, then Developer options > turn on USB debugging.

Each time you want a new build:
```
pnpm android:sync     # builds the web app and copies it into the Android project
pnpm android:open     # opens the project in Android Studio
```
In Android Studio press Run (▶) with the phone plugged in, or Build > Build APK(s) and send the APK to the phone.

Notes
- The first launch needs internet once, to download your data. After that it works with no signal.
- The app's database is separate from the browser's. Let the browser show "All synced" before you switch phones/browsers, or unsent entries stay behind.
- `appId` in `capacitor.config.json` identifies the app on the phone. Change it before the first install, not after.
- Debug the phone's app from Chrome on the computer: open `chrome://inspect`.

## Tests
```
pnpm test          # money, local database rules, sync (12 of these need a Postgres, see below)
pnpm test:e2e      # the built app in real Chrome against a fake Supabase (never touches your real one)
```
The sync tests run against a throwaway Postgres with supabase/01-09 applied: set `PG_TEST_URL=postgres://user@host:port/db` and give the `authenticated` role access to the tables.
