// Wrapper fino sobre IndexedDB. Um único banco (`conferencia-estoque-db`)
// com 2 stores:
//   - syncQueue: fila de envios pendentes pro Apps Script (ver sync-queue.js)
//   - sessao: nome do contador + área ativa + os grupos já buscados/agrupados
//     + progresso da contagem em andamento — tudo num registro só (chave
//     'atual'), pra sobreviver a reload/queda de rede (spec seção 4.2,
//     passo 2: "a partir daqui a contagem funciona mesmo com conexão
//     instável") sem precisar buscar a área de novo nem perder o que já foi
//     digitado
//
// Cada função abre sua própria transação curta — não há necessidade de
// reaproveitar transações pro volume de escrita desta aplicação (poucas
// dezenas de grupos por área, no máximo).

const NOME_DO_BANCO = 'conferencia-estoque-db';
const VERSAO_DO_BANCO = 1;

let promessaDoBanco = null;

export function abrirBanco() {
  if (promessaDoBanco) return promessaDoBanco;

  promessaDoBanco = new Promise((resolve, reject) => {
    const requisicao = indexedDB.open(NOME_DO_BANCO, VERSAO_DO_BANCO);

    requisicao.onupgradeneeded = () => {
      const banco = requisicao.result;
      if (!banco.objectStoreNames.contains('syncQueue')) {
        banco.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
      }
      if (!banco.objectStoreNames.contains('sessao')) {
        banco.createObjectStore('sessao', { keyPath: 'chave' });
      }
    };

    requisicao.onsuccess = () => resolve(requisicao.result);
    requisicao.onerror = () => reject(requisicao.error);
  });

  return promessaDoBanco;
}

function promessaDaRequisicao(requisicao) {
  return new Promise((resolve, reject) => {
    requisicao.onsuccess = () => resolve(requisicao.result);
    requisicao.onerror = () => reject(requisicao.error);
  });
}

export async function obterTudo(nomeDaStore) {
  const banco = await abrirBanco();
  const store = banco.transaction(nomeDaStore, 'readonly').objectStore(nomeDaStore);
  return promessaDaRequisicao(store.getAll());
}

export async function obterPorChave(nomeDaStore, chave) {
  const banco = await abrirBanco();
  const store = banco.transaction(nomeDaStore, 'readonly').objectStore(nomeDaStore);
  return promessaDaRequisicao(store.get(chave));
}

// Retorna a chave gerada (relevante pra `syncQueue`, que usa autoIncrement).
export async function salvar(nomeDaStore, valor) {
  const banco = await abrirBanco();
  const store = banco.transaction(nomeDaStore, 'readwrite').objectStore(nomeDaStore);
  return promessaDaRequisicao(store.put(valor));
}

export async function remover(nomeDaStore, chave) {
  const banco = await abrirBanco();
  const store = banco.transaction(nomeDaStore, 'readwrite').objectStore(nomeDaStore);
  return promessaDaRequisicao(store.delete(chave));
}
