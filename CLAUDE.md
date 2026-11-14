# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A monitoring tool for an FTTH + hotspot ISP network that finds the ONT causing (or likely to cause) a
layer-2 loop. It correlates three read-only sources: GenieACS (per-ONT host tables), a Cisco IOS switch
(`MACFLAP_NOTIF` log + MAC tables), and a MikroTik router (loop-protect status, ARP, hotspot user count).
It scores each ONT, shows the result on a web dashboard, and sends Telegram alerts. Separate
GenieACS / Switch / MikroTik menus let the operator inspect and, on explicit button press, change devices.

All user-facing text (UI, README, docs, log messages, validation errors, commit messages, code comments)
is in **Indonesian**. Keep it that way.

## Commands

A venv lives at `.venv/`; use its interpreter directly.

```bash
.venv/bin/pip install -r requirements-dev.txt          # deps + pytest
.venv/bin/python -m pytest                              # all tests
.venv/bin/python -m pytest tests/test_detector.py       # one file
.venv/bin/python -m pytest tests/test_settings.py -k blank_password   # one test

# run with recorded data, no device access (use this for UI work)
WEB_PASSWORD=rahasia .venv/bin/python -m app.main --replay tests/fixtures --host 127.0.0.1 --port 8088

# run against real devices (reads .env + data/settings.json)
WEB_PASSWORD=rahasia .venv/bin/python -m app.main --host 0.0.0.0 --port 8989

# one-shot detection printed to the terminal, no web server
.venv/bin/python -m app.main --replay tests/fixtures --check

node --check app/static/app.js                          # syntax-check frontend JS (no build step)
docker compose up -d --build                            # Docker run; see docs/PRODUKSI.md
```

There is no linter or formatter configured, no `manage.py`, and no auto-reload: restart the process
after Python changes (static files only need a browser reload). The web framework is FastAPI, not Django.

## Architecture

Data flows one way: **collectors → detector → monitor → store / web**.

- `app/collectors/{genieacs,cisco,mikrotik}.py` each have two halves: pure **parsers** (text/JSON →
  dataclasses) and a `fetch(cfg)` that does the I/O. Tests and replay mode exercise only the parsers.
  Collectors must stay read-only: `cisco.CiscoSession.run` refuses anything but `show …`, the MikroTik
  runner refuses commands without ` print`, GenieACS is `GET` only.
- `app/detector.py::analyze(cfg, onts, switch, router)` is a **pure function** returning the JSON-able
  dict that everything downstream consumes (API, dashboard, Telegram text, store). Any source may be
  `None`. Changing a key here means changing `app/static/app.js`, `app/notifier.py`, `app/store.py`
  (`add_sample`, `_top`) and `app/main.py::_print_report` together. `moved` lists every MAC behind
  `counts.flap_events` (including single roams); the store keeps it per check in the `moves` table so
  `/api/moves?start=&end=` can show which MACs make up a chart point (panel under the dashboard charts).
- `app/monitor.py::Monitor` owns one background thread. Each tick refreshes sources, calls `analyze`,
  tracks incident open/close (a loop only ends after `CLEAR_TICKS` clean ticks, because router
  loop-protect re-enables the VLAN briefly every few minutes), fires notifications, and stores a sample.
  Dashboard endpoints never touch devices; they read `monitor.snapshot()` / `monitor.store`.
  The scheduler lives inside the web process, so run **one process only** (no `uvicorn --workers`).
- `app/web.py::create_app(cfg, monitor, password)` builds the FastAPI app. Basic auth is applied
  globally via `dependencies=[Depends(auth)]`, so new routes are protected automatically. Mutating
  routes also depend on `_json_only` (rejects non-JSON bodies as CSRF protection).
