interface Template {
  name: string
  description: string
}

const templates: Template[] = [
  { name: 'basic', description: 'Basic slides example' },
  { name: 'code-highlight', description: 'Syntax-highlighted code sample' },
  { name: 'image-background', description: 'Slide with background image' },
  { name: 'with-notes', description: 'Slide with speaker notes' },
]

const list = document.getElementById('template-list')
if (list) {
  templates.forEach((t) => {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.textContent = t.name
    a.href = `/slider.html?template=${t.name}`
    li.appendChild(a)
    if (t.description) {
      const span = document.createElement('span')
      span.textContent = ` - ${t.description}`
      li.appendChild(span)
    }
    list.appendChild(li)
  })
}