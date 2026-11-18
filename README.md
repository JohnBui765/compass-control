# Control Trainer

A PWA for practising a **COMPASS-style Control module** at home: keep the blue needle on the red dot with the stick (fore/aft only) and the blue ball on the red dot with the rudder pedals, both at once. In the MVP the **mouse is the stick** and **two keys are the pedals**. Joysticks and rudder pedals plug in later through the same input layer.

> **Disclaimer:** this is an independent practice tool. It is not affiliated with COMPASS, EPST or Aviation Focus, and its score is not the official COMPASS score. The real test's dynamics, drift and scoring are not public. Everything here is an adjustable estimate.

Plain HTML, CSS and ES modules. There is no build step, no framework, no CDN, no fonts, no analytics and no network calls. It works offline after the first load.

---

## 1. Run it locally

Serve the **parent** folder, so the app sits in a sub-folder the way it will on GitHub Pages:

```bash
cd ..                       # the folder that contains compass-control/
python3 -m http.server 8000
# open http://localhost:8000/compass-control/   (Chrome or Edge)
```

The service worker needs `http://localhost` or `https://`. It does not run from `file://`.

## 2. Deploy to GitHub Pages

1. Create a repository, for example `compass-control`, under `johnbui765`.
2. **If the repo name is not `compass-control`**, run `node tools/set-repo-name.mjs <repo-name>`. It sets the manifest to `"id": "/<repo-name>/"`. Cache names, localStorage keys and the IndexedDB name follow the serving folder automatically, so the manifest is the only file to change. The About page shows a ✓ when the id matches.
3. Put the *contents* of this folder in the repo root, push, and go to **Settings → Pages → Deploy from a branch → `main` / root**.
4. Open `https://johnbui765.github.io/<repo-name>/` in Chrome or Edge. Use the install icon in the address bar to install it as an app.
5. **When you change any file later, bump `VERSION` in `sw.js`.** Open copies then show "A new version is ready → Reload".

### Shared-origin rules (all your PWAs live on `johnbui765.github.io`)

| What | Value | Rule |
|---|---|---|
| Manifest id | `/compass-control/` | never `./` or `/` |
| `start_url`, `scope` | `./` | relative to the app folder |
| Service worker scope | `/compass-control/` | registered from the app folder |
| Cache names | `compass-control-v1`, `-v2`, … | on activate the SW deletes **only** names matching exactly `^compass-control-v\d+$` (so `compass-control-pro-v1` and `other-app-v3` survive) |
| localStorage | `compass-control:settings`, `compass-control:profiles` | every key prefixed |
| IndexedDB | `compass-control-db` | sessions + input recordings |

Note that Chrome's "Clear site data", and the "also clear data" box when you uninstall an app, wipe the **whole origin**: every one of your apps. Export your history (History → Export JSON) now and then.

---

## 3. First steps

Open **How to use** on Home first. It has a controls card built from your current settings (which key moves the ball which way, how the mouse moves the needle), a 4-step start, a guide to the session and the results, tips, and fixes for common problems. Every page has a **? How to use** button, the session start card shows the same controls card, and the 3-2-1 countdown shows a one-line reminder.

1. **Hardware test**
   - Click **Start calibration**, then move the mouse exactly **10 cm** along a ruler and click. Until you do, the app assumes an 800 DPI mouse.
   - Check that "Raw input" says **yes**. If it says no, turn off Windows "Enhance pointer precision".
   - Press your pedal keys and look at the key log.
2. **Windows:**
   - Turn off the Sticky Keys shortcut (Settings → Accessibility → Keyboard).
   - If you type Vietnamese, **switch Unikey / EVKey / Telex to English (E)**. In Telex mode, keys such as A, D, S, F, R, X, J and W become letter or tone edits, and the input method can swallow or garble pedal presses. The app detects this and warns you.
3. **Start session:** 1 minute of practice (not scored), then 3 runs of 2 minutes with 10 s breaks. The screen goes full screen and the mouse is captured.
   - **Esc pauses.** With keyboard lock you hold Esc for about 2 s to leave full screen.
   - Losing focus, full screen or the mouse also pauses. Paused time is never scored.
4. **Results:** a score per run, time on target, RMS error, error-over-time charts with the on-target bands shaded, the settings used, and **Replay** for any run.

### Controls (defaults – the app shows your current ones under How to use)

| | Default | Setting |
|---|---|---|
| Stick | slide the mouse forward/back. Sideways does nothing. 3 cm from centre = full stick | Settings → Stick |
| Stick → needle | **Aviation:** push forward → needle down | Settings → Test feel → Directions |
| Pedals | `A` = left, `D` = right. Both or neither = centre. Full pedal in 0.35 s, back in 0.25 s | Settings → Pedals (any key, including F13–F24) |
| Pedal → ball | **Step on the ball:** right pedal → ball moves left | Settings → Test feel → Directions |

