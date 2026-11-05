# Credential Quest

**Live at [mscredentialquest.com](https://mscredentialquest.com)**

A free, community-facing Microsoft certification study companion — every credential from Microsoft's official [certification poster](https://aka.ms/CertificationsPoster), with a Learn-grounded skills breakdown and a practice quiz for each one.

**56 of 56 poster credentials are fully built out**, spanning Cloud & AI Platforms, AI Business Solutions, Security, and GitHub — roughly 7,700 original practice questions in total.

## What it does

- Search or browse any exam on the current poster by code (`AZ-900`) or keyword (`"security fundamentals"`).
- Each built-out exam gets a skills-measured breakdown (domains, weights, and links to the real Microsoft Learn training path for each domain) plus a 50-question practice quiz drawn from a larger question pool, rotating through unseen questions before repeating.
- Progress is tracked locally in the browser (`localStorage`) — nothing is sent to a server.

## Where the content comes from

- Credential codes, titles, categories, and tiers are taken directly from Microsoft's official certification poster.
- Skills-measured outlines and domain weights are pulled from the live Microsoft Learn study guide for each exam.
- Practice questions are original — never reproductions of real exam questions, which Microsoft doesn't publish — but are written from the actual content of each exam's real Microsoft Learn training modules, not general knowledge.

## Running locally

No build step, no dependencies — it's plain HTML/CSS/JS with no `fetch`, modules, or bundler, so opening the file directly works the same in any modern browser (Chrome, Firefox, Safari, Edge) on any OS.

```bash
git clone https://github.com/VivianVoss/credential-quest.git
cd credential-quest
```

Then open `index.html`:
- Easiest: double-click it in Finder / File Explorer / your file manager.
- macOS: `open index.html`
- Windows: `start index.html`
- Linux: `xdg-open index.html`

## Structure

| File | Contents |
|---|---|
| `index.html` | Page shell — loads `style.css`, then `data.js`, then `app.js` |
| `style.css` | All styling, including light/dark theme support |
| `data.js` | The credential catalog and every exam's domains + question pool |
| `app.js` | App logic — rendering, search, quiz state, progress tracking |
| `staticwebapp.config.json` | Azure Static Web Apps routing config (per-exam URLs need this to resolve) |
| `scripts/freshness-check/` | CI-only tooling that checks the poster + live exam pages for drift — see below |

## Keeping it up to date

A monthly [GitHub Action](.github/workflows/freshness-check.yml) checks two things against the live Microsoft sources:

1. **Does the poster still list exactly these 56 credentials?** New or retired codes get filed as a GitHub issue for review, and so does a new poster edition, even if no code changed.
2. **Has anything drifted on an existing exam's live page?** Level, beta status, or a domain's weight percentage — mechanical field changes get auto-patched, merged and deployed. Changes dated in the future wait until they take effect. A domain being added or removed (which means the question pool itself needs new content, not just a data edit) gets filed as an issue instead of silently patched. So does a changed certification name, because a rename can also affect `CATALOG` titles and tiers.

Each full run ends with a digest issue assigned to the repo owner, listing what needs attention. If a month passes with no digest, the check itself has stopped.

See [`scripts/freshness-check/`](scripts/freshness-check/) for the implementation, or trigger a manual run (optionally scoped to specific codes) via the workflow's "Run workflow" button on GitHub.

## Disclaimer

This is an independent community study tool. It is **not affiliated with, endorsed by, or sponsored by Microsoft**. All trademarks belong to their respective owners.

## License

Copyright (C) 2026 Vivian Voss

Licensed under the [GNU General Public License v3.0](LICENSE) — you're free to use, study, modify, and redistribute this code under the terms of the GPLv3, including for derivative works, as long as those derivatives are also released under GPLv3.
