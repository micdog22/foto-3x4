# Foto 3x4

Monte fotos 3x4 (ou 5x7) para imprimir em papel 10x15 ou numa folha A4, direto no navegador: você enquadra o rosto com guias, a página calcula quantas fotos cabem, desenha as linhas de corte e gera um JPEG com a resolução certa (300 dpi) gravada no arquivo. A foto não sai do seu aparelho.

**Acesse online:** https://micdog22.github.io/foto-3x4/

## Recursos

- Abre a foto pelo botão (no celular, também pela câmera), arrastando o arquivo ou colando com <kbd>Ctrl</kbd> + <kbd>V</kbd>.
- Recorte com proporção fixa (3:4 ou 5:7): arrastar para posicionar, zoom pela roda do mouse, pela pinça ou pelo controle deslizante, endireitar de -45° a 45° e girar 90°.
- Guias de enquadramento: oval do rosto, linha dos olhos, topo da cabeça e queixo.
- O quadro nunca fica com cantos vazios: o zoom e a posição se ajustam sozinhos quando a foto é girada.
- Aviso de qualidade: mostra a resolução real que a sua foto terá impressa e avisa quando ela vai sair borrada.
- Folha 10x15 cm (1181 x 1772 pixels) ou A4 (2480 x 3508 pixels), com espaço entre fotos, margem mínima e quantidade ajustáveis. A página escolhe sozinha se as fotos ficam em pé ou deitadas para caber mais.
- Linhas de corte em volta do bloco de fotos e dica automática quando dá para caber mais fotos.
- Baixa a folha ou uma foto avulsa em JPEG com **300 dpi gravados no cabeçalho JFIF**, então a foto 3x4 sai com 3 x 4 cm.
- Imprime direto pelo navegador com a página no tamanho exato do papel (CSS em milímetros).
- Lembra os ajustes da folha neste navegador. Funciona no celular, com tema claro e escuro.
- Sem dependências, sem servidor, sem rastreadores.

## Como usar

1. Abra a página e escolha a foto (ou toque em **Testar com um exemplo**).
2. Arraste a foto até o rosto ficar dentro do oval, com os olhos perto da linha. Ajuste o zoom e, se a foto estiver torta, use **Endireitar**.
3. Escolha o tamanho da foto e o papel. Confira a prévia da folha.
4. Clique em **Baixar folha (JPEG 300 dpi)** e leve o arquivo à loja de revelação, pedindo impressão 10x15 **sem ajuste**. Ou use **Imprimir** em casa, com escala 100% e margens "nenhuma".

Os arquivos saem com nomes como `fotos-3x4-10x15.jpg` (a folha) e `foto-3x4.jpg` (uma foto só).

Atalhos com o foco na foto: setas movem (com <kbd>Shift</kbd>, passos maiores), <kbd>+</kbd> e <kbd>-</kbd> dão zoom, <kbd>[</kbd> e <kbd>]</kbd> endireitam meio grau (com <kbd>Shift</kbd>, cinco graus).

## Como rodar localmente

