export type TaskStatus = 'unassigned' | 'awaiting_acceptance' | 'accepted' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export interface Employee { id: string; name: string; role: string; department: string; responsibilities: string[]; weeklyCapacityHours: number; initials: string; color: string }
export interface EmployeeCapacity extends Employee { allocatedHours: number; availableHours: number }
export interface Task { id: string; title: string; description: string; requiredResponsibility: string; dueAt: string; effortHours: number; status: TaskStatus; ownerId: string | null; assignmentReason: string; blockerText: string; createdAt: string; lastUpdateAt: string; nextFollowUpAt: string | null; actionKey: string }
export type ResponseAction = 'accept' | 'decline' | 'clarify' | 'progress' | 'blocked' | 'complete'
export interface TaskUpdate { id: string; taskId: string; employeeId: string | null; text: string; kind: string; createdAt: string; origin: 'employee' | 'system' }
export interface DemoMessage { id: string; taskId: string; employeeId: string; direction: 'incoming' | 'outgoing'; text: string; kind: string; createdAt: string; dedupeKey: string }
export interface ChatRecord { id: string; messages: unknown[]; updatedAt: string }
export interface Snapshot { employees: Employee[]; tasks: Task[]; updates: TaskUpdate[]; messages: DemoMessage[]; chats: ChatRecord[] }
export interface SystemStatus { database: boolean; openai: boolean; model: string; timezone: string; followUpIntervalMs: number; preview: boolean }
export interface WorkData { employees: EmployeeCapacity[]; tasks: Task[]; updates: TaskUpdate[]; messages: DemoMessage[]; counts: { active: number; blocked: number; overdue: number; completed: number }; status: SystemStatus }
export const terminalStatuses: TaskStatus[] = ['completed', 'cancelled']
export type IntegrationId = 'outlook' | 'teams'
export interface IntegrationStatus { id: IntegrationId; configured: boolean; connected: boolean; account: { id?: string; name: string; email: string } | null; connectedAt: string | null; needsReconnect?: boolean }
export interface TeamsChat { id: string; topic: string | null; chatType: string; members: { userId: string; displayName: string; email: string }[]; preview: string; updatedAt: string | null; webUrl: string | null }
export interface TeamsMessage { id: string; content: string; contentType: string; sender: { id: string; name: string }; createdAt: string | null; deleted: boolean; attachments: { name: string; url: string | null }[] }
export interface TeamsPage<T> { items: T[]; nextCursor: string | null }

export interface ChatSummary { id: string; title: string; updatedAt: string; messageCount: number }
