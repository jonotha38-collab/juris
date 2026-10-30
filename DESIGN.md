---
version: alpha
name: Juris
description: Carteira jurídica em português, organizada por cliente, OAB e tribunal.
colors:
  primary: "#237454"
  background: "#f5f7f5"
  surface: "#ffffff"
  text: "#243b32"
  muted: "#7e8d83"
  border: "#e4eae4"
  sidebar: "#142f28"
typography:
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "14px"
  heading:
    fontFamily: "Manrope, system-ui, sans-serif"
rounded:
  DEFAULT: "13px"
  field: "8px"
  dialog: "16px"
omitted:
  - section: spacing
    reason: O espaçamento existente é definido por componente em public/juris.css.
components:
  button:
    source: public/juris.css
  dialog:
    source: public/painel.html
  tribunalExport:
    source: public/tribunal-export.css
---

# Juris

## Overview

Produto de trabalho para um escritório brasileiro: encontrar o cliente, reconhecer o CNJ e decidir a próxima providência. A referência é uma carteira de processos com separadores de tribunal, com navegação escura e páginas claras. A tela de exportação amplia essa organização sem mudar a identidade das telas existentes.

O idioma é português do Brasil e o fuso das datas apresentadas é America/Sao_Paulo. O uso combina notebooks, monitores de escritório e telas estreitas. Legibilidade e controles conhecidos têm prioridade sobre ornamentação. A assinatura da exportação é a escolha explícita dos tribunais, com a quantidade selecionada sempre visível.

Os tokens canônicos continuam em `public/juris.css`; este documento registra os valores existentes, sem gerar uma segunda folha de tokens. `public/tribunal-export.css` consome as variáveis compartilhadas e define apenas a geometria específica do seletor. O formato do Excel reutiliza o gerador existente de `public/excel.mjs`.

## Colors

Verde identifica a ação principal e a seleção; fundo claro e bordas discretas organizam o conteúdo. Erros têm texto explícito e não dependem apenas de cor. A seleção usa borda, preenchimento e o estado nativo da caixa de seleção. A nova superfície mantém o tema claro do painel e respeita cores forçadas do sistema.

## Typography

DM Sans para campos, rótulos e textos; Manrope para títulos. Números de seleção usam algarismos tabulares. CNJs completos permanecem legíveis e são exportados como texto, preservando zeros iniciais.

## Layout

O diálogo tem no máximo 730 px e mantém a rolagem no conteúdo quando a altura disponível é pequena. A lista de tribunais tem duas colunas em telas maiores e uma em telas menores que 600 px. Rótulos longos quebram a linha. O rodapé mantém ações alcançáveis e não há animação que mude a geometria durante o carregamento.

## Elevation & Depth

Reutilizar borda, sombra e backdrop do diálogo nativo já empregado no aplicativo. A lista de seleção usa apenas bordas e contraste de superfície; não acrescentar cartões decorativos ou sombras em cascata.

## Shapes

Preservar os raios de campos, botões e diálogos do CSS compartilhado. A seleção por tribunal é um rótulo inteiro clicável, com checkbox nativo, nome e contagem de registros.

## Components

`primary`, `secondary`, `text-btn`, `field-help`, `form-error` e `notice` continuam sendo os padrões do aplicativo. O seletor usa elementos nativos e nomes acessíveis. O status da exportação e os erros ficam no próprio diálogo; o aviso global confirma o download. Escape ou Cancelar interrompe as requisições e devolve o foco à ação que abriu o diálogo. A busca local tem uma ação explícita para limpar o texto.

O scrollbar usa `--muted`, `--bg` e `--green`, com suporte padrão e fallback WebKit. Em cores forçadas, usar os controles do sistema. Nenhuma animação adicional foi introduzida.

## Do's and Don'ts

- Reutilizar cores e controles já presentes no Juris.
- Distinguir contagem única por CNJ da presença de um processo em mais de um tribunal.
- Exibir o filtro de OAB que será aplicado ao arquivo.
- Não transformar cadastros importados em publicações fictícias.
- Não comunicar sucesso antes de concluir todas as páginas e a validação de contagens.
- Não criar uma identidade visual paralela para uma ferramenta de exportação.
