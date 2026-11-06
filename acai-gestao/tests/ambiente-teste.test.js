import { describe, expect, it } from 'vitest'
import {
  BRANCH_NEON_HOMOLOGACAO_ID,
  BRANCH_NEON_DESENVOLVIMENTO_ID,
  ENDPOINT_NEON_DESENVOLVIMENTO_ID,
  ENDPOINT_NEON_HOMOLOGACAO_ID,
  ENDPOINT_PRODUCAO_ID,
  PROJETO_NEON_DESENVOLVIMENTO_ID,
  PROJETO_NEON_HOMOLOGACAO_ID,
  exigirDestinoDesenvolvimento,
  exigirDestinoSintetico,
  validarModoVite,
  validarSemProducao,
} from '../neon/ambiente-teste.js'

const ambienteTeste = {
  VITE_NEON_URL: `https://${ENDPOINT_NEON_HOMOLOGACAO_ID}.c-8.us-east-2.aws.neon.tech/neondb`,
  DATABASE_URL: `postgresql://test:test@${ENDPOINT_NEON_HOMOLOGACAO_ID}.c-8.us-east-2.aws.neon.tech/neondb?sslmode=verify-full`,
  NEON_TEST_PROJECT_ID: PROJETO_NEON_HOMOLOGACAO_ID,
  NEON_TEST_BRANCH_ID: BRANCH_NEON_HOMOLOGACAO_ID,
  NEON_TEST_ENDPOINT_ID: ENDPOINT_NEON_HOMOLOGACAO_ID,
  NEON_TEST_DATASET: 'synthetic',
}

const ambienteDesenvolvimento = {
  VITE_NEON_URL: '',
  VITE_NEON_AUTH_URL: `https://${ENDPOINT_NEON_DESENVOLVIMENTO_ID}.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth`,
  VITE_NEON_DATA_API_URL: `https://${ENDPOINT_NEON_DESENVOLVIMENTO_ID}.apirest.c-2.sa-east-1.aws.neon.tech/neondb/rest/v1`,
  DATABASE_URL: `postgresql://user:password@${ENDPOINT_NEON_DESENVOLVIMENTO_ID}-pooler.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require`,
  DATABASE_URL_UNPOOLED: `postgresql://user:password@${ENDPOINT_NEON_DESENVOLVIMENTO_ID}.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full`,
  NEON_DEV_PROJECT_ID: PROJETO_NEON_DESENVOLVIMENTO_ID,
  NEON_DEV_BRANCH_ID: BRANCH_NEON_DESENVOLVIMENTO_ID,
  NEON_DEV_ENDPOINT_ID: ENDPOINT_NEON_DESENVOLVIMENTO_ID,
}

describe('guardas de ambiente Neon', () => {
  it('aceita somente o endpoint de desenvolvimento autorizado com Auth e Data API explícitos', () => {
    expect(exigirDestinoDesenvolvimento(ambienteDesenvolvimento))
      .toBe(ENDPOINT_NEON_DESENVOLVIMENTO_ID)
    expect(() => validarModoVite('development', ambienteDesenvolvimento)).not.toThrow()
  })

  it('bloqueia endpoint, branch e TLS divergentes no modo local conectado', () => {
    expect(() => exigirDestinoDesenvolvimento({
      ...ambienteDesenvolvimento,
      NEON_DEV_BRANCH_ID: BRANCH_NEON_HOMOLOGACAO_ID,
    })).toThrow('branch ID')
    expect(() => exigirDestinoDesenvolvimento({
      ...ambienteDesenvolvimento,
      VITE_NEON_DATA_API_URL: 'https://ep-wrong.apirest.c-2.sa-east-1.aws.neon.tech/neondb/rest/v1',
    })).toThrow('URLs não apontam')
    expect(() => exigirDestinoDesenvolvimento({
      ...ambienteDesenvolvimento,
      DATABASE_URL_UNPOOLED: ambienteDesenvolvimento.DATABASE_URL_UNPOOLED.replace('verify-full', 'require'),
    })).toThrow('sslmode=verify-full')
  })

  it('bloqueia a branch de produção sem revelar a URL', () => {
    const env = {
      ...ambienteTeste,
      VITE_NEON_URL: `https://${ENDPOINT_PRODUCAO_ID}.c-2.sa-east-1.aws.neon.tech/neondb`,
    }
    let erro
    try {
      validarSemProducao(env)
    } catch (capturado) {
      erro = capturado
    }

    expect(erro).toBeInstanceOf(Error)
    expect(erro.message).toContain('produção')
    expect(erro.message).not.toContain(ENDPOINT_PRODUCAO_ID)
    expect(erro.message).not.toContain('secret')
  })

  it('exige o mesmo endpoint nas URLs de Data API e PostgreSQL', () => {
    expect(() =>
      exigirDestinoSintetico({
        ...ambienteTeste,
        DATABASE_URL: 'postgresql://test:test@ep-other.c-8.sa-east-1.aws.neon.tech/neondb',
      }),
    ).toThrow('mesmo endpoint')
  })

  it('exige identificação da branch e confirmação de dados sintéticos', () => {
    expect(() => exigirDestinoSintetico({ ...ambienteTeste, NEON_TEST_DATASET: '' }))
      .toThrow('dados sintéticos')
    expect(() => exigirDestinoSintetico({ ...ambienteTeste, NEON_TEST_BRANCH_ID: '' }))
      .toThrow('branch isolada')
  })

  it('aceita somente o projeto e a branch isolados explicitamente identificados', () => {
    expect(exigirDestinoSintetico(ambienteTeste)).toBe(ENDPOINT_NEON_HOMOLOGACAO_ID)
  })

  it('recusa projetos e branches que não sejam o ambiente autorizado', () => {
    expect(() => exigirDestinoSintetico({
      ...ambienteTeste,
      NEON_TEST_PROJECT_ID: 'nameless-tooth-87377816',
    })).toThrow('projeto isolado')
    expect(() => exigirDestinoSintetico({
      ...ambienteTeste,
      NEON_TEST_BRANCH_ID: 'br-steep-truth-b610am4p',
    })).toThrow('produção')
  })

  it('recusa endpoint diferente mesmo se URLs e marcador concordarem', () => {
    const outroEndpoint = 'ep-another-test'
    expect(() => exigirDestinoSintetico({
      ...ambienteTeste,
      VITE_NEON_URL: `https://${outroEndpoint}.c-8.sa-east-1.aws.neon.tech/neondb`,
      DATABASE_URL: `postgresql://test:test@${outroEndpoint}.c-8.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full`,
      NEON_TEST_ENDPOINT_ID: outroEndpoint,
    })).toThrow('endpoint ID')
  })

  it('impede modo demo de iniciar com endpoint conectado', () => {
    expect(() =>
      validarModoVite('demo', {
        VITE_NEON_URL: ambienteTeste.VITE_NEON_URL,
      }),
    ).toThrow('deve ficar vazio')
  })
})
