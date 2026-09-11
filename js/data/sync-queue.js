// Fila local de reenvio (spec seção 6): cada contagem confirmada é salva
// localmente (IndexedDB, ver db.js) ANTES de tentar enviar; se o envio
// falhar, o app tenta reenviar automaticamente em segundo plano até
// confirmar sucesso. Requisito desde a v1 — não é melhoria futura.
//
// Formato de um item da fila:
//   { id, action, payload, status: 'pendente'|'enviando'|'erro'|'permanente',
//     tentativas, proximaTentativaEm, ultimoErro, criadoEm, atualizadoEm }
//
// Um item some da store assim que sincroniza com sucesso — "pendente" é
// tudo que ainda está na store. Dreno SEQUENCIAL (nunca paralelo), pra
// nunca ter duas escritas em voo pro mesmo rowId ao mesmo tempo.
//
// status 'permanente': o servidor respondeu com um erro CLASSIFICADO como
// definitivo (`erroClassificado`, ver apps-script/CountingService.gs) — hoje
// só acontece quando o rowId de destino não existe mais na planilha (o
// responsável limpou/reimportou enquanto este contador tinha a área aberta).
// Reenviar de novo nunca vai funcionar, então o item para de ser tentado e
// fica só visível no badge — a única recuperação real é o contador refazer
// a contagem daquela área contra os dados novos (ver CLAUDE.md, seção de
// reset).

import { obterTudo, salvar, remover } from './db.js';
import { gravarContagemGrupo, adicionarItemNaoEncontrado } from './api-client.js';

const NOME_DA_STORE = 'syncQueue';
const BACKOFF_MS = [5000, 10000, 20000, 30000]; // último valor se repete pra tentativas além da 4ª
const INTERVALO_DE_POLLING_MS = 5000;

const EXECUTORES_POR_ACTION = {
  gravar_contagem_grupo: gravarContagemGrupo,
  adicionar_item_nao_encontrado: adicionarItemNaoEncontrado,
};

// Respostas classificadas (`erroClassificado`) que nunca vão se resolver
// tentando de novo — reenviar seria só desperdiçar rede indefinidamente.
const ERROS_CLASSIFICADOS_PERMANENTES = ['rowids_inexistentes'];

export const filaEventos = new EventTarget();

let estaDrenando = false;
let timerDeRetry = null;

export async function enfileirarEDrenar(action, payload) {
  const agora = new Date().toISOString();
  await salvar(NOME_DA_STORE, {
    action,
    payload,
    status: 'pendente',
    tentativas: 0,
    proximaTentativaEm: agora,
    ultimoErro: null,
    criadoEm: agora,
    atualizadoEm: agora,
  });
  notificarMudanca();
  drenarFila(); // dispara em background, não espera terminar
}

export async function obterStatusFila() {
  const itens = await obterTudo(NOME_DA_STORE);
  return {
    pendentes: itens.filter((i) => i.status === 'pendente' || i.status === 'enviando').length,
    comErro: itens.filter((i) => i.status === 'erro').length,
    permanentes: itens.filter((i) => i.status === 'permanente').length,
    total: itens.length,
  };
}

export async function drenarFila() {
  if (estaDrenando) return;
  estaDrenando = true;

  try {
    let itens = await obterTudo(NOME_DA_STORE);
    itens.sort((a, b) => a.id - b.id);

    for (const item of itens) {
      if (!deveTentarAgora(item)) continue;

      await salvar(NOME_DA_STORE, { ...item, status: 'enviando', atualizadoEm: new Date().toISOString() });
      notificarMudanca();

      try {
        const executar = EXECUTORES_POR_ACTION[item.action];
        if (!executar) throw new Error(`ação desconhecida na fila: ${item.action}`);

        const resultado = await executar(item.payload);

        if (!resultado.ok) {
          if (ERROS_CLASSIFICADOS_PERMANENTES.includes(resultado.erroClassificado)) {
            await salvar(NOME_DA_STORE, {
              ...item,
              status: 'permanente',
              ultimoErro: resultado.erro,
              atualizadoEm: new Date().toISOString(),
            });
            notificarMudanca();
            continue; // não agenda retry pra este item — nunca vai funcionar
          }
          throw new Error(resultado.erro || 'erro desconhecido do servidor');
        }

        await remover(NOME_DA_STORE, item.id);
      } catch (erro) {
        const tentativas = item.tentativas + 1;
        const atrasoMs = BACKOFF_MS[Math.min(tentativas - 1, BACKOFF_MS.length - 1)];
        await salvar(NOME_DA_STORE, {
          ...item,
          status: 'erro',
          tentativas,
          ultimoErro: erro.message,
          proximaTentativaEm: new Date(Date.now() + atrasoMs).toISOString(),
          atualizadoEm: new Date().toISOString(),
        });
      }

      notificarMudanca();
    }
  } finally {
    estaDrenando = false;
  }

  agendarProximaTentativaSeNecessario();
}

// 'permanente' nunca é tentado de novo (ver nota no topo do arquivo).
function deveTentarAgora(item) {
  if (item.status === 'permanente') return false;
  return new Date(item.proximaTentativaEm).getTime() <= Date.now();
}

async function agendarProximaTentativaSeNecessario() {
  try {
    const { pendentes, comErro } = await obterStatusFila();
    if (pendentes === 0 && comErro === 0) return;

    clearTimeout(timerDeRetry);
    timerDeRetry = setTimeout(drenarFila, INTERVALO_DE_POLLING_MS);
  } catch (erro) {
    // Não deixa uma falha aqui virar unhandled rejection silenciosa — o
    // setInterval do topo do arquivo ainda vai tentar de novo em breve.
    console.error('Falha ao checar status da fila pra agendar retry:', erro);
  }
}

function notificarMudanca() {
  filaEventos.dispatchEvent(new Event('mudou'));
}

// Dispara o dreno assim que a conexão volta, e também periodicamente (rede
// pode cair sem o browser perceber via evento 'offline'). O guard síncrono
// `estaDrenando` (setado ANTES de qualquer await, no topo de drenarFila)
// garante que o evento 'online' e o setInterval nunca entram na seção
// crítica ao mesmo tempo — JS é single-threaded, então o segundo chamador
// sempre vê `true` já no primeiro tick, sem precisar de lock nenhum.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => drenarFila());
  setInterval(() => drenarFila(), INTERVALO_DE_POLLING_MS);
  // Tenta drenar o que sobrou de uma sessão anterior assim que o módulo carrega.
  drenarFila();
}
