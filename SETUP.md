# Step 2 CK Study Dashboard - Setup Guide

## 1. Make the Google Sheet Publicly Readable

1. Open your Google Sheet
2. Click **Share** (top right)
3. Under "General access", change to **"Anyone with the link"** → **Viewer**
4. Click **Done**

This lets the dashboard read data without authentication.

## 2. Deploy Google Apps Script (form submissions + daily email briefing)

This creates a free web endpoint that lets the dashboard write new rows to your sheet **and** sends a daily email briefing to Chase at 7 AM.

### Step-by-step:

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any existing code and paste the entire contents of `apps-script.js` from this repo
4. Click **Deploy → New deployment**
5. Click the gear icon → select **Web app**
6. Set:
   - **Description**: "Study Dashboard API v2"
   - **Execute as**: Me
   - **Who has access**: Anyone
7. Click **Deploy**
8. **Authorize** when prompted (click through the "unsafe" warning - it's your own script)
9. Copy the **Web app URL** - it looks like: `https://script.google.com/macros/s/XXXXX/exec`

> **IMPORTANT:** If you already deployed a previous version, you need to create a **New deployment** (not update the old one) for the changes to take effect. Copy the new URL and paste it when prompted by the dashboard.

### Set up the daily email:

1. In the Apps Script editor, select `createDailyTrigger` from the function dropdown (top bar)
2. Click **Run**
3. Authorize Gmail permissions when prompted
4. Done — Chase will receive a daily briefing email at ~7 AM

To test immediately: select `testSendBriefing` from the dropdown and click **Run**.

### Connect it to the dashboard:

When you first click "Add Entry" on the dashboard, it will prompt you to paste the Web app URL. It saves it in your browser so you only need to do this once.

### What the daily email includes:

- **Yesterday's QBank progress** — questions done, scores, vs. running average
- **Missed questions logged** — full detail with error type breakdown, notes, and strategies
- **Coaching points** — targeted suggestions based on yesterday's error patterns
- **Big-picture insights** — Pareto analysis, error profile, repeat offender topics, score trends

## 3. Host on GitHub Pages

1. Create a new repo on GitHub (e.g., `step2-dashboard`)
2. In this project folder, run:

```bash
git init
git add .
git commit -m "Initial commit - Step 2 CK Study Dashboard"
git remote add origin https://github.com/YOUR_USERNAME/step2-dashboard.git
git branch -M main
git push -u origin main
```

3. On GitHub, go to **Settings → Pages**
4. Source: **Deploy from a branch**
5. Branch: **main**, folder: **/ (root)**
6. Click **Save**
7. Your site will be live at: `https://YOUR_USERNAME.github.io/step2-dashboard/`

## 4. Test Locally

Just open `index.html` in your browser - it works without a server since it fetches data directly from Google Sheets.

## Project Structure

```
├── index.html          # Main dashboard page
├── css/
│   └── style.css       # Dashboard styles
├── js/
│   └── app.js          # All application logic
├── SETUP.md            # This file
```
