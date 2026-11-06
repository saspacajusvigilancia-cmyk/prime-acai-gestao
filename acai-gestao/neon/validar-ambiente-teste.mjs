import {
  carregarAmbiente,
  exigirDestinoDesenvolvimento,
  exigirDestinoSintetico,
  validarModoVite,
  validarSemProducao,
} from './ambiente-teste.js'

const modo = process.argv[2] ?? 'unit'
const env = carregarAmbiente(modo === 'demo' ? 'demo' : modo === 'development' ? 'development' : 'test')

if (modo === 'demo') {
  validarModoVite('demo', env)
  console.log('Modo demo seguro: sem endpoint de autenticação ou Data API.')
} else if (modo === 'development') {
  const endpointId = exigirDestinoDesenvolvimento(env)
  console.log(`Branch Neon de desenvolvimento autorizada: ${endpointId}.`)
} else if (modo === 'remote') {
  const endpointId = exigirDestinoSintetico(env)
  console.log(`Destino remoto sintético aprovado para execução: ${endpointId}.`)
} else {
  validarSemProducao(env)
  console.log('Inicialização de testes locais segura: endpoint de produção ausente.')
}
