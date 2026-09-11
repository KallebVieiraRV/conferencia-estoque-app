// Funções puras de área/corredor.
// Ver: plano do projeto/spec_tecnica_conferencia_estoque_cega.md, seção 3.2.
//
// Área = os dois primeiros segmentos do código de Posição, separados por
// hífen. Ex.: "1-D-12-1" -> "1-D". "2-H-2-1" -> "2-H".

export function computeArea(posicao) {
  const partes = String(posicao).split('-');
  return partes.slice(0, 2).join('-');
}

// Ordena posições "naturalmente" pelos segmentos numéricos (ex.: "1-D-2-1"
// antes de "1-D-11-1" — um sort de string puro colocaria "11" antes de "2").
// Usada pela tela de contagem pra percorrer as posições de uma área numa
// ordem sensata pro contador andar fisicamente pelo corredor.
export function compararPosicoes(a, b) {
  const segmentosA = String(a).split('-');
  const segmentosB = String(b).split('-');
  const tamanho = Math.max(segmentosA.length, segmentosB.length);

  for (let i = 0; i < tamanho; i++) {
    const segA = segmentosA[i] ?? '';
    const segB = segmentosB[i] ?? '';
    const numA = Number(segA);
    const numB = Number(segB);
    const ambosNumericos = segA !== '' && segB !== '' && !Number.isNaN(numA) && !Number.isNaN(numB);

    if (ambosNumericos) {
      if (numA !== numB) return numA - numB;
    } else if (segA !== segB) {
      return segA < segB ? -1 : 1;
    }
  }
  return 0;
}
