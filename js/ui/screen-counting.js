// Tela de contagem (spec seção 4.2). Contagem às cegas: a quantidade
// esperada do grupo é buscada junto com o resto dos dados da área (1 busca
// só, no início da sessão), mas NUNCA renderizada — só usada depois, na
// comparação, sem aparecer na tela em nenhum momento. A recontagem (Fase 11)
// segue a mesma regra: mostra só os grupos divergentes, também às cegas.
//
// Sessão (nome, área, grupos já buscados/agrupados, progresso) persiste no
// IndexedDB (`sessao`, ver data/db.js) — um reload acidental ou queda de
// rede no meio da contagem OU da recontagem retoma de onde parou, sem
// buscar a área de novo. O envio passa pela fila de sincronização
// (data/sync-queue.js) em vez de um fetch direto: enfileira e devolve na
// hora, o envio de verdade acontece em segundo plano com retry automático.
//
// Todo handler assíncrono acionado por clique tem try/catch — uma falha de
// IndexedDB (aba anônima, WebView com storage restrito, quota estourada)
// NUNCA pode deixar o app travado sem nenhuma mensagem pro contador. Isso já
// aconteceu de forma silenciosa numa versão anterior (ver auditoria antes da
// documentação final) — a correção é sempre reabilitar o botão e mostrar o
// erro no catch, em vez de deixar a promise rejeitar sem tratamento.

import { groupByKey, chaveDoGrupo } from '../core/grouping.js';
import { compararPosicoes } from '../core/area.js';
import { compararGrupo } from '../core/compare.js';
import { distribuirProporcional, resolverRecontagem } from '../core/proportional-split.js';
import { buscarArea } from '../data/api-client.js';
import { obterPorChave, salvar, remover } from '../data/db.js';
import { enfileirarEDrenar } from '../data/sync-queue.js';
import { iniciarBadgeDeSincronizacao } from './sync-status-badge.js';
import { escaparHtml } from './dom-utils.js';

const CHAVE_DA_SESSAO = 'atual';

const telaSessao = document.getElementById('tela-sessao');
const telaContagem = document.getElementById('tela-contagem');
const telaRecontagem = document.getElementById('tela-recontagem');
const telaResultado = document.getElementById('tela-resultado');

const campoNome = document.getElementById('nome-contador');
const campoArea = document.getElementById('area-selecionada');
const botaoComecar = document.getElementById('btn-comecar');
const statusSessao = document.getElementById('status-sessao');

const elProgresso = document.getElementById('progresso-posicao');
const elTituloPosicao = document.getElementById('titulo-posicao');
const elListaGrupos = document.getElementById('lista-grupos');
const botaoAvancar = document.getElementById('btn-avancar');
const statusContagem = document.getElementById('status-contagem');

const botaoMostrarItemAvulso = document.getElementById('btn-mostrar-item-avulso');
const formItemAvulso = document.getElementById('form-item-avulso');
const campoNomeItemAvulso = document.getElementById('campo-nome-item-avulso');
const campoQuantidadeItemAvulso = document.getElementById('campo-quantidade-item-avulso');
const campoEtiquetadoItemAvulso = document.getElementById('campo-etiquetado-item-avulso');
const campoObservacaoItemAvulso = document.getElementById('campo-observacao-item-avulso');
const botaoAdicionarItemAvulso = document.getElementById('btn-adicionar-item-avulso');
const botaoCancelarItemAvulso = document.getElementById('btn-cancelar-item-avulso');
const statusItemAvulso = document.getElementById('status-item-avulso');
const elListaItensAvulsos = document.getElementById('lista-itens-avulsos');

const elProgressoRecontagem = document.getElementById('progresso-recontagem');
const elListaRecontagem = document.getElementById('lista-recontagem');
const botaoConcluirRecontagem = document.getElementById('btn-concluir-recontagem');
const statusRecontagem = document.getElementById('status-recontagem');

const elResumoResultado = document.getElementById('resultado-resumo');

