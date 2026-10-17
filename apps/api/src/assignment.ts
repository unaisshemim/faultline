import { z } from 'zod'
import type { Snapshot, EmployeeCapacity } from '../../../shared/contracts.js'
import { terminalStatuses } from '../../../shared/contracts.js'

export const assignmentSchema = z.object({ requiredResponsibility: z.string().trim().min(1).max(100), effortHours: z.number().positive().max(200) })
export function calculateCapacity(state: Snapshot): EmployeeCapacity[] {
  return state.employees.map(employee => {
    const allocatedHours = state.tasks.filter(task => task.ownerId === employee.id && !terminalStatuses.includes(task.status)).reduce((sum, task) => sum + task.effortHours, 0)
    return { ...employee, allocatedHours, availableHours: Math.max(0, employee.weeklyCapacityHours - allocatedHours) }
  })
}
export function suggestOwner(state: Snapshot, input: z.infer<typeof assignmentSchema>) {
  const draft = assignmentSchema.parse(input)
  const responsibility = draft.requiredResponsibility.toLowerCase()
  const employees = calculateCapacity(state)
  const candidates = employees.map(employee => {
    const matches = employee.responsibilities.includes(responsibility)
    const fits = employee.availableHours >= draft.effortHours
    return { employeeId: employee.id, name: employee.name, availableHours: employee.availableHours, eligible: matches && fits, reason: !matches ? `Does not handle ${responsibility}.` : !fits ? `Only ${employee.availableHours}h available; ${draft.effortHours}h needed.` : `${employee.availableHours}h available and handles ${responsibility}.` }
  })
  const owner = employees.filter(e => candidates.find(c => c.employeeId === e.id)?.eligible).sort((a, b) => b.availableHours - a.availableHours || a.id.localeCompare(b.id))[0] ?? null
  return { owner, candidates, reason: owner ? `${owner.name.split(' ')[0]} handles ${responsibility} and has ${owner.availableHours}h available. This task needs ${draft.effortHours}h, leaving ${owner.availableHours - draft.effortHours}h.` : `No eligible employee has capacity for ${draft.effortHours}h of ${responsibility} work. The task will remain unassigned.` }
}
