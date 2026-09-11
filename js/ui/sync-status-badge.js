// Badge fixo de status da fila de sincronização. Escuta `filaEventos` (ver
// sync-queue.js) — nunca faz polling próprio da UI, só reage a mudanças
// reais da fila. Clicável pra forçar uma tentativa imediata.

import { filaEventos, obterStatusFila, drenarFila } from '../data/sync-queue.js';

export function iniciarBadgeDeSincronizacao() {
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.id = 'badge-sincronizacao';
  badge.className = 'badge-sync';
  badge.hidden = true;
  badge.addEventListener('click', () => drenarFila().catch(() => {}));
  document.body.appendChild(badge);

  const atualizar = async () => {
    try {
      const { pendentes, comErro, permanentes } = await obterStatusFila();

      if (pendentes === 0 && comErro === 0 && permanentes === 0) {
        badge.hidden = true;
        return;
      }

      badge.hidden = false;
      badge.classList.remove('badge-sync-erro');

      if (permanentes > 0) {
        // Sem retry possível (ver sync-queue.js) — a única recuperação real
        // é refazer a contagem, não insistir em reenviar.
        badge.textContent =
          `❌ ${permanentes} item(ns) não puderam ser sincronizados — a planilha foi reiniciada ` +
          'enquanto você contava. Refaça a contagem desta área.';
        badge.classList.add('badge-sync-erro');
      } else if (comErro > 0) {
        badge.textContent = `⚠️ ${comErro} sem sincronizar — toque para tentar de novo`;
        badge.classList.add('badge-sync-erro');
      } else {
        badge.textContent = `🔄 sincronizando ${pendentes} item(ns)…`;
      }
    } catch (erro) {
      // Sem acesso ao IndexedDB não dá pra saber o status real da fila —
      // melhor esconder o badge do que travar mostrando um estado errado.
      badge.hidden = true;
      console.error('Falha ao checar status da fila de sincronização:', erro);
    }
  };

  filaEventos.addEventListener('mudou', atualizar);
  atualizar();
}
