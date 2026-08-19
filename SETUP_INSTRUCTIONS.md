# Digital Horizon — Code Challenge Level 1
## Conductor Setup Guide (10 minutes, free, no server needed)

You have 3 files:
- `digital_horizon_quiz.html` — the quiz itself. This is what participants open.
- `google_apps_script.gs.txt` — backend code that writes results into a Google Sheet.
- This guide.

---

### Step 1 — Create the results sheet
1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Name it something like **"Digital Horizon — Results"**.
3. Open **Extensions → Apps Script**.
4. Delete the placeholder code in `Code.gs`, then paste in the entire contents of `google_apps_script.gs.txt`.
5. Click the **Save** icon.

### Step 2 — Deploy it as a web app
1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**. Authorize the script when prompted (click through the "unverified app" warning — it's your own script).
5. Copy the **Web app URL** it gives you (ends in `/exec`).

### Step 3 — Connect the quiz to your sheet
1. Open `digital_horizon_quiz.html` in a text editor.
2. Find this line near the top of the `<script>` section:
   ```js
   const SHEET_WEBHOOK_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
3. Replace the placeholder with the URL you copied. Save the file.

### Step 4 — Host it somewhere participants can open with a link
Pick whichever is easiest for you — both are free and take under 2 minutes:

**Option A — Netlify Drop (fastest, no account strictly required)**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag `digital_horizon_quiz.html` onto the page.
3. You'll get a live link like `https://random-name-123.netlify.app`. Share that link.

**Option B — GitHub Pages**
1. Create a new public repo, upload `digital_horizon_quiz.html`, rename it to `index.html`.
2. Repo Settings → Pages → deploy from the `main` branch.
3. Share the resulting `https://yourname.github.io/reponame/` link.

You can also just email/AirDrop the raw `.html` file to participants and have them double-click to open it locally — it still works and still submits to your Sheet, since only the final submission needs internet, not hosting.

### Step 5 — Run the challenge
1. Share the link (or file) with participants a few minutes before start time.
2. Ask everyone to use Chrome or Edge on their own laptop, connected to their own Wi-Fi.
3. Each participant enters their name, clicks **Enter Fullscreen & Begin Challenge**, and the 20-question timed run starts.
4. Results land in your **Results** sheet in real time as people finish, including a violation count and a JSON log of any tab-switches, fullscreen exits, or blocked copy/paste attempts, timestamped per question.

---

### Timing & marks
| Difficulty | Time per question | Marks |
|---|---|---|
| Easy (Q1–5) | 30 sec | 1 mark |
| Medium (Q6–15) | 1 min | 2 marks |
| Hard (Q16–20) | 1 min 30 sec | 3 marks |

Total possible: **40 marks**. Correct answers are never shown during the quiz — participants only see their final score at the end, on their own result screen.

### Pacing
There's no "Next" button. The countdown for each question is what advances the quiz: a participant can click an option to lock it in, but the app only moves to the next question once time runs out, at which point it records whatever was selected (or "unanswered" if nothing was clicked).

### 3-strike termination
A visible strike counter ("Strikes: X / 3") sits at the top of the quiz. Each of the following counts as one strike:
- Exiting fullscreen
- Switching tabs or windows
- A blocked copy/paste/devtools shortcut attempt

On the 3rd strike, the exam ends immediately — whatever question was in progress is marked unanswered, and the result (score, violation log, and a `Terminated? = YES` flag) is submitted automatically to your Sheet.

### What the lockdown actually does — and its real limit
- **Fullscreen enforcement**: leaving fullscreen pauses the timer and shows a blocking overlay until the participant returns (or triggers the 3rd strike).
- **Copy / paste / right-click**: disabled for the duration of the quiz.
- **Tab-switch / app-switch detection**: browsers cannot forcibly close other apps or prevent someone from alt-tabbing — no website can do that, on any platform. What this quiz does instead is detect every tab switch, fullscreen exit, or window blur, count it as a strike, and terminate after the 3rd, logging exactly what happened and when.

### Scale note
The quiz itself runs entirely in each participant's browser, so ~100 concurrent users adds no load anywhere. The only shared component is the Google Sheet write at the very end of each run (or on termination), which comfortably handles that volume.

### Customizing
- **Timing / marks per difficulty**: edit `DIFFICULTY_CONFIG` near the top of the `<script>` block.
- **Strike limit**: edit `MAX_VIOLATIONS` (currently 3) in the same spot.
- **Questions**: edit the `RAW_QUESTIONS` array in the same file — each entry has a title, code snippet, four options, and the correct answer text.
