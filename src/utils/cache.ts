import { readHermesHome, type HermesHomeSnapshot } from "./hermes-home"
import * as perf from "./perf"

let data: HermesHomeSnapshot | null = null
let time = 0
const STALE = 5000

export async function snapshot(): Promise<HermesHomeSnapshot> {
  if (data && Date.now() - time < STALE) {
    perf.count("cache:hit")
    return data
  }
  perf.count("cache:miss")
  data = await readHermesHome()
  time = Date.now()
  return data
}

export function invalidate(): void {
  data = null
}
