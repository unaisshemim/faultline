import { describe, expect, it } from 'vitest'
import { seedSnapshot } from './seed.js'
import { calculateCapacity, suggestOwner } from './assignment.js'

describe('assignment decisions', () => {
  it('chooses Leena for a four-hour installation task when Arjun only has two hours', () => {
    const state = seedSnapshot()
    const result = suggestOwner(state, { requiredResponsibility: 'installation', effortHours: 4 })
    expect(result.owner?.id).toBe('leena')
    expect(result.candidates.find(c => c.employeeId === 'arjun')?.eligible).toBe(false)
    expect(result.reason).toContain('16')
  })
  it('does not substitute an unrelated employee or invent capacity', () => {
    expect(suggestOwner(seedSnapshot(), { requiredResponsibility: 'design', effortHours: 1 }).owner).toBeNull()
    expect(suggestOwner(seedSnapshot(), { requiredResponsibility: 'operations', effortHours: 40 }).owner).toBeNull()
  })
  it('counts pending work and frees completed or cancelled work', () => {
    const state = seedSnapshot()
    state.tasks[0].status = 'awaiting_acceptance'
    expect(calculateCapacity(state).find(e => e.id === 'arjun')?.availableHours).toBe(2)
    state.tasks[0].status = 'completed'
    expect(calculateCapacity(state).find(e => e.id === 'arjun')?.availableHours).toBe(8)
    state.tasks[0].status = 'cancelled'
    expect(calculateCapacity(state).find(e => e.id === 'arjun')?.availableHours).toBe(8)
  })
  it('rejects missing responsibility and invalid effort instead of guessing', () => {
    expect(() => suggestOwner(seedSnapshot(), { requiredResponsibility: '', effortHours: 4 })).toThrow()
    expect(() => suggestOwner(seedSnapshot(), { requiredResponsibility: 'operations', effortHours: 0 })).toThrow()
  })
})
