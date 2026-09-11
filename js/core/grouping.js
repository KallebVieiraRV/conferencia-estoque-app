// Agrupamento de itens "splitados" (spec seção 3.3).
//
// Linhas com SKU + Posição + Lote idênticos, mas Doc. Fiscal diferente, formam
// um grupo tratado como UMA ÚNICA linha de contagem:
//
//   chave_do_grupo = (sku, posicao, lote)
//   quantidadeEsperadaGrupo = soma(quantidadeTotal de todas as linhas do grupo)
//
// Se o grupo tiver nome/datas divergentes entre as linhas apesar da chave
// igual (inconsistência de cadastro no WMS), isso é sinalizado em `anomalias`
// — a spec pede pra agrupar mesmo assim, só marcando como anomalia de dados
// pra revisão humana na importação, não bloquear.

import { computeArea } from './area.js';

export function groupByKey(registros) {
  const grupos = new Map();

  for (const registro of registros) {
    const chave = chaveDoGrupo(registro);
    if (!grupos.has(chave)) {
      grupos.set(chave, criarGrupoVazio(registro));
    }
    const grupo = grupos.get(chave);
    grupo.linhasOriginais.push(registro);
    grupo.quantidadeEsperadaGrupo += registro.quantidadeTotal;
  }

  const listaDeGrupos = Array.from(grupos.values());
  for (const grupo of listaDeGrupos) {
    if (grupo.linhasOriginais.length > 1) {
      grupo.anomalias = detectarAnomalias(grupo.linhasOriginais);
    }
  }
  return listaDeGrupos;
}

// Exportada pra UI (app/js/ui/screen-counting.js) usar a MESMA chave aqui —
// tinha uma cópia local lá que podia divergir desta em silêncio e quebrar o
// casamento de contagensPorChave sem nenhum erro visível.
export function chaveDoGrupo(registro) {
  return `${registro.sku}|${registro.posicao}|${registro.lote}`;
}

function criarGrupoVazio(registro) {
  return {
    sku: registro.sku,
    posicao: registro.posicao,
    lote: registro.lote,
    area: computeArea(registro.posicao),
    linhasOriginais: [],
    quantidadeEsperadaGrupo: 0,
    anomalias: [],
  };
}

function detectarAnomalias(linhasOriginais) {
  const anomalias = [];
  const base = linhasOriginais[0];
  for (const linha of linhasOriginais.slice(1)) {
    if (
      linha.nomeProduto !== base.nomeProduto ||
      linha.dataFabricacao !== base.dataFabricacao ||
      linha.dataValidade !== base.dataValidade
    ) {
      anomalias.push(
        `Divergência de cadastro entre Doc. Fiscal ${base.docFiscal} e ${linha.docFiscal} (mesmo SKU+Posição+Lote)`,
      );
    }
  }
  return anomalias;
}
