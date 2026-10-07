# Car Spotter

Single-repository deployment:

- **Frontend:** `public/` is deployed automatically to GitHub Pages.
- **Backend:** `server.js` is an API-only Node.js server deployed to Render.
- **Firebase:** authentication and Firestore are used directly by the browser.
- **iCloud:** the Render backend talks to the public iCloud shared album, keeping the album token off the frontend.

## Local development

Create `.env` from `.env.example` and set `ALBUM_TOKEN`. Then:

```bash
npm start
```

The Node server only provides the API; it no longer serves the frontend. For local frontend testing, use any static HTTP server from the project root, for example:

```bash
python3 -m http.server 8080 -d public
```

Then open `http://localhost:8080`.

## GitHub Pages + Render deployment

### 1. GitHub Pages

Push the repository to GitHub. The included `.github/workflows/deploy-pages.yml` deploys the `public/` directory automatically whenever `main` changes.

In GitHub, open **Settings -> Pages** and set **Source** to **GitHub Actions**.

After the first deployment, your frontend will normally be available at:

```text
https://YOUR_GITHUB_USERNAME.github.io/car-spotter/
```

If the repository is named differently, use that repository name in the URL.

### 2. Configure the frontend API URL

Edit `public/api-config.js` and replace:

```js
https://YOUR-RENDER-SERVICE.onrender.com
```

with the URL of your Render Web Service. Commit and push the change.

### 3. Render

Create a **Web Service** from the same GitHub repository. Render can use:

- Build command: `npm install`
- Start command: `npm start`

Set these environment variables in Render:

```text
ALBUM_TOKEN=...
ALLOWED_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io
```

Do not put the real `ALBUM_TOKEN` in GitHub.

Render should deploy the same repository but only run `server.js`; it does not need to serve `public/`.

### 4. Firebase

The Firebase web configuration in `public/firebase-config.js` is intentionally public. Keep Firebase security rules in `firestore.rules` and configure your allowed authentication/domain settings in Firebase Console.

## Architecture

```text
Browser
  |\
  | \-- Firebase Auth / Firestore
  |
  +----> GitHub Pages (public/)
  |
  +----> Render (server.js -> /api/album) -> iCloud shared album
```

If Render is asleep, GitHub Pages still serves the complete frontend. Only an API request that needs the Node backend waits for Render to wake up.