**Input feedback.** The stick and pedal pictures at the bottom left of the test screen react to you:

- The pedal you press lights up at once.
- It fills (and sinks a little) as the pedal value builds up. The ball follows the fill, not the key.
- Holding both keys lights both pedals with no fill, because they cancel.
- The stick's ↑/↓ arrow lights up the way you push, and the grip moves with it.

The real test's icons look static, so **Settings → Training aids → Exam look** hides every aid at once for your final sessions. The Hardware test page shows the same pictures, larger, so you can check your keys or foot switch.

---

## 4. Matching the feel to the real test: the Tuning Lab

The real dynamics are unknown, so the app splits every setting into two layers:

- **Test-feel profile:** what the needle and ball do. You tune this once, and it carries over unchanged to a real joystick and pedals.
- **Device settings:** how your mouse and keys produce stick and pedal signals. You replace these when the hardware arrives.

Tools, in the order I suggest:

1. **Compare (1 or 2?).** Like an eye test, because recognising is easier than recalling.
   - You watch two versions that differ in **one** setting, with the same drift pattern and in random order, and pick the one closer to your memory.
   - About 6 rounds narrow the setting down.
   - "About the same" means your memory can't separate the two versions. That gap becomes the setting's **uncertainty range**.
   - Drift settings are shown hands-off. Response settings are shown with a scripted stick input. Neither involves your mouse or keys, so device quirks can't leak into the profile.
2. **Watch & adjust.**
   - Sliders change the instruments live, in three views: hands-off drift, a scripted response test, or your own controls.
   - A readout table translates the numbers into things you can remember, such as "hands off, it leaves the dot after 0.6 s" or "full stick takes it from the dot to the end stop in 1.1 s".
3. **Questionnaire.**
   - Answer only what you remember. "Not sure" keeps the current value.
   - The answers create a new profile. "How long ago did you take the test?" sets how wide the uncertainty ranges are.
4. **Free practice with live tuning keys:**
   - `[` and `]` choose a setting, and `−` and `=` change it.
   - Esc opens the full tuning drawer.
5. **Vary feel each run** (Settings → Training). In "uncertainty" mode, each run draws every tuned setting from inside its uncertainty range. This trains you to adapt instead of memorising one guess.

### What can be adjusted (per channel unless noted)

**Response:**
- control type: rate, where stick sets speed (default), or position, where stick sets position;
- response speed;
- heaviness / lag;
- delay before it reacts;
- **runaway** (the further off, the faster it escapes) or self-centring.

