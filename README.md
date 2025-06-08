# Magic Slider

A JSON-driven template project to generate [Reveal.js](https://revealjs.com/) presentations dynamically from JSON templates.

## Getting Started

Install dependencies:
```bash
npm install
# or yarn
```

Start the development server:
```bash
npm run dev
```

Open http://localhost:5173 in your browser. The default template _basic_ will be loaded.

## Usage

Templates are JSON files located in `public/templates`. You can select a template by adding a `template` query parameter to the URL.

- **basic**: Basic slides example
- **code-highlight**: Slide with syntax-highlighted code sample
- **image-background**: Slide with a background image
- **with-notes**: Slide with speaker notes

For example:
```text
http://localhost:5173/?template=code-highlight
```

### Template Format

Each template must define an array of slides and can optionally include Reveal.js options and plugins:

```json
{
  "revealOptions": {
    "hash": true,
    "slideNumber": true
  },
  "plugins": ["highlight", "notes"],
  "slides": [
    {
      "title": "Slide Title",
      "content": "<p>HTML content for the slide.</p>",
      "backgroundImage": "path/to/image.jpg",
      "attributes": {
        "data-state": "intro",
        "data-note": "Speaker notes here"
      }
    }
  ]
}
```

## Creating Your Own Template

1. Add a JSON file in `public/templates` (e.g., `custom.json`).
2. Define your `slides`, optional `plugins`, and `revealOptions` as shown above.
3. Open the presentation with your template:
   ```text
   http://localhost:5173/?template=custom
   ```

## Building for Production

Build the project:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```
