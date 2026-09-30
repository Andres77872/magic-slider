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

## Create, refine, and present (classic v1)

These steps cover the classic v1 studio at `/v1/`. The default studio at `/` is v2; see [Magic Slider v2](#magic-slider-v2-the-primitive-studio).

1. Describe the topic, audience, and goal, then choose **Generate Slides**. For example: “A 7-slide briefing on the state of solar and wind power in 2026 for a city council, with key figures and sources.” Open **Presentation options** to set the length, audience, tone, and theme, or to turn web research and original images off for a request. Or start from the **example catalog** under the request box: 18 examples in six categories (business, education, research and data, technical, marketing, personal and events) each fill in a request and its options, which you can edit before generating.
2. Review the deck in the presentation workspace. The slide navigator under the preview shows every slide with its layout; select one to jump to it with all of its points visible. Choose **Notes** to read the speaker notes, cited sources, and image descriptions for the current slide.
3. Send follow-up requests such as “Tighten slide 3,” “Add a timeline after slide 4,” or “Switch to the paper theme,” or pick a suggested change above the chat input. You can cancel an active request from the chat. **Undo** and **Redo** step through the versions produced in this browser tab.
4. Collapse the chat for a larger preview. Focus the slides to use keyboard navigation, or use the on-screen controls. Choose **Present** to show only the slides in fullscreen where supported; press Escape to leave fullscreen.
5. Choose **Export HTML** to download a self-contained presentation you can open directly in a browser. The viewer, theme, speaker notes, and highlighted code are bundled, and images are embedded when their host allows it; the toolbar reports any image that stays linked and needs an internet connection. **Export JSON** downloads the editable deck configuration. Exports exclude conversation history and API credentials.
6. Use **New Presentation** to start another deck, or **Recent Sessions** to restore a previous deck and its conversation.

History is stored only in this browser. It retains up to ten sessions, with up to 200 messages and 200 action records per session. Storage limits can remove older sessions while preserving the selected one. **Clear History** asks for confirmation, then removes all saved local sessions. If saving fails, current work remains available in memory and **Retry** attempts to save it again; export the deck before closing the page if browser storage remains unavailable.

## Magic Slider v2: the primitive studio

v2 is the default studio at **`/`** (for example `http://localhost:5173/`). The classic v1 studio moved to **`/v1/`** and links back to v2 from its home page. Old `/v2/` links redirect to `/`.

In v2 the agent does not pick one of ten fixed layouts. It composes each slide from **22 renderer-agnostic primitives**:

- **Layout:** stack, grid, box.
- **Text:** heading, text, list, quote, callout, badge, divider, spacer.
- **Media:** image, icon, video, profile.
- **Data:** stat, chart (8 kinds), table, progress, code.
- **Narrative:** timeline, diagram (flow, cycle, hub, pyramid, funnel, matrix, venn).

Every slide and block has a stable id, so follow-up requests edit exactly what you ask.

- **Create:** describe a deck, set length, audience, tone, one of 12 themes, research and images, then watch slides appear while the agent streams them. You can also start from a blank presentation or a template, or import JSON; v1 exports are converted into primitives.
- **Edit it yourself:** the **Edit** view shows the current slide with every element selectable:
  - Hover outlines each element. Click selects the innermost one; **Esc** (or Shift+Enter) selects its parent. The breadcrumb in the **Design** tab shows the whole path.
  - A contextual toolbar above the selection edits text, selects the parent, moves the element up or down, duplicates it, asks the AI about it, or deletes it.
  - Double-click (or **Enter**) edits text in place. That works for headings, paragraphs, list items, stat parts, quotes, callouts, table cells, timeline and diagram labels, and captions. The rich-text markers stay visible while you type; Ctrl/Cmd+B, I, E and K wrap the selection.
  - **Insert** (or `/`) opens a searchable picker with all 22 primitives. The new block goes inside the selected container, after the selected block, or at the end of the slide.
  - **New slide** in the filmstrip offers 12 layouts: blank, title, section break, bullets, text and image, cards, key numbers, chart, timeline, table, quote and closing.
- **Every setting has a control:** the **Design** tab is generated from each primitive's schema and grouped into Content, Layout, Style and Animation. A new primitive or prop gets an editor automatically.
  - Controls include text with a formatting bar, segmented choices, theme-aware color pickers, an icon picker, image URLs with a preview, and reorderable item lists.
  - Charts and tables get spreadsheet-style data grids.
  - Fields commit on Enter or blur and Esc reverts, so each change is one undo step. Invalid values show an inline error instead of breaking the deck.
  - With no block selected, the tab edits the slide's name, alignment, spacing, tone, background (color, gradient or image) and transition.
  - The other tabs: **Notes** for speaker notes and sources; **Theme** for the title, language, theme swatches, fonts, radius, decoration, color overrides and viewer settings; **Layers** for a keyboard-navigable block tree; **JSON** for the raw deck; **Issues** for validation notes.
- **Manage slides:** the filmstrip is a keyboard-accessible list.
  - Drag slides to reorder them, or use Alt+←/→.
  - Right-click, the ⋯ button or Shift+F10 opens a menu to reference, duplicate, copy, paste, move or delete a slide.
  - Ctrl/Cmd+C, X and V copy and paste blocks and slides, also across tabs. **Grid** shows every slide at once.
- **Undo:** agent edits and manual edits share one operation path and one undo history (Ctrl/Cmd+Z, Shift for redo). Deletions show a toast with **Undo**.
- **Point the agent at exactly what you mean:** type `@` in the chat to reference slides and elements, e.g. "update this image @hero-image and tighten @market-size".
  - Suggestions start with the slide you are viewing and its elements. Arrow keys and Enter pick one.
  - There are three other ways to add a reference: **Ask AI** on the selection toolbar or in the Design tab, the `@` key (or Ctrl/Cmd+J) with something selected, or dragging a slide thumbnail or a layer onto the composer.
  - References show as highlighted tokens and removable chips. The current selection is offered as a suggested chip; it is sent as context unless you dismiss it.
  - The agent receives every referenced slide or block in full, plus its id.
  - In the conversation, references and the slides each reply changed are links that jump to them. The latest agent change has a **Revert** button.
  - You can keep editing while the agent works; its operations apply by id on top of your changes.
- **Present and export:** **Preview** runs the live Reveal viewer. **Present** (or `P`) goes fullscreen from the current slide. **Export** writes a self-contained Reveal HTML file with the same styles, fonts and auto-fit, or downloads the deck JSON.
- **Keyboard shortcuts:** press `?` to list them.
- **Primitive gallery:** shows every primitive, in any theme, next to its JSON.

Generated output is repaired, not rejected. Near-miss values are coerced or dropped: numbers as strings, overlong text, wrong enum case, unknown props, aliases such as `paragraph` or `kpi`, and v1-style slides. Each change is reported in the **Issues** tab. An invalid block is skipped without losing its slide, and a failing edit operation is skipped without losing the others. Slides whose content overflows the 16:9 canvas are scaled to fit. The rail marks them, and the next request tells the agent which slides were too dense.

Configure v2 with `VITE_AGENT_MODEL_V2` (see [.env.example](.env.example)). `pnpm dev:replay` also serves a credential-free v2 replay at `http://127.0.0.1:5175/`. It streams the primitives tour. Follow-ups edit the items you @reference: text blocks get a ✦ and slides turn accent. Without a reference, a follow-up accents the focused slide.

**The v2 agent** is [`agent/magic-slider-v2.graph.json`](agent/magic-slider-v2.graph.json), generated from the catalog by `pnpm agent:v2`. A test fails if the committed graph drifts from the code.

- Two private server-tool stages run in parallel: web research (Tavily search and extract, which returns facts, chart-ready datasets, quotes and events with sources) and visual design (fal.ai images, theme and font suggestions).
- They feed a streaming author stage whose only tools are the client-side `create_presentation` and `edit_presentation`.
- Publish it as a public agent with:

```bash
/home/andres/PycharmProjects/api.magic_llm/.venv/bin/python scripts/publish-agent-v2.py --base-url http://192.168.1.90:7000 --username root
```

The script prompts for the password and logs in. It then creates the agent as public through `api.magic_llm/scripts/manage_agent.py` (use `--update <agt-id>` to update in place), checks that the agent is publicly listed, and writes `VITE_AGENT_MODEL_V2` to `.env`. Architecture, contract and design notes are in [docs/v2-primitives.md](docs/v2-primitives.md).

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
