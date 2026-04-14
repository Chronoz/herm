/**
 * REST client for Hermes cron job management.
 * Talks to the API server at localhost:8642/api/jobs.
 */

const BASE = "http://localhost:8642"
const KEY = Bun.env.API_SERVER_KEY ?? ""

const headers = () => {
  const h: Record<string, string> = { "Content-Type": "application/json" }
  if (KEY) h["Authorization"] = `Bearer ${KEY}`
  return h
}

export type CronJob = {
  id: string
  name: string
  prompt: string
  schedule: { kind: string; expr: string; display: string }
  enabled: boolean
  state: string
  deliver: string
  last_run?: string
  next_run?: string
  last_error?: string
}

export async function list(): Promise<CronJob[]> {
  const res = await fetch(`${BASE}/api/jobs`, { headers: headers() })
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`)
  const body = await res.json()
  return Array.isArray(body) ? body : body.jobs ?? []
}

export async function create(job: {
  prompt: string; schedule: string; name?: string; deliver?: string
}): Promise<CronJob> {
  const res = await fetch(`${BASE}/api/jobs`, {
    method: "POST", headers: headers(), body: JSON.stringify(job),
  })
  if (!res.ok) throw new Error(`Failed to create job: ${res.status}`)
  return res.json()
}

export async function pause(id: string): Promise<CronJob> {
  const res = await fetch(`${BASE}/api/jobs/${id}/pause`, {
    method: "POST", headers: headers(),
  })
  if (!res.ok) throw new Error(`Failed to pause job: ${res.status}`)
  return res.json()
}

export async function resume(id: string): Promise<CronJob> {
  const res = await fetch(`${BASE}/api/jobs/${id}/resume`, {
    method: "POST", headers: headers(),
  })
  if (!res.ok) throw new Error(`Failed to resume job: ${res.status}`)
  return res.json()
}

export async function trigger(id: string): Promise<CronJob> {
  const res = await fetch(`${BASE}/api/jobs/${id}/run`, {
    method: "POST", headers: headers(),
  })
  if (!res.ok) throw new Error(`Failed to trigger job: ${res.status}`)
  return res.json()
}

export async function remove(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/jobs/${id}`, {
    method: "DELETE", headers: headers(),
  })
  if (!res.ok) throw new Error(`Failed to delete job: ${res.status}`)
}
