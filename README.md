# Juris — frontend e backend locais

Requisito: Node.js 24 LTS ou superior. Sem npm install e sem chave de IA.

1. Extraia esta pasta em seu computador.
2. Abra um terminal nessa pasta e execute `node server.mjs`.
3. Abra http://127.0.0.1:8787.
4. Use “Buscar por OAB”, informe número, UF e período.
5. Mantenha o terminal e o computador ligados para a coleta autônoma.

O servidor processa as páginas em segundo plano, mesmo com o navegador fechado. Cada monitor habilitado inicia uma nova consulta a cada seis horas, revendo os últimos sete dias. No primeiro cadastro você escolhe o intervalo histórico. A consulta é dividida em janelas de sete dias e páginas de 100 itens; não há teto comercial de processos. As restrições e quotas da fonte continuam aplicáveis. Um erro conserva o cursor e os dados; use “Retomar”. HTTP 429 respeita a espera indicada pela fonte, com mínimo de um minuto. Um monitor com erro precisa de retomada manual para evitar tentativas repetidas indevidas.

## Cobertura e validação

A API pública do DJEN é consultada com numeroOab, ufOab, dataDisponibilizacaoInicio, dataDisponibilizacaoFim, pagina e itensPorPagina. Fonte: https://comunicaapi.pje.jus.br/api/v1/comunicacao. Documentação oficial: https://hcomunicaapi.cnj.jus.br/swagger/index.html.

A execução no ambiente de desenvolvimento recebeu HTTP 403 com mensagem de bloqueio geográfico. Portanto a coleta real de produção NÃO pôde ser validada aqui. Execute em uma conexão permitida no Brasil e valide sua inscrição. Não há mecanismo de contorno de bloqueios. Se a API alterar o contrato, atualize core/engine.mjs. A captura está coberta por testes com respostas simuladas, explicitamente identificadas.

A descoberta pela OAB é baseada nas publicações do DJEN. Não descobre necessariamente todos os processos do advogado e não captura todas as movimentações do tribunal. Não inclui autos/documentos completos, processos sigilosos nem o Domicílio Judicial Eletrônico. Não calcula prazos. Não substitui a conferência nas fontes oficiais. Não existe integração paga escondida. Não há IA ou cobrança por tokens.

## Dados e backup

SQLite em data/juris.sqlite, persistente entre reinicializações. Pare o servidor antes de copiar toda a pasta data para backup consistente. O histórico é deduplicado por identificação oficial; alterações e cancelamentos presentes na resposta atualizam os registros. A releitura de sete dias não detecta alterações de registros antigos fora dessa janela; execute uma busca histórica para reconciliar outro período.

A exportação JSON mantém as publicações originais. A importação aceita até 1.000 itens e 2 MB por lote; indique a OAB de origem. Não inclua banco, credenciais ou dados reais em repositórios públicos.

## Implantação

Por padrão o servidor aceita conexões somente no próprio computador. Para um VPS no Brasil, configure HOST, PORT e ACCESS_TOKEN como variáveis de ambiente, coloque o servidor atrás de um proxy HTTPS autenticado e faça o proxy acrescentar o cabeçalho `Authorization: Bearer ...` sem expor o token ao navegador. O servidor rejeita HOST não local sem ACCESS_TOKEN. O agendador local deve ter uma única instância por banco; evite múltiplos processos usando o mesmo arquivo. Use um gerenciador de serviços para reiniciar o processo após reboot.

## API

GET /api/state?view=processes|publications&page=1&q=&tribunal=&unread=1
POST /api/search {oab,uf,start,end}
POST /api/jobs/:id/step {}
POST /api/jobs/:id/resume {}
PATCH /api/monitors/:id {enabled:true}
GET /api/process/:cnj?offset=0
POST /api/read {cnj} ou {id}
GET /api/export?offset=0 (lotes de 1.000)
POST /api/import {oab,uf,start,end,items:[...]}

O frontend e o servidor local compartilham a mesma API da versão hospedada. No painel hospedado, buscas são conduzidas pela aba aberta; não há cron hospedado configurado. Na versão local, o agendador está no backend e não utiliza o navegador nem tokens.

## Excel e nomes das partes

O botão “Exportar Excel” gera um arquivo .xlsx com abas Processos (um registro por CNJ) e Publicações (histórico completo), cabeçalhos fixos, filtros, faixas alternadas e datas do Excel. O export inclui todo o histórico salvo, independentemente do filtro atual. A primeira coluna contém o nome das partes; polos ativo e passivo ficam em colunas separadas. O número CNJ é texto, preservando zeros iniciais. O Excel limita o teor a 32.767 caracteres por célula; o backup JSON preserva o texto original completo.

O título das listas e do histórico usa nomes estruturados de destinatarios da resposta do DJEN. Nomes de advogados não são usados como nomes das partes. Se a fonte não informar os nomes, a interface mostra “Nome não informado pela fonte”, sem inferência por IA. Os dados já salvos recebem os nomes na leitura, sem nova coleta.
