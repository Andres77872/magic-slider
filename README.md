# Magic Slider

A React + Vite application that generates interactive [Reveal.js](https://revealjs.com/) presentations using the OpenAI Chat API.

## Getting Started

1. Copy `.env.example` to `.env` and add your OpenAI API key:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser.

## Usage

- Enter a prompt describing the presentation you want (e.g., "Create a 5-slide presentation about AI").
- Click **Generate Slides**.
- Watch the JSON configuration stream in the box and, once complete, the slides will render below.

## Example JSON

You can test with a static JSON config by pasting it into the prompt (or editing the code). For example:

```json
{
  "plugins": ["highlight", "notes"],
  "slides": [
    {
      "title": "Introduction",
      "content": "<p>Welcome to the presentation.</p>"
    }
  ]
}
```

## Building for Production

Build the optimized output:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## Testing with Custom JSON

If you want to render slides from your own JSON (for example, testing API-generated output), you can use the built-in localStorage loader:

1. Open the **slider.html** page in your browser (e.g., <http://localhost:5173/slider.html>).
2. Open the browser console and paste your JSON into a variable, then store it in localStorage:

   ```js
   const customConfig = { /* your JSON presentation config */ };
   localStorage.setItem('generatedSlides', JSON.stringify(customConfig));
   window.location.reload();
   ```

The slideshow will render your custom slides on reload.