let nomeContador = '';
let areaAtual = '';
let posicoes = []; // [{ posicao, grupos: [...] }], já ordenado
let indicePosicaoAtual = 0;
let contagensPorChave = new Map(); // chaveDoGrupo -> { quantidadeContada, etiquetado, observacao }
let gruposDivergentesAtual = []; // preenchido só durante a recontagem

iniciarBadgeDeSincronizacao();
botaoComecar.addEventListener('click', iniciarSessao);
botaoAvancar.addEventListener('click', avancarOuConcluir);
botaoConcluirRecontagem.addEventListener('click', enviarRecontagem);
botaoMostrarItemAvulso.addEventListener('click', mostrarFormularioItemAvulso);
botaoCancelarItemAvulso.addEventListener('click', esconderFormularioItemAvulso);
botaoAdicionarItemAvulso.addEventListener('click', adicionarItemAvulso);
tentarRetomarSessaoSalva();

async function tentarRetomarSessaoSalva() {
  let sessaoSalva;
  try {
    sessaoSalva = await obterPorChave('sessao', CHAVE_DA_SESSAO);
  } catch (erro) {
    // Sem acesso ao IndexedDB não dá pra garantir que nada será perdido —
    // bloqueia a sessão em vez de deixar o contador começar uma contagem
    // que talvez não consiga ser salva (ver nota do topo do arquivo).
    definirStatusSessao(
      `Não foi possível acessar o armazenamento local deste navegador (${erro.message}). Sem isso a contagem ` +
        'não pode ser salva com segurança. Evite aba anônima e tente outro navegador.',
      true,
    );
    botaoComecar.disabled = true;
    return;
  }
  if (!sessaoSalva) return;

  try {
    if (sessaoSalva.fase === 'recontagem') {
      if (!Array.isArray(sessaoSalva.gruposDivergentes)) throw new Error('lista de divergentes ausente');
      nomeContador = sessaoSalva.nomeContador;
      areaAtual = sessaoSalva.area;
      gruposDivergentesAtual = sessaoSalva.gruposDivergentes;
      mostrarTelaRecontagem();
      return;
    }

    if (!Array.isArray(sessaoSalva.posicoes)) throw new Error('lista de posições ausente');
    nomeContador = sessaoSalva.nomeContador;
    areaAtual = sessaoSalva.area;
    posicoes = sessaoSalva.posicoes;
    indicePosicaoAtual = sessaoSalva.indicePosicaoAtual;
    // Persistido como array de pares (não o Map em si) — depende só de JSON
    // estrutural simples, sem contar com o clone estruturado preservar Map.
    contagensPorChave = new Map(sessaoSalva.contagensPorChave || []);
    mostrarTelaContagem();
  } catch (erro) {
    // Sessão salva veio num formato inesperado — mais seguro descartar e
    // deixar o contador recomeçar do que tentar adivinhar o que falta.
    await remover('sessao', CHAVE_DA_SESSAO).catch(() => {});
    definirStatusSessao(`Não foi possível retomar a sessão salva (${erro.message}). Comece de novo.`, true);
  }
}

async function persistirSessaoDeContagem() {
  await salvar('sessao', {
    chave: CHAVE_DA_SESSAO,
    fase: 'contagem',
    nomeContador,
    area: areaAtual,
    posicoes,
    indicePosicaoAtual,
    contagensPorChave: [...contagensPorChave],
  });
}

async function persistirSessaoDeRecontagem() {
  await salvar('sessao', {
    chave: CHAVE_DA_SESSAO,
    fase: 'recontagem',
    nomeContador,
    area: areaAtual,
    gruposDivergentes: gruposDivergentesAtual,
  });
}

