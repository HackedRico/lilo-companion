import type { HiddenFact, Scenario } from '../../shared/types.ts'
import { revealOut } from '../../shared/schemas.ts'
import { personaReply, revealFacts } from '../../shared/prompts.ts'
import type { LlmLike } from '../llm/provider.ts'

export interface Turn {
  role: string
  text: string
}

export interface Answer {
  reply: string
  uncovered: HiddenFact[]
}

/**
 * One live scenario. The persona model is handed only the facts the student has
 * already uncovered, so it cannot leak what it was never given. That is the
 * whole reason this is two calls instead of one.
 */
export class ScenarioRun {
  readonly revealed = new Set<string>()
  readonly history: Turn[] = []
  submitted: string | null = null
  priorAnswer: { text: string; at: number } | null = null

  readonly scenario: Scenario

  constructor(scenario: Scenario) {
    this.scenario = scenario
  }

  get uncoveredFacts(): HiddenFact[] {
    return this.scenario.hiddenFacts.filter((fact) => this.revealed.has(fact.id))
  }

  get missedFacts(): HiddenFact[] {
    return this.scenario.hiddenFacts.filter((fact) => !this.revealed.has(fact.id))
  }

  async ask(llm: LlmLike, question: string): Promise<Answer> {
    const before = new Set(this.revealed)
    try {
      const { revealedFactIds } = await llm.json(revealOut, {
        lane: 'fast',
        temperature: 0.1,
        maxTokens: 200,
        ...revealFacts(this.scenario, question)
      })
      const known = new Set(this.scenario.hiddenFacts.map((fact) => fact.id))
      for (const id of revealedFactIds) if (known.has(id)) this.revealed.add(id)
    } catch {
      // A gate that fails closed reveals nothing, which is the safe direction.
    }

    const reply = await llm.text({
      lane: 'fast',
      temperature: 0.6,
      maxTokens: 300,
      ...personaReply(this.scenario, this.uncoveredFacts, question, this.history.slice(-6))
    })

    this.history.push({ role: 'student', text: question })
    this.history.push({ role: this.scenario.from.name, text: reply })

    return {
      reply: reply.trim(),
      uncovered: this.scenario.hiddenFacts.filter(
        (fact) => this.revealed.has(fact.id) && !before.has(fact.id)
      )
    }
  }
}