- `app/manage/{genieacs_ui,cisco,mikrotik}.py` + `app/web_manage.py` are the **device management** layer
  behind the GenieACS / Switch / MikroTik menus, and the only code allowed to change a device.
  Unlike the dashboard endpoints, these routes talk to devices on request. User-facing failures are
  raised as `ManageError`; in replay mode data comes from fixtures and every write is refused.
  - Switch / MikroTik: pure builders (`build_config`, `build_command`) are the injection boundary;
    every port / interface name must pass a regex and exist in a list just read from the device, and
    each device is serialized by a lock.
  - GenieACS: `genieacs_ui.UiClient` is a **whitelisted proxy to the GenieACS UI API** (port 3000, JWT
    cookie from `POST /login`, re-login on 401), not the NBI. The menu mimics the GenieACS UI by
    rendering the server's own `ui.*` config, scraped from `window.clientConfig` in the UI's `/` page
    (`static/genieacs.js` implements the component types: parameter-list, parameter-table,
    summon-button, overview-dot, tags, ping, device-faults, all-parameters, device-actions,
    device-link, container). `clean_tasks()` is the task boundary (known names/fields only) and
    `holds_mgmt()` refuses deleting any object holding the TR069 management WAN. `acs_expr.py` parses
    and evaluates GenieACS expressions (replay filtering); `static/acs-expr.js` evaluates/stringifies
    them in the browser. Monitoring still uses the NBI (`collectors/genieacs.py`, `genieacs_url`).
  - Location tabs on Devices (`acs_locations`, `acs_location_param` in settings) are app-side, not
    GenieACS config. GenieACS expressions have no CIDR test, so `cidrExprs()` in `genieacs.js` turns
    each subnet into IP-prefix `LIKE` patterns (one per /24 or /16 block, exact `=` above /24).
- `app/replay.py` loads `tests/fixtures/` through the same parsers; `main.py --replay` additionally
  seeds synthetic history so charts have data.

### Configuration layering

`app/config.py::load()` applies, in order: dataclass defaults → `.env` file → process environment →
`data/settings.json` (via `settings.overlay`). So values saved from the web Settings page **override
`.env`**. `app/settings.py` owns everything about that file: `merged()` validates a form payload into a
copy of the config (never mutating), `save()` applies + persists (mode 600), `public_view()` strips
secrets, `test()` runs a connection test against an unsaved trial config.

Rules that are easy to break:
- Secrets are never returned to the browser; an empty secret field on save means "keep the old value".
  OLT entries carry a stable `id` so this works across reorder/delete.
- `tr069_interface` and `olt_trunks` are interpolated into device commands, so their validators
  (`_NAME`, `_PORTNAME`) are an injection boundary, not cosmetics.
- After saving, `monitor.reconfigure()` toggles sources live; the `Config` object is shared and
  mutated in place, so collectors' `fetch` lambdas see new values without restart.
- Adding a setting means touching `Config`, `settings.SAVED_KEYS`, `merged()`, `public_view()`,
  the form HTML, and `.env.example`.
- The connection forms for GenieACS / switch / MikroTik live in the "Koneksi" tab of
  `genieacs.html` / `switch.html` / `mikrotik.html`; `settings.html` keeps OLT, network and Telegram.
  All of them share `settings.js`, which sends only the sections present on the page (`merged()`
  leaves absent sections untouched).

### Detection rules worth knowing before editing `detector.py`

- A MAC counts as flapping only with ≥ `flap_min_events` events inside `flap_window_sec`; a single
  move is treated as ordinary Wi-Fi roaming.
