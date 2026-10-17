import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dataProvider } from './data-provider'
import { getWork } from './api'
import type { WorkData } from '../../../../shared/contracts'

vi.mock('./api', () => ({ getWork: vi.fn() }))
const snapshot = {
  tasks: [{ id: 'a', title: 'Vendor review', status: 'blocked' }, { id: 'b', title: 'Invoice review', status: 'completed' }, { id: 'c', title: 'Stock review', status: 'blocked' }],
  employees: [{ id: 'employee', name: 'Maya' }], updates: [{ id: 'update', taskId: 'a', text: 'Waiting for receipts' }],
} as unknown as WorkData
beforeEach(() => vi.mocked(getWork).mockResolvedValue(snapshot))
describe('Company Brain admin data provider', () => {
  it('filters and sorts before pagination and retains the total', async () => {
    const result = await dataProvider.getList('tasks', { filter: { status: 'blocked' }, sort: { field: 'title', order: 'ASC' }, pagination: { page: 2, perPage: 1 } })
    expect(result.total).toBe(2)
    expect(result.data.map(record => record.id)).toEqual(['a'])
  })
  it('maps team and updates to their existing API collections', async () => {
    expect((await dataProvider.getOne('team', { id: 'employee' })).data).toEqual(snapshot.employees[0])
    expect((await dataProvider.getMany('updates', { ids: ['update'] })).data).toEqual(snapshot.updates)
  })
  it('rejects missing records and generic writes rather than reporting success', async () => {
    await expect(dataProvider.getOne('tasks', { id: 'missing' })).rejects.toThrow('Record not found')
    await expect(dataProvider.update('tasks', { id: 'a', data: { status: 'completed' }, previousData: snapshot.tasks[0] })).rejects.toThrow('Use the task actions')
  })
})
