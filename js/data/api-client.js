// Cliente HTTP fino pro Web App do Apps Script (spec seção 6). Nenhuma regra
// de negócio aqui — só monta a requisição certa pra cada action e devolve o
// JSON de resposta.
//
// GOTCHA (ver CLAUDE.md seção 8): o POST nunca define Content-Type
// explícito — deixamos o fetch mandar como text/plain (content-type
// "simples"), pra evitar o preflight CORS que o endpoint /exec do Apps
// Script não trata bem. O doPost já faz JSON.parse(e.postData.contents)
// manualmente do lado do servidor, então funciona igual.
//
// Toda chamada tem um timeout (AbortController) — sem isso, uma rede ruim
// deixaria a fila de sincronização (sync-queue.js) travada esperando pra
// sempre num único item em vez de marcar erro e tentar de novo depois.

const URL_WEB_APP = 'https://script.google.com/macros/s/AKfycbzUeqvRiXHQGlwdASiUyZiTfUYdjcE-nGOTnyhajO3y5jh1vMt8ZWiLN5VhCte8tMDw3Q/exec';
const TIMEOUT_MS = 15000;

export async function buscarArea(area) {
  const resposta = await buscarComTimeout(`${URL_WEB_APP}?action=area&area=${encodeURIComponent(area)}`);
  return resposta.json();
}

export async function importarLote(linhas, responsavel, confirmarSobrescrita) {
  return enviarPost({ action: 'importar_lote', responsavel, linhas, confirmarSobrescrita: Boolean(confirmarSobrescrita) });
}

export async function gravarContagemGrupo(corpo) {
  return enviarPost({ action: 'gravar_contagem_grupo', ...corpo });
}

export async function adicionarItemNaoEncontrado(corpo) {
  return enviarPost({ action: 'adicionar_item_nao_encontrado', ...corpo });
}

async function enviarPost(corpo) {
  const resposta = await buscarComTimeout(URL_WEB_APP, {
    method: 'POST',
    body: JSON.stringify(corpo),
  });
  return resposta.json();
}

async function buscarComTimeout(url, opcoes) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opcoes, signal: controlador.signal });
  } catch (erro) {
    if (erro.name === 'AbortError') throw new Error(`tempo limite (${TIMEOUT_MS / 1000}s) excedido ao chamar o servidor`);
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}