async function iniciarSessao() {
  const nome = campoNome.value.trim();
  const area = campoArea.value.trim();

  if (!nome) return definirStatusSessao('Digite seu nome.', true);
  if (!area) return definirStatusSessao('Digite sua área.', true);

  botaoComecar.disabled = true;
  definirStatusSessao('Buscando dados da área…');

  try {
    const resultado = await buscarArea(area);
    if (!resultado.ok) throw new Error(resultado.erro || 'erro desconhecido do servidor');
    if (resultado.linhas.length === 0) throw new Error(`nenhuma linha encontrada pra área "${area}"`);

    nomeContador = nome;
    areaAtual = area;
    posicoes = organizarPorPosicao(resultado.linhas);
    indicePosicaoAtual = 0;
    contagensPorChave = new Map();

    await persistirSessaoDeContagem();
    mostrarTelaContagem();
  } catch (erro) {
    definirStatusSessao(`Erro: ${erro.message}`, true);
    botaoComecar.disabled = false;
  }
}

function organizarPorPosicao(linhas) {
  const grupos = groupByKey(linhas);
  const porPosicao = new Map();
  for (const grupo of grupos) {
    if (!porPosicao.has(grupo.posicao)) porPosicao.set(grupo.posicao, []);
    porPosicao.get(grupo.posicao).push(grupo);
  }
  const posicoesOrdenadas = [...porPosicao.keys()].sort(compararPosicoes);
  return posicoesOrdenadas.map((posicao) => ({ posicao, grupos: porPosicao.get(posicao) }));
}

function mostrarTelaContagem() {
  telaSessao.hidden = true;
  telaContagem.hidden = false;
  renderizarPosicaoAtual();
}

function renderizarPosicaoAtual() {
  const { posicao, grupos } = posicoes[indicePosicaoAtual];
  elProgresso.textContent = `Posição ${indicePosicaoAtual + 1} de ${posicoes.length} — área ${areaAtual}`;
  elTituloPosicao.textContent = posicao;
  elListaGrupos.innerHTML = grupos.map(renderizarCartaoDoGrupo).join('');
  preencherContagensJaSalvas(grupos);
  botaoAvancar.disabled = false;
  botaoAvancar.textContent = ehUltimaPosicao() ? 'Concluir área' : 'Próxima posição';
  definirStatusContagem('');

  // "Item não encontrado" (spec 4.2 passo 5) é por posição — reseta ao trocar.
  elListaItensAvulsos.innerHTML = '';
  esconderFormularioItemAvulso();
}

// Se o contador voltou a essa posição (ou retomou uma sessão salva), os
// campos vêm preenchidos com o que já tinha digitado, em vez de em branco.
function preencherContagensJaSalvas(grupos) {
  for (const grupo of grupos) {
    const contagemSalva = contagensPorChave.get(chaveDoGrupo(grupo));
    if (!contagemSalva) continue;

    const cartao = elListaGrupos.querySelector(`[data-chave="${CSS.escape(chaveDoGrupo(grupo))}"]`);
    if (!cartao) continue;

    cartao.querySelector('.campo-quantidade').value = contagemSalva.quantidadeContada;
    cartao.querySelector('.campo-etiquetado').value = contagemSalva.etiquetado;
    cartao.querySelector('.campo-observacao').value = contagemSalva.observacao || '';
  }
}

function renderizarCartaoDoGrupo(grupo) {
  const linhaBase = grupo.linhasOriginais[0];
  const docsFiscais = grupo.linhasOriginais.map((l) => l.docFiscal).join(', ');
  const chave = chaveDoGrupo(grupo);

  return `
    <fieldset class="cartao-grupo" data-chave="${escaparHtml(chave)}">
      <legend>${escaparHtml(linhaBase.nomeProduto)}</legend>
      ${renderizarDetalhesDoGrupo(grupo, linhaBase, docsFiscais)}

      <label>Quantidade contada
        <input type="number" min="0" step="1" inputmode="numeric" class="campo-quantidade" required />
      </label>
      <label>Etiquetado
        <select class="campo-etiquetado">
          <option value="Sim">Sim</option>
          <option value="Não">Não</option>
        </select>
      </label>
      <label>Observação (opcional)
        <input type="text" class="campo-observacao" />
      </label>
    </fieldset>
  `;
}

