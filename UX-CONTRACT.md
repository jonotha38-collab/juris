# UX Contract

## Product context

Juris é um painel jurídico em português do Brasil, com datas de escritório em America/Sao_Paulo. Este contrato registra a exportação por tribunais e os componentes compartilhados que ela utiliza. Outros fluxos existentes mantêm seus contratos de domínio; sua presença não significa que foram redesenhados ou auditados nesta alteração.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Permissões de exportação | `core/reports.mjs`, `core/collaboration.mjs` | Autorização verificada no servidor | 2026-10-30 |
| Seleção por OAB e tribunal | `core/engine.mjs`, seção de exportação do `README.md` | Escopo de consulta e requisito do produto | 2026-10-30 |
| Cadastro importado e publicação real | `migrations/0006_process_catalog.sql`, `README.md` | Contrato de dados | 2026-10-30 |
| Paginação e consistência do arquivo | `core/reports.mjs`, `public/tribunal-report.mjs` | Contrato da exportação | 2026-10-30 |

A exportação é uma leitura. Não exclui registros, altera permissões, trata publicações como lidas, conclui tarefas nem faz chamadas de IA. Não existem mudanças de cobrança ou retenção neste fluxo.

## Visual contract

`DESIGN.md` registra a identidade existente. Os tokens permanecem canônicos em `public/juris.css`; `public/tribunal-export.css` apenas estende o padrão para a seleção e a geração do arquivo.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | `createTribunalExportUI`, checkbox e label nativos | `public/tribunal-export-ui.mjs` | Todos os tribunais do escopo; busca não remove a seleção | `tests/tribunal-export-ui.test.mjs` |
| Select/Listbox | Controles nativos já usados em `public/painel.html` | `public/juris.css` | Popup do sistema; o novo seletor usa checkboxes | Controles de filtro existentes e teste da página |
| Date | Valores ISO da API e formatação do Excel | `public/tribunal-report.mjs`, `public/excel.mjs` | Datas válidas como datas; valores inválidos preservados como texto | `tests/tribunal-excel.test.mjs` |
| Form | Formulário de exportação com validação própria | `public/tribunal-export-ui.mjs` | `novalidate`, pelo menos um tribunal, envio único | `tests/tribunal-export-ui.test.mjs` |
| Scrollbar | Baseline do documento | `public/tribunal-export.css` | Cores compartilhadas; cores forçadas do sistema | CSS e lista de seleção |
| Toast | `notice` do painel | `public/juris.js` | Sucesso do arquivo; erro persistente no diálogo | `tests/tribunal-export-ui.test.mjs` |
| CRUD | API de relatórios, somente leitura | `core/reports.mjs` | Administrador; sem mutações | `tests/reports.test.mjs` |

## Dataset navigation

A seleção contém todos os tribunais disponíveis na OAB e nos filtros ativos, não apenas os resultados da página visível. O tribunal atual é a seleção inicial, quando houver; os demais continuam disponíveis para escolha. Sem tribunal específico, a seleção inicial inclui todos. A busca só reduz as opções exibidas, mantendo as seleções ocultas. Selecionar todos aplica-se ao conjunto completo, e Limpar seleção remove todos.

A escolha do relatório é transitória e não altera a URL ou os filtros da carteira. A exportação percorre páginas de 500 registros usando cursor por tribunal, CNJ e identificação da publicação. Não inclui uma página parcial como se fosse o arquivo completo.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Abrir exportação | Exportar Excel / Exportar tribunais | Opções carregando; gerar indisponível | Diálogo com tribunais | Contagem selecionada | Recarregar tribunais | Busca local | `public/tribunal-export-ui.mjs` |
| Selecionar | Checkbox / Selecionar todos / Limpar seleção | Local, imediato | Mesmo diálogo | Contagem e estado nativo | Manter escolhas durante a busca | Checkbox ou botão acionado | `public/tribunal-export-ui.mjs` |
| Gerar arquivo | Gerar Excel | Travar seleção, informar progresso por página | Download e fechamento do diálogo | Aviso global com tribunais e CNJs únicos | Erro inline, preservar escolhas e permitir nova geração | Ação que abriu o diálogo | `public/tribunal-export-ui.mjs` |
| Cancelar | Cancelar / fechar / Escape | AbortSignal interrompe requisições | Carteira com filtros preservados | Sem download parcial | Reabrir normalmente | Ação que abriu o diálogo | `public/tribunal-export-ui.mjs` |

## Async and resilience

Envios concorrentes são bloqueados. Respostas de uma abertura antiga não substituem a abertura atual. A API de leitura aceita o AbortSignal do fluxo. Falhas não fecham o formulário nem limpam as escolhas. Contagens incompatíveis ao final indicam dados alterados e exigem nova geração; não é anunciado sucesso para um arquivo incompleto. A sessão expirada continua usando o tratamento de login do painel.

## Overlays and feedback

Reutilizar `dialog.showModal()` e `close()`: foco modal, fundo inerte e Escape ficam sob o comportamento nativo do navegador. O diálogo tem título e descrição acessíveis. A exportação restaura explicitamente o foco ao botão de origem. Status usa `role=status`; erros usam `role=alert` e recebem foco quando a geração falha. O botão de gerar mantém largura estável e anuncia `aria-busy`.

## Permission and validation

A ação fica oculta para estagiários, e a API verifica o papel antes de consultar dados. O servidor valida os tribunais no escopo do escritório, os filtros e os cursores. Os dados de texto são escapados no HTML e escritos como texto no XLSX; não são fórmulas executáveis. CNJs mantêm zeros iniciais.

## Verification

Executar `npm test`, verificações de sintaxe e testes específicos de API, XLSX e página completa. Os testes usam dados sintéticos e banco em memória. A leitura do pacote XLSX verifica as relações internas, nomes de abas, filtros, cabeçalhos congelados, CNJs e datas. Os testes da página cobrem seleção, busca, filtros, erro, retomada, cancelamento e foco. Uma inspeção em navegador, quando disponível, complementa estes testes; não declarar essa cobertura a partir do DOM simulado.
