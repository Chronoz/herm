#!/usr/bin/env bun
// One-shot: port every bd bead → hermes kanban. Idempotent (keyed on bead id).
// All tasks land in status=triage so the gateway dispatcher cannot spawn workers.

import { $ } from "bun"

const TENANT = "herm"
const BD = "/home/linuxbrew/.linuxbrew/bin/bd"

type Dep = { id: string; title: string; dependency_type: string }
type Bead = {
  id: string
  title: string
  description?: string
  design?: string
  acceptance_criteria?: string
  status: string
  priority: number
  issue_type: string
  created_by?: string
  labels?: string[]
  parent?: string
  dependencies?: Dep[]
}

const list = (await $`${BD} list --json`.json()) as Bead[]
console.error(`beads: ${list.length}`)

// bd list --json returns shallow deps; hydrate via bd show
const beads: Bead[] = []
for (const b of list) {
  const full = (await $`${BD} show ${b.id} --json`.json()) as Bead[]
  beads.push(full[0])
}

// ---- pass 1: create ------------------------------------------------------
const map: Record<string, string> = {}

function body(b: Bead) {
  const parts: string[] = []
  if (b.description) parts.push(b.description.trim())
  if (b.design) parts.push(`### Design\n${b.design.trim()}`)
  if (b.acceptance_criteria) parts.push(`### Acceptance\n${b.acceptance_criteria.trim()}`)
  const related = (b.dependencies ?? [])
    .filter((d) => d.dependency_type === "related")
    .map((d) => `- ${d.id} — ${d.title}`)
  if (related.length) parts.push(`### Related\n${related.join("\n")}`)
  const meta = [
    `bead: ${b.id}`,
    `type: ${b.issue_type}`,
    `bd-status: ${b.status}`,
    b.labels?.length ? `labels: ${b.labels.join(", ")}` : "",
  ].filter(Boolean)
  parts.push("---\n" + meta.join("\n"))
  return parts.join("\n\n")
}

for (const b of beads) {
  const out =
    await $`hermes kanban create ${b.title} --body ${body(b)} --tenant ${TENANT} --priority ${b.priority} --created-by ${b.created_by ?? "bd"} --idempotency-key ${b.id} --triage --json`.json()
  map[b.id] = out.id
  console.error(`  ${b.id.padEnd(14)} → ${out.id}  ${b.title.slice(0, 60)}`)
}

// ---- pass 2: link --------------------------------------------------------
const edges = new Set<string>()
for (const b of beads) {
  const ups = new Set<string>()
  if (b.parent) ups.add(b.parent)
  for (const d of b.dependencies ?? [])
    if (d.dependency_type !== "related") ups.add(d.id)
  for (const up of ups) {
    if (!map[up]) {
      console.error(`  skip link ${up} → ${b.id} (upstream not ported)`)
      continue
    }
    const key = `${map[up]}>${map[b.id]}`
    if (edges.has(key)) continue
    edges.add(key)
    await $`hermes kanban link ${map[up]} ${map[b.id]}`.quiet()
    console.error(`  link ${up} → ${b.id}`)
  }
}

console.error(`\ndone: ${beads.length} tasks, ${edges.size} edges, tenant=${TENANT}, status=triage`)
console.log(JSON.stringify(map, null, 2))