function renderizarDetalhesDoGrupo(grupo, linhaBase, docsFiscais) {
  return `
    <dl class="detalhes-grupo">
      <div><dt>Lote</dt><dd>${escaparHtml(grupo.lote)}</dd></div>
      <div><dt>Doc. Fiscal</dt><dd>${escaparHtml(docsFiscais)}</dd></div>
      <div><dt>Fabricante</dt><dd>${escaparHtml(linhaBase.fabricante)}</dd></div>
      <div><dt>Fabricação</dt><dd>${escaparHtml(linhaBase.dataFabricacao)}</dd></div>
      <div><dt>Validade</dt><dd>${escaparHtml(linhaBase.dataValidade)}</dd></div>
      <div><dt>Embalagem</dt><dd>${escaparHtml(linhaBase.embalagem)}</dd></div>
    </dl>
  `;
}

function ehUltimaPosicao() {
  return indicePosicaoAtual === posicoes.length - 1;
}

async function avancarOuConcluir() {
  if (!salvarContagensDaPosicaoAtual()) return;

  if (!ehUltimaPosicao()) {
    const indiceAnterior = indicePosicaoAtual;
    botaoAvancar.disabled = true;
    try {
      indicePosicaoAtual += 1;
      await persistirSessaoDeContagem();
    } catch (erro) {
      indicePosicaoAtual = indiceAnterior; // reverte — o que já foi digitado continua em memória
      botaoAvancar.disabled = false;
      definirStatusContagem(`Não foi possível salvar localmente (${erro.message}). Tente de novo.`, true);
      return;
    }
    renderizarPosicaoAtual();
    return;
  }

  await concluirArea();
}

function salvarContagensDaPosicaoAtual() {
  const cartoes = elListaGrupos.querySelectorAll('.cartao-grupo');
  for (const cartao of cartoes) {
    const campoQuantidade = cartao.querySelector('.campo-quantidade');
    if (campoQuantidade.value === '') {
      definirStatusContagem('Preencha a quantidade contada de todos os itens desta posição.', true);
      campoQuantidade.focus();
      return false;
    }

    contagensPorChave.set(cartao.dataset.chave, {
      quantidadeContada: Number(campoQuantidade.value),
      etiquetado: cartao.querySelector('.campo-etiquetado').value,
      observacao: cartao.querySelector('.campo-observacao').value.trim() || undefined,
    });
  }
  return true;
}

// "Adicionar item não encontrado" (spec seção 4.2, passo 5): entrada manual
// rápida pra um item físico que está na posição mas não estava na lista
// importada. Vai pro Apps Script como uma linha nova (sem SKU/Doc.Fiscal/
// Lote/quantidade esperada) — nunca entra na comparação/recontagem
// automática, só fica registrada pra revisão humana (ver
// apps-script/CountingService.gs). Enfileirado do mesmo jeito que o resto
// (data/sync-queue.js): salva local e envia em segundo plano.
function mostrarFormularioItemAvulso() {
  formItemAvulso.hidden = false;
  botaoMostrarItemAvulso.hidden = true;
  campoNomeItemAvulso.focus();
}

function esconderFormularioItemAvulso() {
  formItemAvulso.hidden = true;
  botaoMostrarItemAvulso.hidden = false;
  campoNomeItemAvulso.value = '';
  campoQuantidadeItemAvulso.value = '';
  campoEtiquetadoItemAvulso.value = 'Sim';
  campoObservacaoItemAvulso.value = '';
  definirStatusItemAvulso('');
}

