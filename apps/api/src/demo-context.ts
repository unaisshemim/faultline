import type { Snapshot } from '../../../shared/contracts.js'
import { seedSnapshot } from './seed.js'

// Upgrade only recognizable original demo records. Custom tasks, replies,
// ownership, lifecycle state, dates, and chat history remain intact.
export function tailorDemoContext(state: Snapshot): boolean {
  const renamed = renameDemoCompany(state)
  const legacy = [
    ['task-vendors', 'Review vendor agreements', 'Review the three renewal agreements and flag any changes in terms.'],
    ['task-reconcile', 'Reconcile September invoices', 'Match supplier invoices with bank transactions and prepare the final summary.'],
    ['task-stock', 'Update the stock checklist', 'The shelf-level checklist has been updated and shared with operations.'],
  ]
  const fresh = seedSnapshot()
  const upgraded = new Set<string>()
  for (const [id, title, description] of legacy) {
    const task = state.tasks.find(t => t.id === id)
    const replacement = fresh.tasks.find(t => t.id === id)!
    if (!task || task.title !== title || task.description !== description || task.actionKey !== replacement.actionKey) continue
    task.title = replacement.title
    task.description = replacement.description
    task.requiredResponsibility = replacement.requiredResponsibility
    if (task.ownerId === replacement.ownerId) task.assignmentReason = replacement.assignmentReason
    if (task.blockerText === 'Waiting for two supplier receipts from operations.') task.blockerText = replacement.blockerText
    upgraded.add(id)
  }
  let cleanedResponsibilities = false
  if (!state.tasks.some(t => t.requiredResponsibility === 'inventory')) {
    for (const employee of state.employees) {
      const replacement = fresh.employees.find(e => e.id === employee.id)
      if (replacement && employee.name === replacement.name && employee.role === replacement.role && employee.responsibilities.includes('inventory')) {
        employee.responsibilities = employee.responsibilities.filter(r => r !== 'inventory')
        cleanedResponsibilities = true
      }
    }
  }
  if (!upgraded.size) return tailorTeamContext(state, fresh) || cleanedResponsibilities || renamed
  for (const employee of state.employees) {
    const replacement = fresh.employees.find(e => e.id === employee.id)
    const originalRoles: Record<string, string> = { arjun: 'Operations lead', leena: 'Operations associate', nisha: 'Finance lead' }
    if (replacement && employee.name === replacement.name && employee.role === originalRoles[employee.id]) {
      employee.role = replacement.role
      employee.department = replacement.department
      employee.responsibilities = [...new Set([...employee.responsibilities.filter(r => r !== 'inventory' || state.tasks.some(t => t.requiredResponsibility === 'inventory')), ...replacement.responsibilities])]
    }
  }
  const legacyTexts = new Set([
    'Two agreements reviewed. I’m checking the delivery terms on the last one.',
    'Waiting for two supplier receipts from operations.',
    'The stock checklist is updated and ready to use.',
    'Please review the vendor agreements and flag any changes in terms. Can you take this on?',
  ])
  for (const collection of ['updates', 'messages'] as const) {
    for (const row of state[collection]) {
      const replacement = fresh[collection].find(r => r.id === row.id)
      if (replacement && upgraded.has(row.taskId) && legacyTexts.has(row.text)) row.text = replacement.text
    }
  }
  if (!state.employees.some(e => e.id === 'dev')) {
    state.employees.push(fresh.employees.find(e => e.id === 'dev')!)
    for (const task of fresh.tasks.filter(t => t.ownerId === 'dev')) {
      if (state.tasks.some(t => t.id === task.id)) continue
      state.tasks.push(task)
      state.updates.push(...fresh.updates.filter(u => u.taskId === task.id))
      state.messages.push(...fresh.messages.filter(m => m.taskId === task.id))
    }
  }
  tailorTeamContext(state, fresh)
  return true
}

// Refresh only unchanged seeded copy; retain custom work and saved conversations.
function renameDemoCompany(state: Snapshot): boolean {
  const fresh = seedSnapshot()
  const isPrevious = (saved: string, text: string) => saved === text.replaceAll('Itron', 'Kamstrup') || saved === text.replaceAll('Itron', 'Aegir')
    .replace('Confirm demo meter delivery', 'Confirm US-20 meter delivery')
    .replace('demo meters across', 'demo US-20 meters across')
  let changed = false
  for (const task of state.tasks) {
    const replacement = fresh.tasks.find(row => row.id === task.id && row.actionKey === task.actionKey)
    if (!replacement) continue
    for (const key of ['title', 'description', 'assignmentReason'] as const) {
      if (task[key] !== replacement[key] && isPrevious(task[key], replacement[key])) {
        task[key] = replacement[key]
        changed = true
      }
    }
  }
  for (const collection of ['updates', 'messages'] as const) {
    for (const row of state[collection]) {
      const replacement = fresh[collection].find(item => item.id === row.id && item.taskId === row.taskId && item.employeeId === row.employeeId)
      if (replacement && row.text !== replacement.text && isPrevious(row.text, replacement.text)) {
        row.text = replacement.text
        changed = true
      }
    }
  }
  return changed
}

function tailorTeamContext(state: Snapshot, fresh: Snapshot): boolean {
  let changed = false
  const previousRoles: Record<string, string> = {
    arjun: 'Field operations lead', leena: 'Installation & customer support', dev: 'IoT & platform engineer',
  }
  for (const employee of state.employees) {
    const replacement = fresh.employees.find(e => e.id === employee.id)
    if (replacement && employee.name === replacement.name && employee.role === previousRoles[employee.id]) {
      employee.role = replacement.role
      employee.department = replacement.department
      if (employee.id === 'leena') employee.responsibilities = employee.responsibilities.filter(r => r !== 'operations')
      changed = true
    }
  }
  const support = state.employees.find(e => e.id === 'leena' && e.name === 'Leena Shah' && e.role === 'Support Engineer' && e.department === 'Support Team')
  if (support?.responsibilities.includes('operations')) {
    support.responsibilities = support.responsibilities.filter(r => r !== 'operations')
    changed = true
  }
  // Add illustrative R&D staff and work once; retain any records sharing these IDs.
  for (const id of ['kavya', 'rohan']) {
    if (state.employees.some(e => e.id === id)) continue
    state.employees.push(fresh.employees.find(e => e.id === id)!)
    for (const task of fresh.tasks.filter(t => t.ownerId === id)) {
      if (state.tasks.some(t => t.id === task.id)) continue
      state.tasks.push(task)
      state.updates.push(...fresh.updates.filter(u => u.taskId === task.id && !state.updates.some(saved => saved.id === u.id)))
      state.messages.push(...fresh.messages.filter(m => m.taskId === task.id && !state.messages.some(saved => saved.id === m.id)))
    }
    changed = true
  }
  return changed
}
