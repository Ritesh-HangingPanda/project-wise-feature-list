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

The report can save changes for everyone through a small passkey-protected API. There are two interchangeable versions of the same API:

- **`worker.js`** – Cloudflare Worker + KV. Free, no card, data is kept. **Recommended.**
- **`server.js`** – plain Node server (no dependencies) that stores a JSON file. Needs a host with a persistent disk.

| Endpoint | Access | What it does |
|---|---|---|
| `GET /api/state` | public | Saved status changes and added features |
| `GET /api/history` | public | Last 50 changes |
| `POST /api/verify` | passkey | Checks the passkey |
| `PUT /api/status` | passkey | Set or clear one status |
| `POST /api/reset` | passkey | Clear all saved status changes |
| `POST /api/features` / `DELETE /api/features/:id` | passkey | Add or delete a feature row |

The passkey is sent in the `x-passkey` header and checked on the server only. Five wrong attempts from one address lock it out for 10 minutes. The passkey is **never** stored in this repo or in the page.

### Deploy the Worker (free)

```bash
npm install -g wrangler        # or use npx
npx wrangler login
npx wrangler deploy            # creates the KV namespace on first deploy
npx wrangler secret put PASSKEY   # type the passkey when asked
```

Wrangler prints the Worker address (`https://project-wise-feature-list-api.<you>.workers.dev`).

Then edit `config.js`, set `window.API_BASE` to that address, and push. The GitHub Pages report now shares changes, and the first edit in each tab asks for the passkey. The Worker already allows the Pages origin (`ALLOWED_ORIGIN` in `wrangler.toml`).

### Run the Node server instead

```bash
PASSKEY='choose-a-passkey' node server.js    # serves the report and the API on http://localhost:3000
```

Set `DATA_DIR` to a persistent disk, otherwise changes are lost on restart.

When the server is not reachable, the report falls back to editing in your own browser only.
