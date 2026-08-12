# Chrome Web Store listing copy

Title and summary come from `manifest.json` and cannot be edited in the
dashboard — change them there and re-upload. Everything below is pasted into
the dashboard by hand.

## Title (manifest `name`, max 75)

Screenshot Stash — Full Page Screen Capture & Library

## Summary (manifest `description`, max 132)

Screenshot tool with a private local library: capture full page, visible area or region, then annotate, copy or bulk-delete.

## Category

Productivity → Workflow & Planning

## Description

Most screenshot extensions want an account, upload your captures to someone
else's server, or scatter PNGs across your Downloads folder with filenames you
can't search. Screenshot Stash does none of that.

Every screenshot stays on your device, in a library you can actually work with.
No account. No sign-in. No servers. No analytics. The extension makes zero
network requests — and the full source code is public so you can verify that
claim yourself instead of taking my word for it.

THREE WAYS TO CAPTURE
• Visible area — one click for what's on screen right now
• Full page — scrolls and stitches the entire page, hiding sticky headers so
  they don't repeat down the image
• Region — drag to select any part of the page

A REAL LIBRARY, NOT A DUMPING GROUND
• Search across page titles, URLs and your own tags
• Filter by site
• Tag screenshots to group them however you think
• Duplicate detection flags near-identical captures automatically
• Compare any two screenshots side by side
• Bulk select, then copy, download or delete in one action
• Export everything as a single ZIP
• Instant delete with a 6-second undo — no confirmation dialogs

ANNOTATE BEFORE YOU SHARE
Draw with a pen, add arrows and boxes, and pixelate anything sensitive with the
blur tool. Save over the original or keep it as a copy.

BUILT FOR PRIVACY
Screenshots are stored in IndexedDB, in your browser, on your computer. They
are never uploaded anywhere. Deleting a screenshot destroys it permanently;
uninstalling the extension removes every trace. The only way anything leaves
your device is when you explicitly copy, download or export it.

The extension requests no host permissions and cannot read the pages you visit.
It only captures the tab you are looking at, at the moment you ask it to.

ALSO
• Dark mode, following your system theme
• A keyboard shortcut for each capture mode — Alt+Shift+S for the visible tab,
  Alt+Shift+F for the full page, Alt+Shift+R to select a region. All three are
  remappable to whatever you prefer.
• Optional auto-delete of screenshots older than 7, 30 or 90 days — off by
  default, and it runs locally
• Storage meter so you always know how much space the library is using

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
