# MsToDo Focus & Chronolog (Chrome Extension)

Enhance the **Microsoft To Do** web app with productivity features:

https://github.com/user-attachments/assets/a15f7b09-6df9-4193-8450-c4d7938bd61c


1. **Focus timer per task**  
   Click the narrow green “work chip” on a task row to start/stop timing. On stop, elapsed time is appended to the title like `[1h 5m]`. Multiple sessions accumulate.

2. **Hide upcoming tasks**  
   A toolbar button toggle hides tasks with due dates in the future (shows only **overdue** and **due today**).

3. **Daily chronolog (Daily time tracking)**  
   The extension logs your day as sessions:
   - When a task is focused, a **task session** is opened.
   - When there’s no active task, an **Idle** session is kept open.
   - Click the extension button to see a **Markdown table** of today’s sessions and **download it as .txt** or **copy** it.

Daily Time Log means keeping track of everything you do during the day — when you start, stop, and switch tasks.
It helps you see where your time actually goes and make better decisions about how to use it.

> Target URL: `https://to-do.live.com/tasks/*`  
> Data is stored locally using `chrome.storage.local`. This project is **not affiliated** with Microsoft.

---

## Installation

### Dev version from GIT

1. Clone git repository in a folder, e.g. `todo-focus-hide-chronolog/`:

2. Open **chrome://extensions** (or **edge://extensions**), enable **Developer mode**, click **Load unpacked**, and select the folder.

3. Open `https://to-do.live.com/tasks/` (reload if already open).

### From Google WEB store

https://chromewebstore.google.com/detail/ms-todo-focus-chronolog/fgkkmokgpilcfageadkabpfcolkddefk

---

## How it works

### Focus timer
- A thin green **work chip** is injected at the left of each task row.
- Clicking the chip toggles **working** state.
- On stop, the elapsed minutes are calculated and appended to the task title like `[xh ym]` or `[xm]`.
- Only one task is enforced as **active**. Starting a task stops any other active task.

### Hide upcoming
- The toolbar button labeled **“Hide upcoming”** toggles a root CSS class.
- Tasks are classified: if they have a due date and are not overdue / today → they’re **future**.
- Future tasks are hidden when the toggle is on.

### Chronolog (daily log)
- Sessions are saved in `chrome.storage.local`, per day (`YYYY-MM-DD`).
- There is **always** an open session: either a task session or **Idle**.
- The popup shows today’s log as a **Markdown table** with columns:
  - **Task start time**
  - **Task name** (without any `[h m]` suffix)
  - **Time spent** (end – start)
- Use **Copy** or **Download .txt** in the popup.

---

## Permissions

- `"storage"`: store logs and preferences locally.

---

## Notes & Limitations

- This augments a dynamic SPA. If Microsoft changes DOM structure or class names, selectors may need updates.
- Multi-tab usage on the same account/page is not synchronized; keep the To Do web app in a single tab for best results.
- The title rename tries the official editor UI first; if it fails, it updates the visible title only (non-destructive fallback).

---

## Thanks and inspirations

The project was inspired by Maxim Dorofeev (aka Cartmendum) and excellent to-do application **Maxdone** (maxdone.micromiles.co) - RIP (
as well as the related Chrome extension for Maxdone: https://github.com/alatyshau/maxdone-chrome-extension

## License

MIT

