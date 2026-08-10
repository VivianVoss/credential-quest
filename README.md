# Credential Quest

A free, community-facing Microsoft certification study companion — every credential from Microsoft's official [certification poster](https://aka.ms/CertificationsPoster) (July 2026 edition), with a Learn-grounded skills breakdown and a practice quiz for each one.

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

No build step, no dependencies. Clone the repo and open `index.html` directly in a browser:

```bash
git clone https://github.com/VivianVoss/credential-quest.git
cd credential-quest
open index.html
```

## Structure

| File | Contents |
|---|---|
| `index.html` | Page shell — loads `style.css`, then `data.js`, then `app.js` |
| `style.css` | All styling, including light/dark theme support |
| `data.js` | The credential catalog and every exam's domains + question pool |
| `app.js` | App logic — rendering, search, quiz state, progress tracking |

## Disclaimer

This is an independent community study tool. It is **not affiliated with, endorsed by, or sponsored by Microsoft**. All trademarks belong to their respective owners.

## License

No license is granted. All rights reserved — the code and question content here may not be copied, redistributed, or reused without permission.
