# Avazyar roadmap

> **Status:** draft proposal, 13 October 2026. Not yet agreed with the repository owner.
> **Progress:** v0.1.1, v0.2 and the v0.3 items marked done are live. Items marked open are not started. Nothing is merged into `main` yet; the work sits in pull requests.
> **Sizes** are rough guesses for one developer: **S** = up to half a day, **M** = 1–3 days, **L** = a week or more.
> Milestones are ordered by dependency, not by date. No dates are promised.

## 1. Where we are

Avazyar is live at https://avazyar.noonbarbari.xyz, running v0.3. It is a small installable web app with no server-side logic.

**What it does today**

- Detects sung pitch in real time on the device, including quarter-tones (koron and sori).
- Nine lessons: warm-up, range test, home note, breath and sustain, match a note, do-re-mi, a first quarter-tone exercise in Shur, and two ear-training lessons that need no microphone.
- Levels: lessons get stricter as scores improve, and missed notes are offered again.
- A daily session of 5, 10 or 15 minutes that the app plans from the learner's own progress.
- A free tuner with a live pitch graph and a drone note for interval practice.
- A microphone check that adapts to room noise, and a screen that stays awake while practising.
- Scores, a daily streak and a chart of the last 20 scores.
- Works offline with nothing loaded from third parties. Progress is stored on the learner's device and can be backed up to a file.

**The biggest gaps**

- The curriculum is still short. The welcome screen promises notation "later", and nothing delivers it yet.
- Nothing has been tested with a real microphone, on an iPhone, or with a screen reader. All checks so far use simulated audio in desktop Chrome.
- Exercises use fixed notes (do-re-mi always starts on C, Shur always on D) rather than fitting the learner's range.
- No teacher has reviewed the lesson content.

## 2. Principles

These are the things the roadmap should not trade away.

1. **The voice never leaves the device.** No audio is uploaded, ever. This is the app's core promise.
2. **Works offline and installs like an app.** No account is needed to practise.
3. **Sound first, symbols later.** Learners sing before they read.
4. **Safe for beginners.** Vocal-health guidance stays visible; nothing rewards straining.
5. **Musically honest.** Lesson content is reviewed by a qualified avaz teacher before release.
6. **Small and simple.** No build step or framework until one clearly pays for itself.

## 3. The shape at a glance

| Milestone | Theme | What the learner gets |
|---|---|---|
| **v0.1.1** | Housekeeping | Nothing visible; the project is tidy and safe to build on |
| **v0.2** | Reliable practice | The app works on their phone, every time, and their progress is safe |
| **v0.3** | A real curriculum | Weeks of material that fits their own voice |
| **v0.4** | Hear yourself, see progress | Playback of their own singing and progress worth looking at |
| **v0.5** | Notation track | The reading skills the welcome screen promises |
| **v1.0** | The dastgah journey | A guided path through the full repertoire of modes |

## 4. Milestones

### v0.1.1 — Housekeeping

Small fixes found while deploying. None changes what the learner sees.

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| H1 | Merge pull request #1 (Docker deployment) | The repository should match what is actually running | S | Open: waiting for the repository owner |
| H2 | Fix the README: the run command points at a folder named `avaz-app` that does not exist, and the "online version" link points to the old GitHub Pages copy | New contributors hit a broken first step | S | Done |
| H3 | Host the Vazirmatn font ourselves instead of loading it from jsDelivr | First load stops depending on a third-party CDN, the app is fully offline from the first visit, and the security policy can be tightened to same-origin only | S | Done |
| H4 | Service worker: precache the maskable icon, tie the cache name to the app version, and show a "new version available" prompt | Learners get updates predictably instead of on some later reload | M | Done |
| H5 | Add a `.gitignore` | Keeps `.DS_Store` and similar files out of commits | S | Done |
| H6 | A one-command deploy script, documented in the README | Deploying is currently two commands typed from memory | S | Done |
| H7 | One version number used by the README, the settings page and the service worker | The version is typed in several places today | S | Done |
| H8 | Choose the canonical address and redirect the other copy (decision D1) | Two live copies means two separate sets of saved progress | S | Open: needs decision D1 |
| H9 | Add a licence file (decision D2) | Without one, nobody else can legally reuse or contribute | S | Open: needs decision D2 |

### v0.2 — Reliable practice

