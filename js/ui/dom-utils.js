// Helpers de DOM pequenos, compartilhados entre as telas (screen-import.js,
// screen-counting.js). Compartilhado justamente pra não existir uma cópia
// local em cada tela que possa divergir em silêncio.

// Escapa texto pra uso seguro tanto como CONTEÚDO de elemento quanto dentro
// de um ATRIBUTO (ex.: data-chave="${escaparHtml(chave)}"). textContent-
// >innerHTML sozinho escapa &, < e > mas não aspas — um valor vindo do
// relatório do WMS com `"` quebraria um atributo, então trocamos as aspas
// à mão depois.
export function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
