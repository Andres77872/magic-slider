import { describe, expect, it } from 'vitest'

import { validatePresentation } from './presentationSchema'
import { templateMigrationFixtures } from './templateMigrationFixtures'

const templateModules = import.meta.glob('../../public/templates/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function templateFileName(templatePath: string): string {
  const segments = templatePath.split('/')
  return segments[segments.length - 1] ?? templatePath
}

describe('presentation template migration fixtures', () => {
  it('documents every public template so fixture drift is explicit', () => {
    const actualTemplateFiles = Object.keys(templateModules).map(templateFileName).sort()
    const documentedTemplateFiles = templateMigrationFixtures.map((fixture) => fixture.fileName).sort()

    expect(documentedTemplateFiles).toEqual(actualTemplateFiles)
    expect(templateMigrationFixtures.every((fixture) => fixture.reason.trim().length > 0)).toBe(true)
  })

  it.each(templateMigrationFixtures)('$fileName follows its documented migration status', (fixture) => {
    const rawTemplate = templateModules[`../../public/templates/${fixture.fileName}`]
    expect(rawTemplate).toBeDefined()

    const parsedTemplate: unknown = JSON.parse(rawTemplate)
    const validation = validatePresentation(parsedTemplate)

    if (fixture.status === 'cleaned') {
      expect(validation).toMatchObject({ ok: true })
      return
    }

    expect(validation).toMatchObject({ ok: false })
    expect(fixture.reason).toMatch(/migration|structured|legacy|cleanup|unsupported/i)
  })
})