async function adicionarItemAvulso() {
  const nomeProduto = campoNomeItemAvulso.value.trim();
  const quantidade = campoQuantidadeItemAvulso.value;

  if (!nomeProduto) {
    definirStatusItemAvulso('Digite o nome do produto.', true);
    campoNomeItemAvulso.focus();
    return;
  }
  if (quantidade === '') {
    definirStatusItemAvulso('Digite a quantidade encontrada.', true);
    campoQuantidadeItemAvulso.focus();
    return;
  }

  const quantidadeContada = Number(quantidade);
  const etiquetado = campoEtiquetadoItemAvulso.value;

  botaoAdicionarItemAvulso.disabled = true;
  definirStatusItemAvulso('Salvando localmente e enviando…');

  try {
    await enfileirarEDrenar('adicionar_item_nao_encontrado', {
      contador: nomeContador,
      area: areaAtual,
      posicao: posicoes[indicePosicaoAtual].posicao,
      nomeProduto,
      quantidadeContada,
      etiquetado,
      observacao: campoObservacaoItemAvulso.value.trim() || undefined,
    });

    registrarItemAvulsoNaLista(nomeProduto, quantidadeContada);
    esconderFormularioItemAvulso();
  } catch (erro) {
    definirStatusItemAvulso(`Não foi possível salvar (${erro.message}). Tente de novo.`, true);
  } finally {
    botaoAdicionarItemAvulso.disabled = false;
  }
}

function registrarItemAvulsoNaLista(nomeProduto, quantidade) {
  const item = document.createElement('li');
  item.textContent = `${nomeProduto} — ${quantidade} (adicionado nesta posição)`;
  elListaItensAvulsos.appendChild(item);
}

// spec seção 4.2, passo 6: ao concluir a última posição, roda a comparação
// automaticamente e, se houver divergências, abre direto a recontagem —
// só dos grupos divergentes daquela área, sem esperar as outras áreas.
async function concluirArea() {
  botaoAvancar.disabled = true;
  botaoAvancar.textContent = 'Enviando…';
  definirStatusContagem('Salvando localmente e enviando pra Planilha Google central…');

  try {
    const todosOsGrupos = posicoes.flatMap((p) => p.grupos);
    const escritas = [];
    const gruposDivergentes = [];

    for (const grupo of todosOsGrupos) {
      const dados = contagensPorChave.get(chaveDoGrupo(grupo));
      if (!dados) {
        throw new Error(
          `grupo sem contagem registrada (posição ${grupo.posicao}) — a sessão pode estar corrompida, reinicie`,
        );
      }
      const { quantidadeContada, etiquetado, observacao } = dados;

      if (compararGrupo(grupo, quantidadeContada)) gruposDivergentes.push(grupo);

      distribuirProporcional(grupo, quantidadeContada).forEach((escrita, indice) => {
        escritas.push({
          rowId: escrita.rowId,
          primeiraContagem: escrita.primeiraContagem,
          etiquetado,
          observacao: escrita.observacao ?? (indice === 0 ? observacao : undefined),
        });
      });
    }

    // Enfileira e retorna na hora — o envio de verdade (com retry automático
    // se a rede cair) acontece em segundo plano (data/sync-queue.js).
    await enfileirarEDrenar('gravar_contagem_grupo', {
      contador: nomeContador,
      area: areaAtual,
      timestamp: new Date().toISOString(),
      fase: 'primeira',
      escritas,
    });

    if (gruposDivergentes.length > 0) {
      gruposDivergentesAtual = gruposDivergentes;
      await persistirSessaoDeRecontagem();
      mostrarTelaRecontagem();
    } else {
      await remover('sessao', CHAVE_DA_SESSAO);
      irParaTelaResultado(
        `${todosOsGrupos.length} grupo(s) contado(s) na área ${areaAtual}. Salvo neste aparelho e sincronizando ` +
          `com a Planilha Google central (acompanhe pelo indicador no rodapé). Nenhuma divergência.`,
      );
    }
  } catch (erro) {
    botaoAvancar.disabled = false;
    botaoAvancar.textContent = ehUltimaPosicao() ? 'Concluir área' : 'Próxima posição';
    definirStatusContagem(`Erro ao concluir a área: ${erro.message}. Nada foi perdido — tente de novo.`, true);
  }
}

function mostrarTelaRecontagem() {
  telaSessao.hidden = true;
  telaContagem.hidden = true;
  telaRecontagem.hidden = false;

  elProgressoRecontagem.textContent =
    `Recontagem — ${gruposDivergentesAtual.length} item(ns) divergente(s) na área ${areaAtual}`;
  elListaRecontagem.innerHTML = gruposDivergentesAtual.map(renderizarCartaoDeRecontagem).join('');
  botaoConcluirRecontagem.disabled = false;
  botaoConcluirRecontagem.textContent = 'Concluir recontagem';
  definirStatusRecontagem('');
}

