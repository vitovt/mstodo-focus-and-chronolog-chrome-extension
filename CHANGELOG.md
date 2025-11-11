# Changelog

## v1.1.4 - 2025-11-01
 - Fix main extension window background on mobile
 - Add a task completion popup with work duration info
   for 3 seconds (by default) after you stop or switch a task.
   Displays “Worked on a task …” in the middle of the screen
   - add styling for desktop and mobile
   - add Settings tab and an option to disable the popup
   - add duration option on the Settings tab
   - add ability to close it by clicking on it

## v1.1.3 - 2025-11-01
- Add: Hide/Show recurring tasks toggle.
- Add: Mobile-friendly Filters menu that groups “Hide Future” and “Hide Recurring”.
- Change: Move the combined Filters button to the right toolbar, just left of Sort/Group.
- Change: Replace the Filters button icon with an inline SVG filter icon consistent with built-in icons.
- Chore: Bump version.

## v1.1.2 - 2025-10-28
- Add: UI busy gate to drop rapid clicks while a stop/start flow runs.
- Change: Prevent wrong renames by scoping to the details pane and verifying identity.
- Change: Make the “stop others” path sequential and awaited to prevent overlapping task renames.
- Change: Reformat the chronolog Markdown table to be more compact.
- Tweak: Style the popup window.
- Chore: Bump version.

## v1.1.1 - 2025-10-06
- Add: Daily time tracking (Chronolog) with sessions and Markdown export via popup.
- Fix: Stop any other “working” tasks when starting a new one.
- Change: Add improvements and comments across the codebase.
- Docs: Update README.
- Init: Initial commit and project scaffolding.

