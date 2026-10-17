import { expect, it } from 'vitest'
import { seedSnapshot } from './seed.js'
import { tailorDemoContext } from './demo-context.js'
import { suggestOwner } from './assignment.js'

it('renames saved Kamstrup samples to Itron once', () => {
  const state = seedSnapshot()
  const expected = structuredClone(state)
  for (const task of state.tasks) {
    for (const key of ['title', 'description', 'assignmentReason'] as const) task[key] = task[key].replaceAll('Itron', 'Kamstrup')
  }
  for (const row of [...state.updates, ...state.messages]) row.text = row.text.replaceAll('Itron', 'Kamstrup')
  expect(tailorDemoContext(state)).toBe(true)
  expect(state).toEqual(expected)
  expect(tailorDemoContext(state)).toBe(false)
})

it('renames saved Aegir samples once while retaining edits, lifecycle state, and history', () => {
  const state = seedSnapshot()
  for (const task of state.tasks) {
    for (const key of ['title', 'description', 'assignmentReason'] as const) {
      task[key] = task[key].replaceAll('Itron', 'Aegir')
        .replace('Confirm demo meter delivery', 'Confirm US-20 meter delivery')
        .replace('demo meters across', 'demo US-20 meters across')
    }
  }
  for (const row of [...state.updates, ...state.messages]) row.text = row.text.replaceAll('Itron', 'Aegir')
  state.tasks[0].status = 'completed'
  state.tasks[0].description = 'Custom Aegir scope'
  state.updates[0].text = 'My Aegir progress reply'
  state.tasks.push({ ...state.tasks[0], id: 'custom', actionKey: 'user:1', title: 'Custom Aegir task' })
  state.chats.push({ id: 'saved', messages: [{ text: 'Discuss Aegir' }], updatedAt: '2030-01-01' })
  const original = structuredClone(state)
  expect(tailorDemoContext(state)).toBe(true)
  expect(state.tasks[0].title).toBe('Confirm Itron meter installation readiness')
  expect(state.tasks[0].description).toBe('Custom Aegir scope')
  expect(state.tasks[0].status).toBe('completed')
  expect(state.tasks[0].dueAt).toBe(original.tasks[0].dueAt)
  expect(state.tasks[0].ownerId).toBe(original.tasks[0].ownerId)
  expect(state.tasks.at(-1)).toEqual(original.tasks.at(-1))
  expect(state.updates[0].text).toBe('My Aegir progress reply')
  expect(state.messages[0].text).toContain('Itron')
  expect(state.chats).toEqual(original.chats)
  expect(tailorDemoContext(state)).toBe(false)
})

it('routes Itron installation, billing, and IoT work to qualified staff with capacity', () => {
  const state = seedSnapshot()
  expect(suggestOwner(state, { requiredResponsibility: 'installation', effortHours: 4 }).owner?.id).toBe('leena')
  expect(suggestOwner(state, { requiredResponsibility: 'billing', effortHours: 4 }).owner?.id).toBe('nisha')
  expect(suggestOwner(state, { requiredResponsibility: 'iot', effortHours: 4 }).owner?.id).toBe('dev')
  expect(suggestOwner(state, { requiredResponsibility: 'iot', effortHours: 13 }).owner).toBeNull()
})
it('upgrades old seed content once while preserving user work and lifecycle state', () => {
  const state = seedSnapshot()
  state.employees = state.employees.filter(e => e.id !== 'dev')
  state.tasks = state.tasks.filter(t => t.ownerId !== 'dev')
  state.tasks[0].title = 'Review vendor agreements'
  state.tasks[0].description = 'Review the three renewal agreements and flag any changes in terms.'
  state.tasks[0].status = 'completed'
  state.tasks[0].nextFollowUpAt = '2030-12-01T12:00:00Z'
  state.tasks.push({ ...state.tasks[0], id: 'custom', title: 'My custom work', actionKey: 'user:1' })
  state.updates[0].text = 'My actual progress reply'
  state.chats.push({ id: 'founder-maya', messages: [{ text: 'Saved conversation' }], updatedAt: '2030-01-01' })
  expect(tailorDemoContext(state)).toBe(true)
  expect(state.tasks[0].title).toContain('Itron')
  expect(state.tasks[0].status).toBe('completed')
  expect(state.tasks[0].nextFollowUpAt).toBe('2030-12-01T12:00:00Z')
  expect(state.tasks.find(t => t.id === 'custom')?.title).toBe('My custom work')
  expect(state.updates[0].text).toBe('My actual progress reply')
  expect(state.chats[0].id).toBe('founder-maya')
  expect(tailorDemoContext(state)).toBe(false)
})
it('leaves edited demo records intact', () => {
  const state = seedSnapshot()
  state.tasks[0].title = 'Review vendor agreements'
  state.tasks[0].description = 'My edited scope'
  const original = structuredClone(state)
  expect(tailorDemoContext(state)).toBe(false)
  expect(state).toEqual(original)
})

it('routes work across all five Itron groups without treating engineers as interchangeable', () => {
  const state = seedSnapshot()
  expect(new Set(state.employees.map(e => e.department))).toEqual(new Set(['Operations', 'Support Team', 'Tech Team', 'Finance', 'R&D']))
  expect(state.employees.filter(e => e.department === 'R&D')).toHaveLength(2)
  expect(suggestOwner(state, { requiredResponsibility: 'calibration', effortHours: 4 }).owner?.id).toBe('kavya')
  expect(suggestOwner(state, { requiredResponsibility: 'firmware', effortHours: 4 }).owner?.id).toBe('rohan')
  expect(suggestOwner(state, { requiredResponsibility: 'customer support', effortHours: 4 }).owner?.id).toBe('leena')
  expect(suggestOwner(state, { requiredResponsibility: 'platform', effortHours: 4 }).owner?.id).toBe('dev')
  expect(suggestOwner(state, { requiredResponsibility: 'procurement', effortHours: 2 }).owner?.id).toBe('arjun')
  expect(suggestOwner(state, { requiredResponsibility: 'operations', effortHours: 2 }).owner?.id).toBe('arjun')
})
it('updates the existing Itron team once while preserving capacity, replies, and closed work', () => {
  const state = seedSnapshot()
  state.employees = state.employees.filter(e => !['kavya', 'rohan'].includes(e.id))
  state.tasks = state.tasks.filter(t => !['kavya', 'rohan'].includes(t.ownerId || ''))
  state.updates = state.updates.filter(u => u.employeeId !== 'kavya')
  state.messages = state.messages.filter(m => !['kavya', 'rohan'].includes(m.employeeId))
  state.employees.find(e => e.id === 'leena')!.role = 'Installation & customer support'
  state.employees.find(e => e.id === 'leena')!.department = 'Operations'
  state.employees.find(e => e.id === 'dev')!.role = 'IoT & platform engineer'
  state.employees.find(e => e.id === 'dev')!.department = 'Technology'
  state.employees[0].weeklyCapacityHours = 10
  state.tasks[0].status = 'completed'
  state.updates[0].text = 'My saved reply'
  expect(tailorDemoContext(state)).toBe(true)
  expect(state.employees).toHaveLength(6)
  expect(state.employees.find(e => e.id === 'leena')?.department).toBe('Support Team')
  expect(state.employees.find(e => e.id === 'dev')?.department).toBe('Tech Team')
  expect(state.employees[0].weeklyCapacityHours).toBe(10)
  expect(state.tasks[0].status).toBe('completed')
  expect(state.updates[0].text).toBe('My saved reply')
  expect(tailorDemoContext(state)).toBe(false)
})
