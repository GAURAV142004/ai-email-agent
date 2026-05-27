import { describe, it, expect } from 'vitest'
import { parseMarkdownTableOrList } from '../lib/documents/index'

describe('parseMarkdownTableOrList', () => {
  it('parses markdown tables correctly into headers and rows', () => {
    const markdown = `
      Here is the project status:
      
      | Date | Project | Task | Status |
      |------|---------|------|--------|
      | 2026-05-27 | Agent Alpha | Sync core inbox | Complete |
      | 2026-05-28 | Agent Beta | Deploy watch hook | Pending |
      
      Please let me know if you need changes.
    `
    
    const parsed = parseMarkdownTableOrList(markdown)
    expect(parsed.headers).toEqual(['Date', 'Project', 'Task', 'Status'])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toEqual(['2026-05-27', 'Agent Alpha', 'Sync core inbox', 'Complete'])
    expect(parsed.rows[1]).toEqual(['2026-05-28', 'Agent Beta', 'Deploy watch hook', 'Pending'])
  })

  it('parses fallback bulleted lists correctly into a single column', () => {
    const listContent = `
      Here are the main action items:
      - Gaurav to fix token key issue
      - Refactor access guard logic
      - Build the download endpoint
    `
    
    const parsed = parseMarkdownTableOrList(listContent)
    expect(parsed.headers).toEqual(['Report Content'])
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.rows[0]).toEqual(['Here are the main action items:'])
    expect(parsed.rows[1]).toEqual(['Gaurav to fix token key issue'])
    expect(parsed.rows[2]).toEqual(['Refactor access guard logic'])
    expect(parsed.rows[3]).toEqual(['Build the download endpoint'])
  })
})
