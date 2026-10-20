# Juris · Implantação na Vercel

Pacote completo e independente do site de demonstração: frontend estático, backend Node.js, banco remoto Turso/libSQL, autenticação por senha e coleta diária. Inclui ranking de atividade no DJEN, favoritos, anotações e Excel.

## Publicar, passo a passo

1. Crie um banco **libSQL** no [Turso](https://turso.tech/) e obtenha sua URL e token com permissão de escrita. O adaptador usa @libsql/client; não selecione um banco incompatível com libSQL.
2. Extraia este ZIP e envie **todo o conteúdo**, incluindo api/, core/, lib/, public/, migrations/, scripts/, package.json e vercel.json, para um repositório Git privado no GitHub.
3. Na [Vercel](https://vercel.com/new), escolha Add New → Project e importe o repositório. Framework Preset: **Other**. Root Directory: pasta com este package.json. O vercel.json já define Build Command e Output Directory.
4. Antes de clicar em Deploy, adicione as cinco variáveis abaixo em Environment Variables. Habilite-as no ambiente Production. Para Preview, use um banco e segredos separados ou deixe Preview desativado.
5. Clique em Deploy. O build aplica as migrações no Turso e gera o frontend. Se faltar uma variável, ele para com uma mensagem; preencha a variável e faça Redeploy.
6. Abra o domínio publicado e entre usando APP_PASSWORD. Cadastre sua OAB e valide uma busca real de poucos dias. O pacote não contém dados fictícios.
7. Confira Vercel → Settings → Functions: região São Paulo (gru1), Node.js 24 e Fluid Compute. Em Settings → Cron Jobs, confirme a coleta agendada. A publicação real na sua conta e o acesso ao DJEN precisam ser validados após estes passos.

| Variável | Conteúdo |
|---|---|
| TURSO_DATABASE_URL | URL libsql://... fornecida pelo Turso |
| TURSO_AUTH_TOKEN | Token de escrita do banco |
| APP_PASSWORD | Senha forte e exclusiva do escritório, com no mínimo 16 caracteres |
| SESSION_SECRET | Valor aleatório de pelo menos 32 caracteres para assinar as sessões |
| CRON_SECRET | Outro valor aleatório, de pelo menos 32 caracteres, para proteger a coleta |

Para gerar um segredo, execute no seu computador `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Execute duas vezes, usando valores diferentes para SESSION_SECRET e CRON_SECRET. Nunca coloque os segredos no GitHub ou em código do navegador; não use prefixo NEXT_PUBLIC_. Não reutilize os exemplos como senhas reais.

Se mudar uma variável de ambiente, faça Redeploy. Alterar APP_PASSWORD ou SESSION_SECRET invalida as sessões. As sessões duram 12 horas, usam cookie HttpOnly, Secure em HTTPS e SameSite=Strict. Tentativas de acesso têm limite persistente por IP e global. O código é destinado a **um único escritório** e usa um espaço de dados fixo; não é uma plataforma multiempresa com contas individuais.

## Coleta e limites

A função está configurada em São Paulo (gru1). O ambiente de desenvolvimento recebeu HTTP 403 por bloqueio geográfico do DJEN. A região brasileira não garante autorização: o provedor ainda pode bloquear IPs de hospedagem. A integração de produção precisa ser verificada com sua OAB. O código respeita HTTP 429 e não tenta contornar bloqueios.

O cron em vercel.json executa diariamente às 11h UTC (aproximadamente 8h em São Paulo). No plano Hobby, a Vercel limita cada cron a uma execução diária e não garante o minuto exato. A função tem maxDuration de 300 segundos; cada lote usa um orçamento de até 240 segundos antes de iniciar uma próxima etapa. Há um limite operacional de 100 etapas por lote, não um limite comercial de processos. O ponto de paginação fica no banco para a próxima execução ou retomada no painel.

Para uma carteira grande, a execução diária pode não terminar todo o histórico. O painel mostra o progresso. Use a versão local contínua ou, em um plano que permita, ajuste o cron para uma frequência maior. Não basta usar setInterval em uma função da Vercel: o agendamento está implementado pelo cron da plataforma. O navegador também pode conduzir buscas abertas.

A descoberta e o ranking são baseados nas **publicações capturadas do DJEN**, não no acervo completo da OAB nem em todas as movimentações do tribunal. Publicações canceladas não entram no ranking. A comparação usa o período anterior de igual duração. Ausência de registros não prova ausência de atividade processual. Sem sigilo, acesso aos autos completos, Domicílio Judicial Eletrônico, cálculo de prazo ou IA.

## Persistência e exportação

Todos os registros, favoritos e anotações ficam no banco Turso, preservados entre deploys. Não há gravação persistente no disco da função. O cron e o acesso autenticado usam o mesmo espaço de dados office. Utilize um banco próprio para esta implantação; não compartilhe com outra aplicação.

Para migrar as publicações da versão anterior, exporte o JSON antigo e use Importar publicações no novo site, informando OAB e UF. O Excel reúne os processos e o histórico. O JSON contém publicações originais; favoritos e anotações exigem backup do banco pelo provedor. Não publique dados pessoais, anotações ou o banco em um repositório aberto.

Os custos e quotas dos planos da Vercel, Turso e fonte oficial continuam aplicáveis. A coleta não usa tokens de IA e o código não cobra por movimentação.

## Banco e desenvolvimento

As migrações SQL são aplicadas em transações durante `npm run build`, com controle da versão no banco. Não altere migrações já aplicadas. Para executar manualmente, copie .env.example para .env.local, preencha seus valores e execute `npm ci` seguido de `npm run db:migrate`. Para testar o ambiente completo na sua máquina, use a CLI oficial Vercel (`vercel dev`) com as variáveis do projeto. Não envie .env.local ao GitHub.

O adaptador D1/libSQL está em lib/database.mjs; o domínio compartilhado em core/engine.mjs; a função em api/index.mjs. O frontend fica em public/. As rotas /api/* são encaminhadas para uma única função e não dependem de Cloudflare, ChatGPT ou conta do Astrea.

## Referências oficiais consultadas

- https://vercel.com/docs/functions/runtimes/node-js
- https://vercel.com/docs/functions/configuring-functions/region
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- https://docs.turso.tech/sdk/ts/reference


## Organização por OAB e tribunal (v3)

O seletor no topo aplica a OAB à visão geral, aos processos, publicações, ranking, leitura em lote e exportação. A tela Por tribunal agrupa a carteira da OAB escolhida; clique em um cartão para abrir seus processos. Cada registro exibe as OABs vinculadas à captura. Um processo ou publicação pode estar associado a mais de uma inscrição sem duplicar o total geral. No filtro de uma OAB, os totais e o histórico mostram somente as publicações vinculadas àquela captura.

Em Minhas OABs, use nomes personalizados para identificar as carteiras. Em cada histórico, escolha o acompanhamento interno (em acompanhamento, aguardando retorno ou arquivado no escritório). Essa marcação não altera nem substitui a situação oficial no tribunal. Favoritos, notas e acompanhamento são do processo no escritório, compartilhados entre as OABs que acompanham o mesmo CNJ.

Excel da seleção exporta os filtros atuais, com a coluna OABs vinculadas à captura, e organiza os processos por tribunal. Remova os filtros para exportar a carteira completa. As rotas de exportação usam páginas de até 500 registros; o frontend percorre todas as páginas automaticamente. A importação continua aceitando até 1.000 publicações e 2 MB por lote, vinculando-as à OAB explicitamente informada.

A migração 0003 é aditiva: acrescenta o nome opcional da OAB, o acompanhamento padrão e um índice de consulta. Não recria o banco, não altera credenciais e preserva publicações, favoritos e anotações. Na Vercel, ela é aplicada no build, como nas versões anteriores. Use as mesmas variáveis de ambiente e o mesmo banco da implantação atual.

Atalhos: Ctrl+K/⌘K abre a busca. Você pode escolher a densidade da lista e 20 ou 50 registros por página. A seleção de OAB e tribunal fica no endereço para permitir favoritos do navegador. Marcar seleção como lida respeita os filtros e não altera publicações fora da seleção.
