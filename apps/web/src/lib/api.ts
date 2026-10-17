import type { WorkData, ResponseAction, Task } from '../../../../shared/contracts'
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Please try again.')
  return body as T
}
export const getWork = () => request<WorkData>('/dashboard')
export const respondToTask = (taskId: string, employeeId: string, action: ResponseAction, text: string) => request<Task>(`/tasks/${taskId}/respond`, { method: 'POST', body: JSON.stringify({ employeeId, action, text, requestId: crypto.randomUUID() }) })
export const cancelTask = (taskId: string) => request<Task>(`/tasks/${taskId}/cancel`, { method: 'POST', body: '{}' })
