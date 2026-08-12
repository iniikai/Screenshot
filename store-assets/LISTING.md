# Chrome Web Store listing copy

Title and summary come from `manifest.json` and cannot be edited in the
dashboard — change them there and re-upload. Everything below is pasted into
the dashboard by hand.

## Title (manifest `name`, max 75)

Screenshot Stash — Multi Screenshot & Full Page Capture

## Summary (manifest `description`, max 132)

Take multiple screenshots into a private local library: full page, visible tab or region. Annotate, copy, download or bulk-delete.

## Category

Productivity → Workflow & Planning

## Description

I created this extension for my own sanity, and maybe you'd like it too.

You can take multiple small or full-page screenshots and bulk edit, rename or
download them later. Hey designers and front-end engineers!

It only keeps the files on your device, and the code is public — you can read
every line and decide for yourself whether you want it near your work.

WHAT YOU CAN DO
• Capture three ways — the visible tab, the whole scrolling page, or drag to
  select a region
• Keyboard shortcut for each, remappable to whatever you like
• Everything lands in one library instead of scattering across Downloads
• Search by title, note, URL or tag, and filter by site
• Rename and add notes — one at a time, or a whole batch at once
• Annotate: pen, arrows, boxes, and blur to hide anything private
• Compare any two side by side
• Duplicate detection flags near-identical captures
• Bulk select, then rename, download or delete in one action
• Export the whole library as a single zip
• Drag a screenshot straight into Slack, Figma or an email
• Choose PNG, WebP or JPEG to trade quality against disk space
• Six seconds of undo on every delete, and optional auto-cleanup
• Dark mode, following your system

WHY IT STAYS ON YOUR DEVICE
Screenshots are stored in IndexedDB, in your browser, on your computer. They
are never uploaded anywhere. There is no account, no sign-in, no server, no
analytics, no tracking. The extension makes zero network requests.

Deleting a screenshot destroys it permanently. Uninstalling removes every
trace. The only way anything leaves your device is when you explicitly copy,
download or export it.

It requests no host permissions and cannot read the pages you visit. It only
captures the tab you are looking at, at the moment you ask it to.

Source code and privacy policy: https://github.com/iniikai/Screenshot

## Privacy practices tab

Single purpose:

  Capture screenshots of the user's current browser tab and store them in a
  local library where the user can review, annotate, copy, download, or delete
  them.

Permission justifications:

  activeTab — Captures the visible content of the tab the user is on. Only runs
  when the user clicks the capture button or presses the keyboard shortcut.

  downloads — Saves screenshots as PNG files, and the "Export all" archive, to
  the user's Downloads folder.

  scripting — Injects the scroll-and-measure script used for full-page capture
  and the drag-to-select overlay used for area capture, only on the tab the
  user explicitly chooses to capture.

  alarms — Runs the optional auto-delete schedule that removes screenshots
  older than 7/30/90 days. Off by default, entirely local.

  storage — Stores user settings only (auto-delete preference, welcome-card
  dismissal). Screenshots are never stored here — they live in IndexedDB on the
  user's device.

  Host permissions — None requested.

  Remote code — Not used. All code is contained in the package.

Data usage: no data collected. Certify all three checkboxes.
