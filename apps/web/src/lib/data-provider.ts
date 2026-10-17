import type { DataProvider, RaRecord } from 'ra-core'
import { getWork } from './api'

async function records(resource: string): Promise<RaRecord[]> {
  const data = await getWork()
  if (resource === 'tasks') return data.tasks
  if (resource === 'team') return data.employees
  if (resource === 'updates') return data.updates
  throw new Error(`Unknown resource: ${resource}`)
}
// Keep writes on the domain API: assignment, employee replies, and cancellation.
const unsupported = async (): Promise<never> => { throw new Error('Use the task actions or company assistant to update company work.') }
export const dataProvider: DataProvider = {
  getList: async (resource, params) => {
    let data = await records(resource)
    for (const [key, value] of Object.entries(params.filter ?? {})) if (value !== undefined && value !== '') data = data.filter(record => key === 'q' ? JSON.stringify(record).toLowerCase().includes(String(value).toLowerCase()) : record[key] === value)
    const total = data.length
    if (params.sort) { const { field, order } = params.sort; data.sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (order === 'DESC' ? -1 : 1)) }
    if (params.pagination) { const { page, perPage } = params.pagination; data = data.slice((page - 1) * perPage, page * perPage) }
    return { data: data as never[], total }
  },
  getOne: async (resource, params) => { const data = (await records(resource)).find(record => record.id === params.id); if (!data) throw new Error('Record not found'); return { data: data as never } },
  getMany: async (resource, params) => ({ data: (await records(resource)).filter(record => params.ids.includes(record.id)) as never[] }),
  getManyReference: async (resource, params) => { const data = (await records(resource)).filter(record => record[params.target] === params.id); return { data: data as never[], total: data.length } },
  create: unsupported, update: unsupported, updateMany: unsupported, delete: unsupported, deleteMany: unsupported,
}
