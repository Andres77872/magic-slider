# Magic Slider

A presentation studio built with React, TypeScript, Vite, and [Reveal.js](https://revealjs.com/). Describe a deck, refine it through chat, and present the result from a live preview. Generation uses a configured Magic API agent endpoint.

## Run locally

Use Node.js **22.22.2+, 24.15.0+, or 26+** and **pnpm 12.6.0**, the version pinned in `package.json`. CI checks Node 22 and 24. If pnpm is not installed, run `npm install --global pnpm@12.6.0` or follow the [pnpm installation guide](https://pnpm.io/installation).

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Edit `.env.local` for your backend:

```dotenv
VITE_API_URL=http://localhost:7000/v1/chat/completions
VITE_AGENT_MODEL=agt-your-presentation-agent-id
```

The API must be running separately and reachable from your browser. Configure its CORS policy to allow the frontend origin, normally `http://localhost:5173`. The model is the public agent routing ID configured on your backend. Use `localhost` or a reachable hostname, rather than the server bind address `0.0.0.0`.

```bash
pnpm dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Restart the development server after changing environment variables.

## Create, refine, and present

1. Describe the topic, audience, and goal, then choose **Generate Slides**. For example: “A 7-slide briefing on the state of solar and wind power in 2026 for a city council, with key figures and sources.” Open **Presentation options** to set the length, audience, tone, and theme, or to turn web research and original images off for a request. Or start from the **example catalog** under the request box: 18 examples in six categories (business, education, research and data, technical, marketing, personal and events) each fill in a request and its options, which you can edit before generating.
2. Review the deck in the presentation workspace. The slide navigator under the preview shows every slide with its layout; select one to jump to it with all of its points visible. Choose **Notes** to read the speaker notes, cited sources, and image descriptions for the current slide.
3. Send follow-up requests such as “Tighten slide 3,” “Add a timeline after slide 4,” or “Switch to the paper theme,” or pick a suggested change above the chat input. You can cancel an active request from the chat. **Undo** and **Redo** step through the versions produced in this browser tab.
4. Collapse the chat for a larger preview. Focus the slides to use keyboard navigation, or use the on-screen controls. Choose **Present** to show only the slides in fullscreen where supported; press Escape to leave fullscreen.
5. Choose **Export HTML** to download a self-contained presentation you can open directly in a browser. The viewer, theme, speaker notes, and highlighted code are bundled, and images are embedded when their host allows it; the toolbar reports any image that stays linked and needs an internet connection. **Export JSON** downloads the editable deck configuration. Exports exclude conversation history and API credentials.
6. Use **New Presentation** to start another deck, or **Recent Sessions** to restore a previous deck and its conversation.

History is stored only in this browser. It retains up to ten sessions, with up to 200 messages and 200 action records per session. Storage limits can remove older sessions while preserving the selected one. **Clear History** asks for confirmation, then removes all saved local sessions. If saving fails, current work remains available in memory and **Retry** attempts to save it again; export the deck before closing the page if browser storage remains unavailable.

## API configuration

The client posts an OpenAI-compatible chat payload with `model`, `messages`, and `stream: true` to the complete `VITE_API_URL`. Every request starts with a system message carrying today's date (so research on current topics uses the right period) and, for refinements, the current validated deck; up to fifteen eligible messages from the selected session follow. Other sessions are excluded.

The endpoint must return a server-sent event stream ending with `[DONE]`. Supported presentation actions are `create_deck`, `add_slide`, `edit_slide` (a `null` field removes it), `delete_slide`, `reorder_slides`, and `update_deck` (theme, title, language, plugins, and Reveal options); a complete presentation JSON response is also supported. Incomplete streams and invalid actions leave the existing deck intact. Clarifying questions and image-generation warnings appear in chat without replacing your current slides. Web research and image generation run through the backend agent’s fetch tools using `{{ env.TAVILY_API_KEY }}` and `{{ env.FAL_AI_API_KEY }}`; keep those keys on the backend and never add them to a `VITE_*` variable. See [the frontend contract](src/agent/agentContract.ts) and [action schemas](src/domain/presentationActions.ts) for integration details.

Optional settings are documented in [.env.example](.env.example):

- `VITE_AGENT_API_KEY`: bearer credential when your API requires browser authentication, including local deployments. Configure a real credential accepted by that endpoint; leave it unset only for an endpoint that explicitly permits unauthenticated requests.
- `VITE_AGENT_REQUEST_TIMEOUT_MS`: total request timeout, default `300000`.
- `VITE_AGENT_IDLE_TIMEOUT_MS`: maximum wait between response chunks, default `120000`.
- `VITE_AGENT_MAX_STREAM_BYTES`: response size limit, default `1000000`.

**Every `VITE_*` value is public browser configuration.** Vite embeds these values in the client bundle, including `VITE_AGENT_API_KEY`. Use only credentials intended for the browser client; keep provider secrets and privileged API keys on your backend. Production environment values must be supplied when building the app. See [Vite’s environment documentation](https://vite.dev/guide/env-and-mode).

## Validation and rendering

Zod validates generated decks and actions before they reach the preview. Decks contain one to fifty slides and may set a `title`, a BCP 47 `language` (used for the exported document), and one of six themes: `midnight`, `aurora`, `ember`, `ocean`, `forest`, or `paper`. Each slide picks a layout — `title`, `section`, `content`, `split`, `statement`, `quote`, `stats`, `comparison`, `timeline`, or `closing` — and may carry a kicker, subtitle, key figures, columns, timeline steps, a quotation, a code block, an image with required alt text, source citations, and progressive fragments. The [showcase template](public/templates/showcase.json) uses every field.

All text renders as text; raw HTML in slide content is rejected. Image and background URLs, source links, attributes, plugins, and Reveal options pass through explicit allowlists, and citation links open in a new tab without a referrer. Slides use a 16:9 canvas; text-heavy slides step down in size to stay on the slide, and image backgrounds get a gradient scrim so titles stay readable. Reveal navigation is scoped to the focused preview so typing in chat does not change slides.

The [template fixtures](public/templates) demonstrate the supported JSON shape. They are fixtures for development and validation, not a separate import screen.

## Checks and production build

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests cover the API stream parser, action application, session persistence, presentation rendering, and workspace behavior. They use deterministic fixtures and do not require a live API. [GitHub Actions](.github/workflows/checks.yml) runs these checks with a frozen dependency lockfile on pushes and pull requests.

`pnpm build` writes the static app to `dist/`. Configure the production API URL and agent ID before building, then serve `dist/` with your static host. An HTTPS frontend needs a reachable HTTPS API. To inspect the build locally:

```bash
pnpm preview
```

## Local browser smoke test

Run `pnpm dev:replay` and open http://127.0.0.1:5175 for a fixed SSE replay with no API credentials. This separate origin preserves normal development history. Any prompt creates a small multi-layout deck; set `REPLAY_DECK=/path/to/deck.json` to replay any validated deck instead, such as an **Export JSON** file. Follow-up prompts edit slide 2. Use `test slow` to check cancellation and `test error` to check rate-limit feedback. Verify navigation, export, fullscreen, session switching, and reload restoration. Stop with Ctrl+C.

Replay verifies the frontend contract; it does not establish compatibility or authentication with a live backend.

TypeScript remains on 6.0.3, the latest version supported by the current `typescript-eslint` peer range (`<6.1`). All other direct packages use their current stable releases; ESLint is an explicit development dependency.
