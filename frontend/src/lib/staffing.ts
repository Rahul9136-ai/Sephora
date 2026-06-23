export interface ErlangCInput {
  volumePerDay: number
  ahtSeconds: number
  operatingHours: number
  targetSL: number
  targetAnswerSeconds: number
  maxAgents?: number
}

export interface ErlangCResult {
  agents: number
  serviceLevel: number
  asaSeconds: number
}

function erlangCProbability(offeredLoad: number, agents: number): number {
  if (agents <= offeredLoad) return 1
  let sum = 0
  let term = 1
  for (let k = 0; k < agents; k++) {
    if (k > 0) term *= offeredLoad / k
    sum += term
  }
  const lastTerm = term * (offeredLoad / agents)
  const erlangB = lastTerm / (sum + lastTerm)
  const rho = offeredLoad / agents
  return erlangB / (1 - rho * (1 - erlangB))
}

export function erlangCAgents({
  volumePerDay,
  ahtSeconds,
  operatingHours,
  targetSL,
  targetAnswerSeconds,
  maxAgents = 500,
}: ErlangCInput): ErlangCResult {
  const arrivalRatePerHour = volumePerDay / operatingHours
  const offeredLoad = (arrivalRatePerHour * ahtSeconds) / 3600

  if (offeredLoad <= 0) {
    return { agents: 0, serviceLevel: 1, asaSeconds: 0 }
  }

  let agents = Math.max(1, Math.ceil(offeredLoad))
  for (; agents <= maxAgents; agents++) {
    const pWait = erlangCProbability(offeredLoad, agents)
    const serviceLevel = 1 - pWait * Math.exp((-(agents - offeredLoad) * targetAnswerSeconds) / ahtSeconds)
    if (serviceLevel >= targetSL / 100) {
      const asaSeconds = (pWait * ahtSeconds) / (agents - offeredLoad)
      return { agents, serviceLevel, asaSeconds }
    }
  }

  const pWait = erlangCProbability(offeredLoad, maxAgents)
  const serviceLevel = 1 - pWait * Math.exp((-(maxAgents - offeredLoad) * targetAnswerSeconds) / ahtSeconds)
  return { agents: maxAgents, serviceLevel, asaSeconds: Infinity }
}

export function requiredAgentsLinear({
  volumePerDay,
  ahtSeconds,
  operatingHours,
}: {
  volumePerDay: number
  ahtSeconds: number
  operatingHours: number
}): number {
  return (volumePerDay * ahtSeconds) / (operatingHours * 3600)
}

export function applyShrinkageAndConcurrency(rawAgents: number, shrinkagePct: number, concurrency = 1): number {
  return rawAgents / (1 - shrinkagePct / 100) / concurrency
}
