// Gerador dos ícones PLACEHOLDER do PWA (Fase 7) — não há PIL/ImageMagick
// disponíveis no ambiente, então este script monta PNGs simples direto em
// bytes crus (usando só `node:zlib`, que já fala o formato de compressão
// que o PNG exige). Não faz parte do runtime do app — roda uma vez pra gerar
// os arquivos em app/icons/*.png, que são o que o manifest.json referencia.
//
// Ícone: fundo sólido (cor do tema) com um "clipboard" simples (retângulo
// branco + 3 barras), sugerindo lista de conferência. Substituir por uma
// identidade visual de verdade quando houver uma.
//
// Uso: node app/icons/generate-icons.mjs

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COR_FUNDO = [14, 125, 102]; // #0e7d66 — combina com theme_color do manifest
const COR_FRENTE = [255, 255, 255];

function criarBuffer(tamanho) {
  return new Array(tamanho).fill(null).map(() => new Array(tamanho).fill(null).map(() => COR_FUNDO.slice()));
}

function preencherRetangulo(pixels, x0, y0, x1, y1, cor) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pixels[y] && pixels[y][x]) pixels[y][x] = cor.slice();
    }
  }
}

// Desenha o "clipboard": um retângulo branco centralizado com 3 barras do
// tom de fundo por cima (viram "linhas de texto"), dentro da margem de
// segurança pedida por ícones maskable (~80% da área central).
function desenharClipboard(pixels, tamanho, margemFrac) {
  const margem = Math.round(tamanho * margemFrac);
  const x0 = margem;
  const x1 = tamanho - margem;
  const y0 = margem;
  const y1 = tamanho - margem;

  preencherRetangulo(pixels, x0, y0, x1, y1, COR_FRENTE);

  const alturaBarra = Math.round((y1 - y0) * 0.12);
  const espacoBarra = Math.round((y1 - y0) * 0.08);
  const margemBarraX = Math.round((x1 - x0) * 0.15);
  let yAtual = y0 + Math.round((y1 - y0) * 0.2);
  for (let i = 0; i < 3; i++) {
    preencherRetangulo(pixels, x0 + margemBarraX, yAtual, x1 - margemBarraX, yAtual + alturaBarra, COR_FUNDO);
    yAtual += alturaBarra + espacoBarra;
  }
}

function pixelsParaPng(pixels, tamanho) {
  // Cada linha (scanline) começa com 1 byte de filtro (0 = nenhum) + RGB por pixel.
  const bytesPorLinha = 1 + tamanho * 3;
  const dadosBrutos = Buffer.alloc(bytesPorLinha * tamanho);
  for (let y = 0; y < tamanho; y++) {
    const offsetLinha = y * bytesPorLinha;
    dadosBrutos[offsetLinha] = 0; // filtro "None"
    for (let x = 0; x < tamanho; x++) {
      const [r, g, b] = pixels[y][x];
      const offsetPixel = offsetLinha + 1 + x * 3;
      dadosBrutos[offsetPixel] = r;
      dadosBrutos[offsetPixel + 1] = g;
      dadosBrutos[offsetPixel + 2] = b;
    }
  }

  const idatComprimido = zlib.deflateSync(dadosBrutos, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0); // width
  ihdr.writeUInt32BE(tamanho, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: 2 = RGB (truecolor, sem alfa)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const assinaturaPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    assinaturaPng,
    montarChunk('IHDR', ihdr),
    montarChunk('IDAT', idatComprimido),
    montarChunk('IEND', Buffer.alloc(0)),
  ]);
}

function montarChunk(tipo, dados) {
  const tamanhoBuf = Buffer.alloc(4);
  tamanhoBuf.writeUInt32BE(dados.length, 0);
  const tipoBuf = Buffer.from(tipo, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tipoBuf, dados])), 0);
  return Buffer.concat([tamanhoBuf, tipoBuf, dados, crcBuf]);
}

// CRC-32 padrão (mesmo polinômio usado por PNG/zip), sem depender de libs externas.
const TABELA_CRC32 = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = TABELA_CRC32[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function gerarIcone(tamanho, margemFrac, nomeArquivo) {
  const pixels = criarBuffer(tamanho);
  desenharClipboard(pixels, tamanho, margemFrac);
  const png = pixelsParaPng(pixels, tamanho);
  const destino = path.join(__dirname, nomeArquivo);
  writeFileSync(destino, png);
  console.log(`Gerado: ${nomeArquivo} (${tamanho}x${tamanho}, ${png.length} bytes)`);
}

// 192/512 "any": margem menor, ocupa mais a área (não precisa de safe zone).
gerarIcone(192, 0.15, 'icon-192.png');
gerarIcone(512, 0.15, 'icon-512.png');
// 512 "maskable": margem maior (~conteúdo dentro dos ~80% centrais), pra
// sobreviver a recortes de forma (círculo, squircle etc.) que o SO aplicar.
gerarIcone(512, 0.22, 'icon-512-maskable.png');
