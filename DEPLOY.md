# Deploying TipNet

Choose one method below. Both are free and take about 5 minutes.

## Option 1: GitHub Pages (recommended)

GitHub Pages gives you a URL like `https://YourUsername.github.io/tipnet/` that you can share with your staff. It's free and automatic.

### Step 1: Create a GitHub account (if you don't have one)
1. Go to github.com
2. Click **Sign up**
3. Enter your email, create a password, choose a username (this will be in your TipNet link)
4. Click **Create account**
5. Confirm your email

### Step 2: Create a new repository
1. Click the **+** icon in the top right and choose **New repository**
2. Name it `tipnet` (exactly)
3. Choose **Public** (so your staff can access it)
4. Do NOT initialize with a README (you already have one)
5. Click **Create repository**

### Step 3: Upload the app folder
1. In the new repository, click **Add file** → **Upload files**
2. Click **choose your files** and select everything in your `app/` folder (the index.html, css/, js/, manifest.webmanifest, etc.)
3. Scroll down and click **Commit changes**

The app is now uploaded. GitHub's automatic workflow will deploy it in a few seconds.

### Step 4: Enable GitHub Pages
1. In your repository, click **Settings** (top right)
2. On the left sidebar, click **Pages**
3. Under "Build and deployment," make sure **Source** is set to **GitHub Actions**
4. Wait 1 minute

Your site is live at `https://YourUsername.github.io/tipnet/`. Share this link with your staff.

---

## Option 2: Netlify Drop (free account to keep the link)

Netlify Drop lets you drag and drop the app folder and get an instant link. Perfect if you want to test before using GitHub.

### Steps
1. Go to app.netlify.com/drop in your browser
2. Drag your `app/` folder (the one with index.html, css/, js/, etc.) onto the page
3. Wait for the upload (a few seconds)
4. Netlify gives you a random link like `https://random-name.netlify.app/`

The app is live immediately. You can share this link, but Netlify may delete it after some time if you don't create an account. For a permanent link, log in and claim your site.

---

## Notes

- **HTTPS required**: Both GitHub Pages and Netlify use HTTPS, which is required for the app to work offline.
- **Update the link**: If you redeploy (upload new files), the same link stays active. Your staff don't need a new link.
- **Custom domain**: Both hosts support custom domains (like `tipnet.your-bar.com`), but you'll need to own the domain and pay a small annual fee. The free links above work great.

---

## Troubleshooting

**"Page not found" after deploying**

Make sure you uploaded the *contents* of the `app/` folder, not a folder inside a folder. The `index.html` should be at the top level of your repository or drop, not nested.

**If you need help**

Each service has a help button:
- GitHub: click **?** (help icon, top right)
- Netlify: click **Support** (bottom right)