- Level `kuat` (strong suspect) requires score ≥ threshold **and** a `flap_lan` reason (a device on the
  ONT's LAN port is actually flapping). Without that proof the cap is `berisiko`, whatever the score.
- The cross-trunk signal only considers LAN-port or flapping hosts; Wi-Fi clients legitimately appear
  on another trunk.
- The VLAN name in parentheses in MikroTik's "received loop protect packet … (vlanX)" log is ignored on
  purpose: all VLANs on one port share a MAC, so that name is unreliable. Only the receiving interface
  is used.
- Switch log ages are computed against the switch's own `show clock`, because the switch clock is
  typically unset (fixtures are dated 2002).
- If neither switch nor router is readable, `loop.known` is false and the UI/CLI say "unknown", never
  "normal".

### Frontend (`app/static/`)

Plain HTML/CSS/JS with no build step and **no CDN**: uPlot and the Plus Jakarta Sans font are vendored
in `static/vendor/` so the dashboard works on an offline management network. Keep it that way.

- The management pages share `common.js` (`UI.call`, `UI.loader`, `UI.tabs`, `UI.ask`, `UI.toast`).
  Disruptive actions must go through `UI.ask()` with `danger: true` (plus `confirmWord` for
  factory reset and OLT trunk shutdown).
- All device/customer-derived strings (hostnames, serials) must go through `esc()` before entering HTML.
- `app.js` re-renders a section only when its data signature changes (`changed(key, value)`) and updates
  charts in place with `setData`; this prevents flicker and keeps expanded rows open across the 15 s
  poll. Preserve that when adding sections.
- API calls go through `api()` (base URL without credentials) rather than bare relative `fetch`.
- Animations must respect `prefers-reduced-motion` (CSS media query plus the `calm` flag in JS for
  SMIL/`requestAnimationFrame` effects).
- Visual identity (owner request: colourful, embossed, icons, animation; not "AI-generic"): fiber-optic
  colour tokens `--f-*` (TIA-598) plus emboss tokens `--emb-hi/--emb-lo/--panel-top/--panel-bot/--drop`,
  applied globally to `.card/.block/.btn/...` in `app.css`. Section `<h2>`s carry a coloured `.ico`.
  Fixed-position bars must be children of `<body>` (`.reveal` leaves a transform on `<main>`).
- The dashboard topology (`pathSvg` in `app.js`) draws hand-made SVG hardware: a 1U rack server for the
  MikroTik x86 router, a Catalyst-style switch, OLT chassis per trunk, and a white ONT. No vendor logos
  or external images (offline + trademarks); brand names appear only as text labels.
- Theme tokens are CSS variables defined three times (light, `prefers-color-scheme: dark`,
  `[data-theme="dark"]`); change all three. Chart colours were checked for colour-blind separation.

## Tests and fixtures

`tests/fixtures/` is a **real incident capture that has been anonymised** (serials, MACs, PPPoE names
and hostnames replaced; passwords removed). Files ending in `_contoh` are synthetic samples for the
management pages (WiFi/WAN parameters, switch port status, router interfaces, hotspot users, and
`genieacs_ui_contoh.json`: a made-up GenieACS `ui.*` layout plus admin entries), not captures. Never
commit the real GenieACS config of a deployment. `tests/fixtures/expected.json` names the ONT that must rank first and the ones that must be
`berisiko`. The repository is public: never commit real device
credentials, public IPs, customer names, or un-anonymised captures, and re-check for personal names in
hostnames if fixtures are regenerated.

Not covered by tests (only verified manually or not at all): live `fetch()` paths, the Cisco SSH
transport (only Telnet was exercised against a real switch), Telegram delivery, and every
`app/manage/` action against a real device (only the builders, parsers, a mocked NBI and replay-mode
routes are tested). Never exercise management actions against production devices to "test" them.

## Deployment

Two supported paths, documented in `docs/PRODUKSI.md`: Docker (`Dockerfile`, `docker-compose.yml` with
`network_mode: host` and a named volume for `/app/data`) and non-Docker (venv +
`deploy/ont-loop-detector.service`). Runtime state lives in `data/` (`settings.json`,
`loopdetector.db`), which is git-ignored and excluded from the image. There are no DB migrations:
`store.py` creates tables with `CREATE TABLE IF NOT EXISTS`, so schema changes need a manual `ALTER`
or a fresh database.
