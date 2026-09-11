// Regra de comparação divergente/esperado (spec seção 5).
//
// v1: a comparação roda no CLIENT — a quantidade esperada do grupo já chegou
// ao navegador junto com o resto dos dados da área (busca única no início da
// sessão do contador), só nunca é RENDERIZADA na tela. Mover essa comparação
// pro servidor é item de evolução futura (spec seção 9), não desta versão.

export function compararGrupo(grupo, quantidadeContada) {
  return quantidadeContada !== grupo.quantidadeEsperadaGrupo;
}