Make the existing six lessons dependable before adding more. Every later milestone builds on this.

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| R1 | Keep the screen awake during exercises | The warm-up runs for two minutes with no touch, so phones dim or lock in the middle of it | S | Done |
| R2 | Microphone check and noise calibration: a short setup step that measures room noise and input level | Loudness thresholds are fixed today, so a quiet microphone or a noisy room produces "I didn't hear enough" with no explanation | M | Done. Verified with simulated input; not yet tried in real rooms |
| R3 | iPhone and iPad pass: test in Safari and as a home-screen app, and add "Add to Home Screen" instructions | iOS never shows the install prompt the app relies on, and it has not been tested there | M | Partly: install instructions, icon and tags added. Not yet tested on an iPhone |
| R4 | Protect progress: export and import a backup file, ask the browser for persistent storage, and explain the risk in settings | Clearing site data wipes everything, and Safari may clear data for sites not opened for a week unless they are installed | M | Done |
| R5 | Add a version number and migrations to saved data | Needed before lessons are renamed or restructured, or existing learners lose their history | S | Done |
| R6 | Automated tests for the pure logic (note naming, pitch detection on synthetic tones, streaks, range fitting, scoring), run on every pull request | There are no tests; the pitch and naming code is easy to break silently | M | Done: 34 tests, plus a CI workflow |
| R7 | Pitch accuracy audit across real voices | See "Musical and technical accuracy" below; low male voices are the main concern | M | Partly: synthetic audit done (see section 5). Real voices still to test |
| R8 | Accessibility pass: announce pitch feedback as text, stop relying on colour alone, label the icon tabs, respect reduced-motion settings | The pitch graph is invisible to screen readers and the green/orange lines are hard for colour-blind learners | M | Done: automated audit is clean on every screen in both themes. Not yet tried with a real screen reader |
| R9 | Show a friendly message when something unexpected fails | An unhandled error currently leaves a blank or frozen screen | S | Done |
| R10 | Device test matrix (Android Chrome, Samsung Internet, iOS Safari, desktop) and a reachability check from inside Iran | The main audience's devices and networks have not been checked | S | Open: needs devices |

### v0.3 — A real curriculum

Turn six lessons into a course that adapts to the learner.

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| C1 | Describe lessons as data rather than code | Every lesson is hard-coded in one file today; this is the prerequisite for adding many more | M | Done |
| C2 | Fit exercises to the singer's range (کوک): transpose scales and dastgah exercises to the measured range | Do-re-mi always starts on C and Shur on D, which falls outside a beginner's comfortable range for many voices. Needs decision D6 | M | Open: needs decision D6 |
| C3 | Phrases, not only single notes: sing three to five notes in one breath, scored along the timeline | Real singing is movement between notes; holding isolated notes is only the first step | L | Open |
| C4 | Adaptive difficulty: tighten the tolerance as scores improve, repeat weak notes, and define clear "passed" levels | Tolerance is fixed per lesson, so lessons are either too easy or too hard | M | Done: three levels per lesson, missed notes repeated. Quarter-tones are never judged more strictly than 25 cents |
| C5 | Ear training without singing: higher or lower, same or different, natural or koron | Lets learners practise silently, for example on public transport | M | Done: "higher or lower?" and "E or E-koron?" |
| C6 | Drone practice: a sustained tonic to sing intervals against | A traditional and effective way to learn where the notes sit | S | Done. Needs headphones; not yet tried with a real microphone |
| C7 | New units: Mahur first (closest to the familiar major scale), then the Shur family (Dashti, Abu Ata, Bayat-e Tork, Afshari), with short concept cards for شاهد, ایست and فرود | This is the content learners came for. Written with a teacher (decision D5) | L | Open: needs a teacher (D5) |
| C8 | Breath and sustain: hold a note and measure length and steadiness | Breath support is the foundation of avaz and is easy to measure with what already exists | S | Done |
| C9 | A daily session of 5, 10 or 15 minutes built from warm-up, weak spots and one new thing | "Suggested for today" currently picks a single lesson | M | Done: planned from warm-up, one new lesson and the weakest practised ones; steps can be skipped |

### v0.4 — Hear yourself, see progress

| ID | Item | Why | Size |
|---|---|---|---|
| P1 | Record and play back an attempt next to the reference, on the device only and deleted automatically | Hearing your own voice is the fastest feedback a singer can get | M |
| P2 | Progress that means something: trends per lesson, range over time, accuracy per note, a weekly summary | Only the latest range is kept, and the chart mixes all lessons into one row of bars | M |
| P3 | Share a progress report through the phone's share sheet | The app tells learners to get feedback from a teacher; this gives them something to show | S |
| P4 | Shareable exercises: encode an exercise in a link so a teacher can send "practise this" | Adds a teacher workflow with no server and no accounts | M |
| P5 | Gentle motivation: milestones, and a way to keep a streak through a missed day | Keeps beginners coming back without pressure | S |
| P6 | Reference sound options: a softer voice-like tone and instrument samples such as setar or ney | The synthetic tone is hard for some beginners to match. Needs decision D7 | M |
| P7 | A child-voice preset and finer voice presets | Only "male" and "female" starting ranges exist | S |

### v0.5 — Notation track

Delivers the promise made on the welcome screen: reading comes after singing, built on what the learner can already do.

| ID | Item | Why | Size |
|---|---|---|---|
| N1 | Name-the-note games using notes the learner already sings | Connects sound to names before any symbols appear | M |
| N2 | Staff basics, including the koron and sori signs | The first step into written Persian music | L |
| N3 | Sight-singing: see a short phrase, sing it, get scored | Reuses the phrase scoring from C3 | M |
| N4 | Rhythm basics: pulse, note lengths and simple patterns with tap-along | The app has no rhythm training at all today | L |

