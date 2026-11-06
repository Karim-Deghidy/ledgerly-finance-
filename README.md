# Ledgerly — Personal Finance Tracker

A lightweight, responsive personal finance web app (PWA) designed for GitHub Pages and Firebase Firestore.

## Features

- Track income, salary, expenses and transfers.
- Create as many cash wallets and bank-card accounts as you need.
- Rename accounts, change their type, edit opening balances and colours.
- Archive accounts to hide them while preserving their history.
- Delete accounts. If an account has linked transactions, the app asks you to archive it or permanently delete the account and those linked transactions.
- Calculate balances automatically from opening balances and recorded transactions.
- Transfers update both account balances and are not counted as income or expenses.
- Monthly budgets by category, spending breakdowns, six-month cash-flow chart and helpful summaries.
- Search and filter transactions; edit or delete entries.
- Export transactions to CSV and create/restore a JSON backup.
- Installable on iPhone and Android as a Progressive Web App.
- Firebase Firestore cloud sync without a sign-in screen.

## 1. Configure Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project.
2. In **Project settings → General → Your apps**, add a Web app.
3. Copy the Firebase web configuration object.
4. Open `firebase-config.js` and replace the placeholder values with your project's values. Keep the object keys as they are.
5. In Firebase Console, open **Firestore Database** and create a database.
6. Open the Firestore **Rules** tab and publish the contents of `firestore.rules`.
7. Reload the deployed app. The app creates a private Vault automatically and starts syncing to Firestore.

The Firebase web config is public client configuration, not a password. Do not put service-account keys or private server credentials in this repository.

## 2. Publish on GitHub Pages

1. Create a new GitHub repository, for example `ledgerly-finance`.
2. Upload all files and folders in this project to the repository root. Do not upload your private Vault ID.
3. In the repository, open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Choose your main branch and the `/ (root)` folder, then save.
6. Wait for GitHub Pages to publish the site. Open the generated URL over HTTPS.

You can also deploy with GitHub Actions if you prefer, but a static root deployment is sufficient.

## 3. Install on your phone

### iPhone

1. Open the GitHub Pages URL in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Open Ledgerly from the new Home Screen icon.

### Android

Open the site in Chrome and choose **Install app** or **Add to Home screen** from the browser menu.

## 4. Use the same data on another device

1. On the first device, open **Sync & backup** and copy the Vault ID.
2. On the second device, open the same configured GitHub Pages URL. It already uses the same Firebase project configuration.
3. Open **Sync & backup**, paste the first device's Vault ID into **Use an existing Vault ID**, and connect.

Keep the Vault ID private. Anyone who has it can access and modify that Vault.

## Important security limitation — no authentication

This app intentionally has no login or registration. To make no-login syncing possible, it uses a cryptographically random Vault ID (48 hexadecimal characters) as a bearer-style access key. The Firestore rules block listing the top-level Vault collection, but anyone who obtains a Vault ID can read, change or delete that Vault's data. Do not publish the Vault ID, put it in source code, or share it publicly.

This is a convenience-focused personal tracker, not a bank-grade secure finance system. If you later need stronger access control, enable Firebase Authentication (including silent anonymous sign-in or a real sign-in method) and restrict Firestore rules to authenticated owners. Firebase App Check can also help reduce automated abuse, but it does not replace authentication.

## Local mode

If `firebase-config.js` still contains placeholders, Ledgerly runs in local-only mode and saves data in that browser's local storage. Local data stays on that device/browser. When Firebase is configured for the first time, the app attempts to migrate the existing local accounts, transactions and budgets into the new Vault.

## Currency

The interface currently displays amounts in EGP. Change the `money()` formatter in `app.js` if you want another currency.

## Project files

- `index.html` — application layout
- `styles.css` — responsive light theme
- `app.js` — application logic and Firestore integration
- `firebase-config.js` — your Firebase web configuration
- `firestore.rules` — Firestore security rules for Vault-ID access
- `manifest.webmanifest` — installable PWA metadata
- `sw.js` — app-shell service worker
- `assets/icon.svg` — application icon
