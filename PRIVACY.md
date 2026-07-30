# Privacy Policy — Screenshot Stash

**The short version: your screenshots never leave your computer. Ever.**

Screenshot Stash has no servers, no accounts, no analytics, and makes no network
requests. There is nothing to sign up for and nothing that could leak.

## Where your screenshots are saved

When you capture a screenshot, it is saved as an image **in your browser's local
storage (IndexedDB), inside your Chrome profile, on your own device**. That is the
only place it exists. Think of it like a private folder that only your browser can
read — it is not synced, not uploaded, and not visible to websites you visit or to
other extensions.

## What never happens

- **No uploads.** The extension contains no code that talks to the internet. Your
  screenshots are never sent to us or to anyone else — we couldn't see them even if
  we wanted to, because there is no "us" on the other end. No server exists.
- **No permanent copies.** We keep nothing. When you delete a screenshot from your
  library, it is gone immediately and forever — there is no backup, no trash bin on
  a server, no retention of any kind. Uninstalling the extension likewise erases the
  entire library permanently.
- **No tracking.** No analytics, no telemetry, no crash reporting, no cookies, no
  identifiers. We do not know who you are, what you capture, or that you use the
  extension at all.
- **No background snooping.** The extension cannot see any page on its own. It can
  only capture a tab at the exact moment *you* click the capture button or press the
  keyboard shortcut — that is what Chrome's `activeTab` permission means, and it is
  why the extension requests no access to your browsing.

## The only ways a screenshot leaves your library

All of them are actions you take yourself, and each affects only the screenshot you
chose:

1. **Download** — saves a copy as a PNG file to your own Downloads folder.
2. **Copy** — places a copy on your clipboard for you to paste somewhere.
3. **Export all** — saves the whole library as a zip file to your Downloads folder.
4. That's it.

## Permissions, explained

| Permission  | What it's for                                                                            |
| ----------- | ---------------------------------------------------------------------------------------- |
| `activeTab` | Lets the extension capture the current tab — only when you explicitly trigger it.        |
| `downloads` | Lets the Download and Export buttons save files to your Downloads folder.                |
| `scripting` | Powers full-page capture (scrolling the page) and area capture (the selection rectangle) — again only on the tab you explicitly capture. |
| `alarms`    | Runs the optional local auto-delete schedule (off by default).                           |
| `storage`   | Remembers your settings (auto-delete choice, welcome-card dismissal) — settings only, never screenshots. |

No host permissions are requested: the extension has zero access to page content,
browsing history, or any website data.

## Data deletion

You are always one click away from a clean slate: select all in the library and
delete, or simply uninstall the extension. Both remove every screenshot permanently
from your device. Since no copy exists anywhere else, that deletion is total.

You can also turn on **auto-delete** in the library (off by default) to have
screenshots older than 7, 30, or 90 days removed automatically — this runs entirely
on your device, like every other feature.

## Changes to this policy

If the extension's data practices ever change (for example, an optional sync
feature), this policy will be updated first and the change will be called out in the
release notes. The core promise — local-only by default, nothing leaves your device
without your explicit action — will not change.

## Contact

Questions? Open an issue at https://github.com/iniikai/Screenshot/issues.