This is the likely point where a rendering library or a build step becomes worth it (decision D3).

### v1.0 — The dastgah journey

| ID | Item | Why | Size |
|---|---|---|---|
| J1 | All seven dastgahs and five avazes as guided units, each with its scale, key notes, an opening phrase and a few important gushehs | A complete beginner-to-intermediate path | L |
| J2 | Tahrir trainer for the characteristic vocal ornament | The signature technique of avaz. Depends on faster pitch tracking from R7 | L |
| J3 | Singing with poetry: fit a verse to a phrase, then simple tasnifs with rhythm | Avaz is sung poetry; notes alone are not the art | L |
| J4 | Tuning options: adjustable koron and sori per dastgah | See "Musical and technical accuracy" below | M |
| J5 | English interface | Opens the app to diaspora learners who speak but do not read Persian | M |
| J6 | App-store presence: an Android package for Google Play and Iranian stores such as Cafe Bazaar and Myket | Many learners look for apps in a store, not on the web | M |

### Later — only if learners ask for it

All of these need a server, which changes the cost and the privacy story. None should be started without clear demand.

- Optional sync of progress between devices.
- Practice reminders. On the web these need a push server; there is no reliable way to schedule them on the device alone.
- A teacher view for following several students.
- Community features such as shared challenges.

## 5. Musical and technical accuracy

These are open questions rather than tasks. Each needs a teacher or real-voice testing before anyone writes code.

- **Quarter-tones are exact today.** The app places koron and sori exactly halfway between semitones. In practice Persian intervals are not fixed quarter-tones; they vary by dastgah and by performer, and the equal-quarter-tone model is disputed among musicians. The Shur lesson's strict 25-cent tolerance may therefore mark a stylistically correct note as wrong. J4 addresses this; the tolerance should be reviewed sooner.
- **Two note names look unusual.** The note a quarter-tone above E is shown as «فا کرن» and the one above B as «دو کرن». A teacher should confirm whether «می سری» and «سی سری» would be more natural.
- **Low voices.** The detector's comparison window is about 27 ms, barely more than two cycles of a note around 80 Hz, which looked like a risk for bass voices. Measured on synthetic voice-like tones it is not: detection stays within 3 cents from C2 to C6, including quarter-tones, and the tests now enforce that. No change to the window is needed on this evidence. Real voices, especially breathy or quiet ones, are still untested.
- **Voice-type estimate.** The bass/baritone/tenor and alto/mezzo/soprano labels come from simple range midpoints. They are presented as an estimate; a teacher should check that the labels are not misleading for beginners.

## 6. Decisions needed

| ID | Decision | Why it matters | Suggestion |
|---|---|---|---|
| D1 | Stay on `avazyar.noonbarbari.xyz` or move to a dedicated domain? | Saved progress, microphone permission and the installed app are all tied to the address. Moving later costs every existing learner all three | Decide before promoting the app |
| D2 | Which licence? | The repository is public with no licence, so reuse and contributions are legally unclear | Owner's call |
| D3 | Keep the no-build-step approach? | It keeps the project simple, but notation rendering may need libraries | Keep it through v0.4, revisit at v0.5 |
| D4 | Usage statistics and crash reports: none, or opt-in? | Without them nobody knows which lessons work or which devices fail. With them the privacy promise needs careful wording | Opt-in only, self-hosted, never any audio. Plausible and GlitchTip already run on the same server |
| D5 | Who writes and reviews the musical content? | Everything from v0.3 onwards depends on it | Involve an avaz teacher before C7 |
| D6 | When an exercise is transposed, do note names follow the actual pitch or stay as do-re-mi? | Affects every lesson once C2 lands | Ask a teacher which convention their students expect |
| D7 | Where do instrument samples come from? | Recordings need a licence that permits redistribution | Record our own or use clearly licensed samples |
| D8 | Does the repository owner agree with this roadmap? | It was drafted from outside the project | Review together before v0.2 starts |

## 7. Risks

- **Content quality.** Features are the easy part. Without a teacher, new lessons could teach habits a real teacher has to undo.
- **iOS audio behaviour.** Microphone and audio handling differ on iPhone and are untested. R3 could turn out larger than estimated.
- **Losing learners' progress.** Until R4 and R5 are done, any storage clean-up or lesson restructuring can erase history.
- **Reachability.** The server is in France and the font comes from a CDN. Neither has been checked from inside Iran.
- **One growing file.** Almost all behaviour lives in `js/app.js`. Adding lessons without C1 first will make it hard to change safely.

## 8. Not planned

- Uploading or processing voice on a server.
- Requiring an account to practise.
- Replacing a teacher. The app says so itself and should keep saying it.

## 9. Suggested next steps

1. Agree on D1 (address) and D2 (licence), then finish v0.1.1.
2. Test on a real iPhone and with three or four different voices. This sizes R3 and R7 properly.
3. Find a teacher willing to review the existing six lessons and section 5. Their answers shape v0.3.