Módulos ES não carregam via `file://`, então sirva a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000
```

Depois abra http://localhost:8000.

## Testes

```bash
npm test
```

São 47 testes com `node:test`, sem dependências:

- **unidades:** conversões de milímetros para pixels com os tamanhos de referência (354 x 472, 1181 x 1772, 2480 x 3508) e o erro máximo do arredondamento;
- **montagem:** quantidade e posição de cada foto em vários papéis, espaços e margens, escolha entre fotos em pé e deitadas, limite de quantidade, posições inteiras em pixels, linhas de corte e uma varredura que confere que nenhuma combinação deixa foto fora da margem, sobreposta ou com espaço sobrando para mais uma coluna ou linha;
- **recorte:** escala mínima de cobertura com rotação, matriz igual à composição das transformações do canvas, ida e volta entre quadro e foto, zoom ancorado no cursor, arraste que acompanha o dedo e 2.000 recortes aleatórios (semente fixa) em que os quatro cantos do quadro sempre caem dentro da foto;
- **JFIF:** troca da densidade num cabeçalho sintético byte a byte, inserção do segmento quando ele não existe, remoção do Exif, preservação da miniatura e erros de arquivo truncado.

No macOS, um teste diferencial grava a densidade num JPEG gerado pelo `sips` e confere que o próprio `sips` lê 300 dpi (e 254 dpi). Em outros sistemas esse teste é pulado.

## Como funciona

### Milímetros, polegadas e pixels

Impressão é medida em pontos por polegada (dpi). Uma polegada tem 25,4 mm, então a 300 dpi cada milímetro vale 300 / 25,4 = 11,81 pixels:

| Medida | Conta | Pixels |
| --- | --- | --- |
| 3 cm | 30 × 11,81 | 354 |
| 4 cm | 40 × 11,81 | 472 |
| 10 cm | 100 × 11,81 | 1181 |
| 15 cm | 150 × 11,81 | 1772 |
| A4 | 210 × 297 mm | 2480 x 3508 |

Arredondar para pixels inteiros erra no máximo meio pixel, ou 0,04 mm. A 300 dpi o olho não percebe os pontos, e é a resolução que as lojas de revelação usam.

### Quantas fotos cabem

Com `n` fotos de largura `f` e espaço `e` entre elas, a fileira ocupa `n·f + (n - 1)·e`. Para caber na largura útil `L` (papel menos as duas margens):

```
n·f + (n - 1)·e <= L   =>   n = floor((L + e) / (f + e))
```

O mesmo vale para as linhas. A página calcula a grade com a foto em pé e deitada e fica com a que cabe mais (no empate, em pé), depois centraliza o bloco na folha:

| Foto | Papel | Espaço e margem | Resultado |
| --- | --- | --- | --- |
| 3x4 | 10x15 | 2 mm e 2 mm | 9 fotos (3 x 3, em pé) |
| 5x7 | 10x15 | 2 mm e 2 mm | 2 fotos |
| 5x7 | 10x15 | 0 e 0 | 4 fotos (2 x 2, encostadas) |
| 3x4 | A4 | 2 mm e 6 mm | 36 fotos (6 x 6) |
| 5x7 | A4 | 2 mm e 6 mm | 10 fotos (deitadas, 2 x 5) |

As linhas de corte são as bordas das fotos. Elas são desenhadas **por baixo** das fotos, cobrindo o bloco e passando 6 mm além dele, então só aparecem nos espaços e nas margens, como as marcas de corte de uma gráfica.

### O recorte com zoom e rotação

O estado do recorte é o ponto da foto que fica no centro do quadro `c`, a rotação `θ` e o zoom. Um ponto `p` da foto vai para o quadro de saída assim:

```
q = R(θ) · (p - c) · s + centro do quadro
```

onde `R(θ)` é a matriz de rotação e `s` a escala. Essa conta vira uma única matriz afim, passada ao `setTransform` do canvas.

A regra principal é **o quadro nunca pode ter canto vazio**. O quadro de largura `w` e altura `h`, girado de `θ`, ocupa nos eixos da foto uma caixa de `w·|cos θ| + h·|sen θ|` por `w·|sen θ| + h·|cos θ|`. Para caber numa foto `W x H`:

```
s_min = max( (w·|cos θ| + h·|sen θ|) / W , (w·|sen θ| + h·|cos θ|) / H )
```

O zoom da tela é relativo a esse mínimo (100% = `s_min`), por isso endireitar a foto aproxima um pouco, como nos editores de celular. Depois, o centro fica preso numa faixa: metade daquela caixa (dividida pela escala) até a borda da foto. Para um retângulo girado dentro de outro alinhado aos eixos, essa condição garante que os quatro cantos ficam dentro, e um teste confere isso em 2.000 casos aleatórios.

Arrastar desfaz a rotação e a escala do movimento do dedo (`c' = c - R(-θ)·Δq / s`) e o zoom pela roda mantém parado o ponto sob o cursor.

### Reduzir sem serrilhar

Uma foto de celular tem uns 3000 pixels de largura e a 3x4 final tem 354: reduzir quase 10 vezes num passo só faz o canvas pular pixels e serrilhar. A página monta uma pirâmide de cópias reduzidas pela metade (como os mipmaps dos jogos) e desenha a partir do nível em que falta reduzir menos da metade.

O aviso de qualidade usa a mesma escala: `300 / s` é quantos pixels da foto original caem em cada polegada impressa. Abaixo de 150, a foto vai sair borrada.

### A resolução dentro do JPEG

O canvas gera um JPEG sem dizer o tamanho de impressão. Quem lê essa informação procura o segmento **APP0 JFIF**, logo depois do início do arquivo:

```
FF E0 | tamanho | "JFIF" 00 | versão | unidade | densidade X | densidade Y | miniatura
                                       1 = dpi    01 2C = 300 (2 bytes, big endian)
```

A página troca a unidade para 1 (pontos por polegada) e as densidades para 300, sem recomprimir a imagem: só esses 5 bytes mudam. Se o segmento não existe, ele é inserido. Segmentos Exif são removidos, porque podem trazer outra resolução (72 dpi é comum) que alguns programas preferem.

### Impressão em milímetros

Para imprimir pelo navegador, a página monta a folha com posições em `mm` e ativa uma regra `@page { size: 100mm 150mm; margin: 0 }` (ou A4). As duas regras ficam em arquivos CSS separados, ligados e desligados pelo app, porque a página usa uma política de segurança (CSP) que não aceita estilos embutidos. Com a escala em 100%, o navegador imprime a 3x4 com exatos 30 x 40 mm.

## Limitações

- A impressão pelo navegador respeita o tamanho do papel no Chrome e no Edge; em outros navegadores, confira o papel e a escala na janela de impressão.
- Fotos HEIC só abrem nos navegadores que leem esse formato (como o Safari). No iPhone, dá para usar Ajustes > Câmera > Formatos > Mais Compatível.
- As guias do rosto são aproximadas. Cada órgão tem suas regras de enquadramento, fundo e acessórios.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
