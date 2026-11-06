# Kettlebell

An offline kettlebell training app: daily workout from a plan file, tap-to-log sets, timers with voice cues, a movement library, history and backup. Installs to the iPhone home screen and works with no connection. All data stays on the phone.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/kb-app/
npm run check    # type-check, tests, production build
```

## Data

- `data/plan.json`: the training plan (phases → weeks → days A/B/C/REST → items)
- `data/movements.json`: the movement library

Both are checked against the schema in `src/engine/schema.ts` on every build. The plan engine is in `src/engine/engine.ts`.

## Voice clips

Spoken cues are recorded WAV clips in `public/voice/` (manifest: `src/voice/clips.json`), played through Web Audio so they mix with music. iPhone's built-in speech voice stops other apps' music, so the app doesn't use it. After changing spoken words or station labels, re-record on Windows:

```bash
npm run voice    # KB_VOICE=Zira or David for another installed voice
```

The voice test fails if anything the timers say has no clip.

## Publish

```bash
npm run deploy   # checks, pushes main, then publishes dist/ to the gh-pages branch
```

GitHub Pages serves the `gh-pages` branch at `https://<user>.github.io/kb-app/`. Commit first; the script refuses to publish uncommitted changes.
