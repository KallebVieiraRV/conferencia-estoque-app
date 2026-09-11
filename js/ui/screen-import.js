// Tela de importação (spec seção 4.1) — usada só pelo responsável, nunca
// pelos contadores. Lê o(s) .xls/.xlsx 100% no navegador (SheetJS
// vendorizado em app/js/vendor/xlsx.full.min.js, sem subir o arquivo bruto
// pra nenhum servidor externo), roda o parser + agrupamento reais
// (app/js/core/) só pra montar o resumo/detectar anomalias, e manda as
// linhas originais pro Apps Script via api-client.importarLote — o
// agrupamento em si nunca é enviado, cada linha original vai com seu
// próprio Doc. Fiscal (ver apps-script/SheetRepository.gs).
//
// `XLSX` é um global do vendor script (carregado como <script> comum, não
// módulo, antes deste arquivo em import.html) — não é importado aqui.

import { parseWorkbookRows } from '../core/xls-parser.js';
import { computeArea } from '../core/area.js';
import { groupByKey } from '../core/grouping.js';
import { importarLote } from '../data/api-client.js';
import { escaparHtml } from './dom-utils.js';

const campoResponsavel = document.getElementById('responsavel');
const campoArquivo = document.getElementById('arquivo');
const elResumo = document.getElementById('resumo');
const elAnomalias = document.getElementById('anomalias');
const elAvisoAreaExistente = document.getElementById('aviso-area-existente');
const campoForcarReimportacao = document.getElementById('campo-forcar-reimportacao');
const botaoImportar = document.getElementById('btn-importar');
const elStatus = document.getElementById('status');

let linhasProntasParaImportar = [];

campoArquivo.addEventListener('change', () => {
  const arquivos = Array.from(campoArquivo.files || []);
  if (arquivos.length === 0) return;
  processarArquivos(arquivos);
});

botaoImportar.addEventListener('click', enviarImportacao);

async function processarArquivos(arquivos) {
  definirStatus(`Lendo ${arquivos.length} arquivo(s)…`);
  botaoImportar.disabled = true;
  esconder(elResumo);
  esconder(elAnomalias);
  esconder(elAvisoAreaExistente);
  campoForcarReimportacao.checked = false;

  try {
    const todosOsRegistros = [];
    for (const arquivo of arquivos) {
      const matriz = await lerArquivoComoMatriz(arquivo);
      const registros = parseWorkbookRows(matriz);
      for (const registro of registros) {
        todosOsRegistros.push({ ...registro, area: computeArea(registro.posicao) });
      }
    }

    if (todosOsRegistros.length === 0) {
      definirStatus('Nenhuma linha de dado encontrada nos arquivos selecionados.', true);
      return;
    }

    linhasProntasParaImportar = todosOsRegistros;
    exibirResumo(todosOsRegistros);
    botaoImportar.disabled = false;
    definirStatus(`${todosOsRegistros.length} linha(s) lida(s). Confira o resumo antes de importar.`);
  } catch (erro) {
    definirStatus(`Erro ao ler arquivo(s): ${erro.message}`, true);
  }
}

async function enviarImportacao() {
  if (linhasProntasParaImportar.length === 0) return;

  botaoImportar.disabled = true;
  definirStatus('Enviando pra Planilha Google central…');

  try {
    const resultado = await importarLote(
      linhasProntasParaImportar,
      campoResponsavel.value.trim(),
      campoForcarReimportacao.checked,
    );

    if (!resultado.ok) {
      // area_ja_importada: guarda contra reimportação acidental (apps-script/
      // ImportService.gs) — mostra o aviso com a opção de forçar, em vez de
      // só um erro genérico, já que essa é a única resposta que tem uma ação
      // corretiva óbvia pro responsável tomar aqui mesmo na tela.
      if (resultado.erroClassificado === 'area_ja_importada') {
        mostrar(elAvisoAreaExistente);
        definirStatus(resultado.erro, true);
        botaoImportar.disabled = false;
        return;
      }
      throw new Error(resultado.erro || 'erro desconhecido do servidor');
    }

    esconder(elAvisoAreaExistente);
    definirStatus(`✅ ${resultado.linhasImportadas} linha(s) importada(s) com sucesso.`);
  } catch (erro) {
    definirStatus(`Erro ao importar: ${erro.message}`, true);
    botaoImportar.disabled = false;
  }
}

function lerArquivoComoMatriz(arquivo) {
  return arquivo.arrayBuffer().then((buffer) => {
    // eslint-disable-next-line no-undef -- XLSX é global do vendor script
    const workbook = XLSX.read(buffer, { type: 'array' });
    const planilha = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(planilha, { header: 1, raw: true, defval: '' });
  });
}

function exibirResumo(registros) {
  const areas = [...new Set(registros.map((r) => r.area))].sort();
  const grupos = groupByKey(registros);
  const gruposSplitados = grupos.filter((g) => g.linhasOriginais.length > 1);
  const gruposComAnomalia = grupos.filter((g) => g.anomalias.length > 0);

  mostrar(elResumo);
  elResumo.innerHTML = `
    <p><strong>${registros.length}</strong> linha(s) em <strong>${areas.length}</strong> área(s): ${escaparHtml(areas.join(', '))}</p>
    <p><strong>${grupos.length}</strong> grupo(s) de contagem (<strong>${gruposSplitados.length}</strong> splitado(s)).</p>
  `;

  if (gruposComAnomalia.length > 0) {
    mostrar(elAnomalias);
    const itens = gruposComAnomalia
      .map((g) => `<li>${escaparHtml(g.sku)} / ${escaparHtml(g.posicao)} / ${escaparHtml(g.lote)}: ${escaparHtml(g.anomalias.join('; '))}</li>`)
      .join('');
    elAnomalias.innerHTML = `
      <p class="aviso">⚠️ ${gruposComAnomalia.length} grupo(s) com anomalia de cadastro (descrição/datas divergentes dentro do mesmo grupo) — importado mesmo assim, revise na coluna "Análise" depois:</p>
      <ul>${itens}</ul>
    `;
  } else {
    esconder(elAnomalias);
    elAnomalias.innerHTML = '';
  }
}

function definirStatus(mensagem, ehErro) {
  elStatus.textContent = mensagem;
  elStatus.classList.toggle('erro', Boolean(ehErro));
}

function mostrar(elemento) {
  elemento.hidden = false;
}

function esconder(elemento) {
  elemento.hidden = true;
}