function renderizarCartaoDeRecontagem(grupo) {
  const linhaBase = grupo.linhasOriginais[0];
  const docsFiscais = grupo.linhasOriginais.map((l) => l.docFiscal).join(', ');
  const chave = chaveDoGrupo(grupo);

  return `
    <fieldset class="cartao-grupo" data-chave="${escaparHtml(chave)}">
      <legend>${escaparHtml(linhaBase.nomeProduto)}</legend>
      ${renderizarDetalhesDoGrupo(grupo, linhaBase, docsFiscais)}

      <label>Quantidade recontada
        <input type="number" min="0" step="1" inputmode="numeric" class="campo-recontagem" required />
      </label>
    </fieldset>
  `;
}

async function enviarRecontagem() {
  const cartoes = elListaRecontagem.querySelectorAll('.cartao-grupo');
  const quantidadesRecontadasPorChave = new Map();

  for (const cartao of cartoes) {
    const campo = cartao.querySelector('.campo-recontagem');
    if (campo.value === '') {
      definirStatusRecontagem('Preencha a recontagem de todos os itens.', true);
      campo.focus();
      return;
    }
    quantidadesRecontadasPorChave.set(cartao.dataset.chave, Number(campo.value));
  }

  botaoConcluirRecontagem.disabled = true;
  botaoConcluirRecontagem.textContent = 'Enviando…';
  definirStatusRecontagem('Salvando localmente e enviando pra Planilha Google central…');

  try {
    const escritas = [];
    for (const grupo of gruposDivergentesAtual) {
      const chave = chaveDoGrupo(grupo);
      const quantidadeRecontada = quantidadesRecontadasPorChave.get(chave);
      if (quantidadeRecontada === undefined) {
        throw new Error(`recontagem sem valor pra ${chave} — a sessão pode estar corrompida, reinicie`);
      }
      escritas.push(...resolverRecontagem(grupo, quantidadeRecontada));
    }

    await enfileirarEDrenar('gravar_contagem_grupo', {
      contador: nomeContador,
      area: areaAtual,
      timestamp: new Date().toISOString(),
      fase: 'segunda',
      escritas,
    });

    await remover('sessao', CHAVE_DA_SESSAO);
    irParaTelaResultado(
      `Recontagem de ${gruposDivergentesAtual.length} grupo(s) na área ${areaAtual} enviada. Salvo neste aparelho e ` +
        `sincronizando com a Planilha Google central (acompanhe pelo indicador no rodapé).`,
    );
  } catch (erro) {
    botaoConcluirRecontagem.disabled = false;
    botaoConcluirRecontagem.textContent = 'Concluir recontagem';
    definirStatusRecontagem(`Erro ao concluir a recontagem: ${erro.message}. Nada foi perdido — tente de novo.`, true);
  }
}

function irParaTelaResultado(texto) {
  telaContagem.hidden = true;
  telaRecontagem.hidden = true;
  telaResultado.hidden = false;
  elResumoResultado.textContent = texto;
}

function definirStatusSessao(mensagem, ehErro) {
  statusSessao.textContent = mensagem;
  statusSessao.classList.toggle('erro', Boolean(ehErro));
}

function definirStatusContagem(mensagem, ehErro) {
  statusContagem.textContent = mensagem;
  statusContagem.classList.toggle('erro', Boolean(ehErro));
}

function definirStatusRecontagem(mensagem, ehErro) {
  statusRecontagem.textContent = mensagem;
  statusRecontagem.classList.toggle('erro', Boolean(ehErro));
}

function definirStatusItemAvulso(mensagem, ehErro) {
  statusItemAvulso.textContent = mensagem;
  statusItemAvulso.classList.toggle('erro', Boolean(ehErro));
}
