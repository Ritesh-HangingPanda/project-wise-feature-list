# Project-wise Feature List

Feature status report for the Time365 app family (Linear: [FE-855](https://linear.app/time365/issue/FE-855)).

**Live report:** https://ritesh-hangingpanda.github.io/project-wise-feature-list/

**Repository:** https://github.com/Ritesh-HangingPanda/project-wise-feature-list

## Projects covered

HRM, MOH, SGS, Zain Attendance, Ithbat-MOIA, Dawami365

## Statuses

| Status | Meaning |
|---|---|
| Released | Feature code is on `main` |
| Ready to Release | Finished and waiting to go to `main` |
| Development | On `feat/development` but not on `main` |
| Not Done | Not found on `main` or `feat/development` |

## Using the report

- Use the filter buttons and the search box to narrow the feature list.
- **Without the server** (plain GitHub Pages): click a status badge to change it. Edits are saved in your browser only.
- **With the status server** (see below): changes are saved for everyone. The first edit in a tab asks for the passkey. Use **+ Add feature** to add a row, and the × next to an added row to delete it.

## Status server (optional)

`server.js` is a small Node server with no dependencies. It serves the report and a tiny API:

| Endpoint | Access | What it does |
|---|---|---|
| `GET /api/state` | public | Saved status changes and added features |
| `GET /api/history` | public | Last 50 changes |
| `POST /api/verify` | passkey | Checks the passkey |
| `PUT /api/status` | passkey | Set or clear one status |
| `POST /api/reset` | passkey | Clear all saved status changes |
| `POST /api/features` / `DELETE /api/features/:id` | passkey | Add or delete a feature row |

The passkey is sent in the `x-passkey` header and checked on the server only. Five wrong attempts from one address lock it out for 10 minutes. The passkey is **never** stored in this repo or in the page.

### Run locally

```bash
PASSKEY='choose-a-passkey' node server.js
# open http://localhost:3000
```

### Deploy on Render

1. Create a new **Blueprint** from this repo (it reads `render.yaml`).
2. When asked, enter the `PASSKEY` value in the dashboard.
3. Deploy. Your report is then at your `https://<name>.onrender.com` address.

The data is a JSON file in `DATA_DIR`. Use a persistent disk (the blueprint adds one, which needs a paid Render plan) or a Railway volume, otherwise changes are lost on restart.

### Use the server from the GitHub Pages copy

Edit `config.js` and set `window.API_BASE` to your server URL, then push. The server already allows the Pages origin (`ALLOWED_ORIGIN`).

## Files

- `index.html` – the report (single self-contained file, no build step)
