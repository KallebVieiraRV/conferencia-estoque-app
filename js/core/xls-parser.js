// Parser puro do relatório bruto do WMS (spec seção 3.1).
//
// Recebe a MATRIZ já extraída de uma planilha — um array de arrays, do jeito
// que `XLSX.utils.sheet_to_json(planilha, { header: 1, raw: true, defval: '' })`
// devolve — e retorna só os campos de interesse do app, ignorando as colunas
// não usadas (Cliente, Projeto, Grupo, Subgrupo, Tipo, EAN, Unidade, Armazém,
// Data Entrada, Serie, Marca/Patrimônio, Peso Emb., Unit., Emb. Sec.,
// Qtd. Livre, Qtd. Bloqueada, Vlr. Méd. Unitário, Vlr. Total, ABC Quantidade,
// ABC Valor, ID UNIT, LOTE OBS).
//
// Este arquivo é puro (sem DOM, sem fetch) para poder rodar tanto no browser
// quanto em `node --test`. Quem lê o arquivo .xls/.xlsx de verdade e monta essa
// matriz é o adaptador de browser (app/js/ui/screen-import.js), não este módulo.
//
// Layout de colunas confirmado nos 3 relatórios reais de exemplo (linha de
// índice 0 = filtro aplicado pelo WMS, linha de índice 1 = cabeçalho, dados a
// partir da linha de índice 2):
//
//   2  = Produto (SKU)          13 = Doc. Fiscal      19 = Data Validade
//   3  = Produto (nome)         14 = Lote             21 = Emb. (embalagem)
//   8  = Descrição (nome, alt.) 17 = Fabricante        26 = Qtd. Total
//   11 = Posição                18 = Data Fabricação

const COLUNA = {
  SKU: 2,
  NOME_PRODUTO: 3,
  DESCRICAO: 8,
  POSICAO: 11,
  DOC_FISCAL: 13,
  LOTE: 14,
  FABRICANTE: 17,
  DATA_FABRICACAO: 18,
  DATA_VALIDADE: 19,
  EMBALAGEM: 21,
  QTD_TOTAL: 26,
};

// Índice da primeira linha de dado real (0 = filtro do WMS, 1 = cabeçalho).
const PRIMEIRA_LINHA_DE_DADO = 2;

export function parseWorkbookRows(matriz) {
  return matriz
    .slice(PRIMEIRA_LINHA_DE_DADO)
    .filter((linha) => textoOuVazio(linha[COLUNA.SKU]) !== '')
    .map(mapearLinha);
}

function mapearLinha(linha) {
  return {
    sku: textoOuVazio(linha[COLUNA.SKU]),
    nomeProduto: textoOuVazio(linha[COLUNA.NOME_PRODUTO]) || textoOuVazio(linha[COLUNA.DESCRICAO]),
    posicao: textoOuVazio(linha[COLUNA.POSICAO]),
    docFiscal: textoOuVazio(linha[COLUNA.DOC_FISCAL]),
    lote: textoOuVazio(linha[COLUNA.LOTE]),
    fabricante: textoOuVazio(linha[COLUNA.FABRICANTE]),
    dataFabricacao: formatarCelulaData(linha[COLUNA.DATA_FABRICACAO]),
    dataValidade: formatarCelulaData(linha[COLUNA.DATA_VALIDADE]),
    embalagem: textoOuVazio(linha[COLUNA.EMBALAGEM]),
    quantidadeTotal: Number(linha[COLUNA.QTD_TOTAL]) || 0,
  };
}

function textoOuVazio(valor) {
  return String(valor ?? '').trim();
}

// Nos relatórios reais de exemplo, datas vêm como texto "DD/MM/AAAA". Mas o
// SheetJS pode entregar uma célula de data Excel de verdade como objeto Date
// quando lido com `cellDates: true` — normalizamos os dois casos pro mesmo
// formato de string, pra não depender de como cada exportação futura do WMS
// decidir formatar a célula.
function formatarCelulaData(valor) {
  if (valor instanceof Date) return formatarComoDDMMAAAA(valor);
  return textoOuVazio(valor);
}

function formatarComoDDMMAAAA(data) {
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  return `${dia}/${mes}/${ano}`;
}
