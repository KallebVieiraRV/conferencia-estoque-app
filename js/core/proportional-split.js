// Distribuição proporcional e regra de recontagem de grupos splitados
// (spec seção 5).
//
// Estas funções operam sobre um `grupo` como o produzido por
// app/js/core/grouping.js (groupByKey), na FORMA COMO CHEGA NA TELA DE
// CONTAGEM: cada `linhaOriginal` já tem um `rowId` — o identificador da linha
// física na Planilha Google central, atribuído pelo Apps Script na importação
// e devolvido pelo `doGet` no início da sessão do contador. Este módulo não
// sabe de onde o `rowId` veio, só que cada linha original precisa ter um.

// Sem divergência: grava a 1ª contagem. Se o grupo era splitado (>1 linha
// original), distribui o valor contado de volta nas linhas ORIGINAIS na MESMA
// PROPORÇÃO que já existia no relatório bruto — sem qualquer aviso.
// Ex.: esperado 3 e 2 (total 5) → contado 5 → grava 3 e 2.
export function distribuirProporcional(grupo, quantidadeContada) {
  const total = grupo.quantidadeEsperadaGrupo;
  const linhas = grupo.linhasOriginais;

  if (linhas.length === 1) {
    return [{ rowId: linhas[0].rowId, primeiraContagem: quantidadeContada }];
  }

  if (total === 0) {
    // Não há proporção original pra seguir (soma esperada é zero) — grava
    // tudo na 1ª linha e sinaliza, em vez de dividir por zero.
    return [
      {
        rowId: linhas[0].rowId,
        primeiraContagem: quantidadeContada,
        observacao: 'Não foi possível distribuir proporcionalmente (quantidade esperada do grupo é zero)',
      },
      ...linhas.slice(1).map((linha) => ({ rowId: linha.rowId, primeiraContagem: 0 })),
    ];
  }

  const valores = linhas.map((linha) => Math.round((linha.quantidadeTotal / total) * quantidadeContada));
  const somaArredondada = valores.reduce((soma, valor) => soma + valor, 0);
  const sobra = quantidadeContada - somaArredondada;
  valores[valores.length - 1] += sobra; // ajuste de arredondamento na última linha

  return linhas.map((linha, indice) => ({ rowId: linha.rowId, primeiraContagem: valores[indice] }));
}

// Divergente: marca pra recontagem. Após a 2ª contagem:
// - grupo com 1 linha original só: grava a 2ª contagem nela normalmente.
// - grupo splitado (várias linhas originais): grava o TOTAL inteiro na
//   PRIMEIRA linha do grupo (ordenando as linhas originais por Doc. Fiscal),
//   zera as demais, e preenche a Observação de TODAS as linhas do grupo com
//   uma nota padrão. Vale para 2, 3 ou mais linhas.
export function resolverRecontagem(grupo, quantidadeRecontada) {
  const linhas = grupo.linhasOriginais;

  if (linhas.length === 1) {
    return [{ rowId: linhas[0].rowId, segundaContagem: quantidadeRecontada }];
  }

  const linhasOrdenadas = [...linhas].sort((a, b) => a.docFiscal.localeCompare(b.docFiscal));
  const observacaoPadrao =
    `Agrupado com posição ${grupo.posicao} / lote ${grupo.lote} — ` +
    `total contado: ${quantidadeRecontada}, esperado: ${grupo.quantidadeEsperadaGrupo}`;

  return linhasOrdenadas.map((linha, indice) => ({
    rowId: linha.rowId,
    segundaContagem: indice === 0 ? quantidadeRecontada : 0,
    observacao: observacaoPadrao,
  }));
}
