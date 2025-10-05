# To Do Focus & Hide Upcoming (Chrome Extension)

Enhance the **Microsoft To Do** web app with:
1. **Focus timer per task** — click the green work chip on the left of a task row to start/stop timing. When stopped, time is appended to the title like `[1h 5m]`. Multiple sessions accumulate.
2. **Hide upcoming tasks** — a toolbar toggle hides tasks with due dates in the future, so you can focus on **overdue** and **due today**.

> Target URL: `https://to-do.live.com/tasks/*`  
> Data stays local (browser storage / localStorage). This project is **not affiliated** with Microsoft.

---

## Install (Unpacked)

1. Save the four files in a folder, e.g. `todo-focus-hide-extension/`:
   - `manifest.json`
   - `content.js`
   - `styles.css`
   - `README.md`

2. Open **chrome://extensions** in Chrome (or Edge: **edge://extensions**).
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the folder.
5. Open `https://to-do.live.com/tasks/` (reload if already open).

---

## How it works

### Focus timer
- A slim **green work chip** is inserted into each `.taskItem-body`.
- Clicking the chip toggles **working** state.
- On stop, elapsed minutes are computed and **added to the task’s title**:
  - Existing `[xh ym]` or `[xm]` suffixes are detected and time is accumulated.
- Ongoing sessions are persisted per **list name + base task title**.

### Hide upcoming
- A toolbar button labeled **“Hide upcoming”** toggles a `html.hide-future-tasks` class.
- Each `.taskItem` is classified:
  - If it has a due date and is **not** overdue or due today → `kuro-future-task`.
- CSS hides future tasks only when the root class is active.

---

## Permissions

- `"storage"`: optional convenience if you later switch to `chrome.storage`.  
  Current implementation uses `localStorage` on the page origin.

---

## Notes & Limitations

- This is a DOM augmentation for a **single-page React app**. If Microsoft significantly changes class names or structure, selectors may need updates.
- Renaming tries the built-in editor UI first (right pane). If it fails, the visible title text is updated as a non-destructive fallback.
- The extension only runs on `https://to-do.live.com/tasks/*`.

---

## License

MIT (feel free to adapt).

