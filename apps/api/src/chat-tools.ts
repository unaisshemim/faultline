import { tool } from 'ai'
import { z } from 'zod'
import { calculateCapacity, suggestOwner, assignmentSchema } from './assignment.js'
import { WorkService, WorkError, taskInputSchema } from './work.js'

export function createChatTools(work: WorkService, actionKey: string, allowCreation: boolean) {
  return {
    getCompanyWork: tool({ description: 'Read current employees, responsibilities, remaining capacity, tasks and employee-confirmed updates. Use this to answer operational questions; never invent current work.', inputSchema: z.object({}), execute: async () => { const state = await work.store.read(); return { employees: calculateCapacity(state), tasks: state.tasks, updates: state.updates.slice(0, 15) } } }),
    suggestOwner: tool({ description: 'Check responsibility and capacity for a proposed task. Only use an effort estimate provided or agreed to by the founder.', inputSchema: assignmentSchema, execute: async input => suggestOwner(await work.store.read(), input) }),
    createTask: tool({ description: 'Propose a task by displaying an interactive approval card. Calling this tool does NOT save, assign, or execute the task: the user must approve the card first. Once the founder has requested work and supplied/agreed scope, deadline, and effort, call this tool immediately; do not ask for another verbal approval. The backend selects a qualified owner only after card approval. Never call for read-only questions. At most one proposal per founder message.', inputSchema: taskInputSchema, needsApproval: true, execute: async input => {
      if (!allowCreation) throw new WorkError('This message asks for information, not task creation.')
      return { task: await work.createTask(input, actionKey) }
    } }),
  }
}

export function allowsCreation(userTexts: string[]) {
  const last = userTexts.at(-1)?.trim() ?? ''
  if (/^(what|who|when|where|why|how|show|list|tell me|do we|is there|are there)\b/i.test(last)) return false
  return userTexts.some(text => /\b(create|prepare|assign|make|schedule|organize|organise|draft|update|review|reconcile|report|follow up|task|take care)\b/i.test(text))
}