**Drift:**
- strength;
- restlessness (frequency);
- shoves (the brief's "bouncy" kicks): size and gap;
- steady pushes you must hold against;
- busy/calm swings;
- getting harder during a run.

**Global:**
- directions;
- needle swing at the end stop;
- pedals disturbing the needle, and the stick disturbing the ball (coupling).

---

## 5. How it works

- **Simulation** (`src/sim/`). These are pure modules with no DOM, so Node can test them.
  - Fixed 120 Hz physics. A seeded PRNG gives each drift component its own stream.
  - Order 1: `v += (G·u(t−delay) + drift − v)(1 − e^(−dt/lag))`, then `e += (v + runaway·e)·dt`, clamped at the end stops.
  - Drift: five sines (0.06–0.53 Hz, ±10 % per run, random phases), normalised to RMS = 1 and then × strength, plus the optional components. It eases in over 1.5 s.
- **Input timing.** Each mouse or key event is applied at the physics tick in which it happened. Mouse events come from `pointerrawupdate` where available. As a result, both the simulation and the input timing are independent of the monitor refresh rate. A run is always exactly N ticks.
- **Score**: `100 × max(0, 1 − RMS_you / RMS_hands-off)` for the same run, with the same seed and settings, re-simulated with zero input. 100 = perfect and 0 = no better than letting go. Time on target uses ±5° for the needle and 1 ball radius for the ball.
  - The score is fairly insensitive to drift strength, because both RMS values scale with it.
  - Time on target responds directly to difficulty. That's why difficulty also raises drift restlessness, and why both numbers are shown.
- **Replays.** The full 120 Hz inputs of the newest 30 sessions are stored as Float32. The live run uses exactly those Float32 values, so a replay re-simulates bit-exactly. Each replay checks itself against the stored result.

## 6. Tests

```bash
npm test                          # = node --test tests/*.test.js  (23 tests: sim, scoring, inputs, PWA rules)
node tests/e2e/run.mjs [shotDir]  # 19 browser checks in Playwright Chromium (app served under /compass-control/)
```

---

## 7. Assessment

### Built

Everything in the brief §1–§12. The gamepad support goes beyond a stub, plus the Tuning Lab described above.

### Deviations from the brief, and why

1. **The look follows the test-centre screenshot where it differs from the brief's text:**
   - light grey background (dark is a setting);
   - 16 dial tick positions (long ticks at 12, 3 and 6), not 12;
   - red dot about 10 % of the dial radius;
   - track panel about 44 % of the dial panel height, not 25 %;
   - 15 track ticks plus a white centre mark.
2. **Drift strength is normalised to RMS.** The default 0.17 equals the brief's level 3 (A = 0.5 peak-normalised), so the feel is unchanged but the number now means something.
3. **Difficulty 1–5 scales drift restlessness (×0.8 … ×1.25) as well as strength (×0.6 … ×1.5).** Otherwise the ratio score barely changes with difficulty.
4. **Extra model options, all off by default:** runaway / self-centring, input delay, steady pushes, busy/calm, intensity ramp, coupling, control type per channel, and lag in position mode.
5. **Cache cleanup uses an exact pattern (`^compass-control-v\d+$`), not a bare prefix.** A future `compass-control-something` app is never touched.
6. **Prefixes follow the serving folder at runtime**, so two copies under different repo names never share data. The manifest id is set with `tools/set-repo-name.mjs`.
7. **The mouse outlier guard is 2.5 cm per event (converted with your calibration), not 200 counts.** 200 counts would discard normal fast moves on a high-DPI mouse.
8. **The stick-position indicator is on by default.** A mouse has no centre you can feel, so the indicator stands in for it.
9. **Resuming after a pause gives a 3-2-1 countdown.** In free practice, Stop is on the pause screen, because a Stop button can't be clicked while the mouse is captured.
10. **Free practice is not saved to History.** It shows a summary instead.
11. **Name and icon:** "Control Trainer". "COMPASS" appears only in descriptions, with the disclaimer.

### Acceptance checks (§12)

| # | Check | Result |
|---|---|---|
| 1 | Same seed + same input → identical metrics at 30, 60 and 144 fps | **PASS** (Node). Driven with timestamped 1000 Hz mouse events and key events, not just per-tick scripts. |
| 2 | Sideways mouse has no effect; calibrated full travel = ±1 | **PASS.** Only `movementY` reaches the stick; the Hardware page shows ΣX to prove it is ignored. In the browser, pointer lock counted movement with the right sign. |
| 3 | Ramp times; both keys → 0; no stuck pedal after focus loss; auto-repeat ignored | **PASS** (Node + browser). |
| 4 | Losing focus, pointer lock or full screen pauses; paused time excluded | **PASS** (browser: 4.9 s paused, excluded; Node: identical metrics with and without a pause). |
| 5 | Zero input ≈ 0; `u = −2e` controller high; part-task scores only the active channel | **PASS** (0; > 70; scores only the active channel). |
| 6 | Offline after first load; manifest id; SW deletes only its own caches; prefixed storage | **PASS** (browser, with decoy caches `other-app-v1` and `compass-control-pro-v1` surviving). |
| 7 | Keyboard lock only in full screen, graceful fallback | Implemented: only called while `document.fullscreenElement` is set, and errors are ignored. **Needs your check in Chrome on Windows.** |

### Known issues and limits

- **Not yet tried on real Windows hardware:**
  - whether Chrome grants raw input (`unadjustedMovement`);
  - keyboard lock;
  - full screen and pointer lock requested from one click (there is a second-click fallback);
  - a real Alt+Tab;
  - the 10 cm calibration;
  - joysticks, rudder pedals and foot switches.

  In headless Linux Chromium, pointer lock works but raw input is not granted, which is expected on Linux.
- **The defaults are the brief's guesses.** The readouts show that, hands off, the default needle leaves the ±5° band after only about 0.6 s. If the real test felt calmer, lower the drift strength (Compare or the questionnaire will do it).
- **Fidelity limits:** a mouse has no sprung centre, and keys are on/off where pedals are proportional. This trains split attention and the direction mappings well, but not the feel of real pedals.
- **Compare tunes one setting at a time** and assumes the others are roughly right. Start with drift strength and response speed.
- **Sources:** the test-centre guide screenshot, public prep sites (search summaries only, because this build environment blocked opening the pages), and the manual-control literature (McRuer & Jex 1967; Jex et al. 1966), cited from knowledge rather than re-read.
- Firefox should run, but it has no raw input and no keyboard lock. It was not tested.

## 8. Files

```
index.html  styles.css  manifest.webmanifest  sw.js  icons/
src/main.js               router, service-worker registration, update prompt
src/config.js             app id → storage, cache and DB names
src/storage.js            prefixed localStorage + IndexedDB
src/state.js              settings (device, session, scoring, training, display) + profiles
src/input/                mouse-stick.js, keyboard-pedals.js, gamepad.js, index.js
src/sim/                  prng, disturbance, model, engine, scoring, profile, feel (pure, tested)
src/render/               instruments.js (test screen), charts.js
src/ui/                   screens (home/about), help (how to use), session, results, settings, tuning, hardware, history, fields, dom
tests/                    sim.test.js, pwa.test.js, e2e/run.mjs
tools/                    set-repo-name.mjs, make-icons.py
```
