# Step 2 CK Study Dashboard - Setup Guide

## 1. Make the Google Sheet Publicly Readable

1. Open your Google Sheet
2. Click **Share** (top right)
3. Under "General access", change to **"Anyone with the link"** → **Viewer**
4. Click **Done**

This lets the dashboard read data without authentication.

## 2. Deploy Google Apps Script (for adding entries from the dashboard)

This creates a free web endpoint that lets the dashboard write new rows to your sheet.

### Step-by-step:

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any existing code and paste this:

```javascript
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    data.shelf,
    data.system,
    data.category,
    data.topic,
    data.errorType,
    data.notes,
    data.strategy
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

4. Click **Deploy → New deployment**
5. Click the gear icon → select **Web app**
6. Set:
   - **Description**: "Study Dashboard API"
   - **Execute as**: Me
   - **Who has access**: Anyone
7. Click **Deploy**
8. **Authorize** when prompted (click through the "unsafe" warning - it's your own script)
9. Copy the **Web app URL** - it looks like: `https://script.google.com/macros/s/XXXXX/exec`

### Connect it to the dashboard:

When you first click "Add Entry" on the dashboard, it will prompt you to paste this URL. It saves it in your browser so you only need to do this once.

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
