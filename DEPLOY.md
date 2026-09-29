# Deploying TipNet

Two free options. GitHub Pages is recommended because updates deploy automatically.

## Option 1: GitHub Pages (recommended)

You will publish the **whole `tipnet` folder** (not just `app/`). The folder includes a
workflow file (`.github/workflows/deploy.yml`) that runs the tests and publishes the `app/`
folder for you. If you upload only the contents of `app/`, nothing gets deployed.

### Step 1: Create a GitHub account (skip if you have one)
1. Go to https://github.com and click **Sign up**.
2. Pick a username. It becomes part of your link (`https://USERNAME.github.io/tipnet/`).
3. Confirm your email.

### Step 2: Publish the folder

**Easiest: GitHub Desktop** (https://desktop.github.com)
1. Install GitHub Desktop and sign in with your GitHub account.
2. **File > Add local repository...**
3. Choose `C:\Users\jusst\tipnet` and click **Add repository**. (It is already a git repository, so you do not need to create one.)
4. Click **Publish repository** (top bar).
5. Keep the name `tipnet`. **Uncheck "Keep this code private"** (GitHub Pages is free only for public repositories).
6. Click **Publish repository**.

**Alternative: upload in the browser**
1. On github.com click **+** (top right) > **New repository**.
2. Name it `tipnet`, choose **Public**, leave "Add a README" unchecked, click **Create repository**.
3. Click **uploading an existing file**.
4. Open the `tipnet` folder in File Explorer, select **every** file and folder (`app`, `tests`, `.github`, `package.json`, the `.md` files, and so on) and drag them onto the page.
   - `.github` is a hidden folder. In File Explorer, turn on **View > Show > Hidden items** so you can see and drag it. Without it nothing deploys.
5. Click **Commit changes**.

### Step 3: Turn on GitHub Pages
1. In your repository click **Settings** (top bar).
2. In the left sidebar click **Pages**.
3. Under **Build and deployment > Source**, choose **GitHub Actions**.

### Step 4: Run the deploy
1. Click the **Actions** tab.
2. The first run (from Step 2) may show a red X. That is expected: Pages was not turned on yet.
3. Click **Deploy to GitHub Pages** in the left list.
4. Click **Run workflow** (right side) > **Run workflow**.
5. Wait for the green check (about 1 to 2 minutes).

Your app is live at **https://USERNAME.github.io/tipnet/** (replace USERNAME with your GitHub username). Share this link with staff.

### Updating later
Commit and push changes (GitHub Desktop: **Commit to main**, then **Push origin**). The workflow deploys automatically. Bump `VERSION` in `app/sw.js` for each release so staff see "Update available: Refresh".

---

## Option 2: Netlify Drop (quick test link)

1. Go to https://app.netlify.com/drop.
2. Drag the **`app` folder** (the one containing `index.html`) onto the page.
3. Netlify gives you a link like `https://random-name.netlify.app/`.

Drops without an account are temporary. Create a free account and claim the site to keep the link. To update, drag the `app` folder again onto the site's **Deploys** page.

---

## Notes

- **HTTPS is required** for offline use and install. Both hosts use HTTPS.
- **Same link after updates.** Staff do not need a new link when you redeploy.
- **Custom domain** (like `tipnet.your-bar.com`) is supported by both, but you must own the domain.

---

## Troubleshooting

**Actions shows a red X on the first run**
Expected if Pages was not enabled yet. Do Step 3, then Step 4 (Run workflow).

**No "Deploy to GitHub Pages" workflow in the Actions tab**
The `.github` folder was not uploaded. Upload it (show hidden items in File Explorer), or use GitHub Desktop, which includes it automatically.

**The test job fails**
Open the failed run to see which test failed. Fix it locally (`npm test`), then push again.

**"404 / Page not found" at the link**
- Check Settings > Pages says "Your site is live at ...". If not, run the workflow again (Step 4).
- The link ends in `/tipnet/` and must match the repository name exactly.
- Wait a minute after a green check; the first publish can lag.

**Staff still see the old version**
They get an "Update available: Refresh" bar. If you forgot to bump `VERSION` in `app/sw.js`, bump it and push again.

**Need help?** GitHub: https://docs.github.com/pages. Netlify: the **Support** link in the dashboard.
