// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { formatData } from '../src/ui.js'

describe('formatData', () => {
  it('converte AAAA-MM-DD em DD/MM sem sofrer com fuso horário', () => {
    expect(formatData('2026-10-27')).toBe('27/10')
    // Virada de ano e dia 1º: se a data fosse interpretada em UTC e exibida em
    // Brasília, o dia voltaria um.
    expect(formatData('2027-01-01')).toBe('01/01')
  })

  it('data ausente ou inválida vira vazio em vez de derrubar a tabela', () => {
    expect(formatData('')).toBe('')
    expect(formatData(null)).toBe('')
    expect(formatData(undefined)).toBe('')
    expect(formatData('ontem')).toBe('')
    expect(formatData('2026-13-45')).toBe('')
  })
})
