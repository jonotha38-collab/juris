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

Se mudar uma variável de ambiente, faça Redeploy. Alterar APP_PASSWORD ou SESSION_SECRET invalida as sessões. As sessões duram 12 horas, usam cookie HttpOnly, Secure em HTTPS e SameSite=Strict. Tentativas de acesso têm limite persistente por IP e global. O código é destinado a **um único escritório** e usa um espaço de dados fixo; não é uma plataforma multiempresa. As contas individuais compartilham o mesmo escritório, com permissões por função e atribuição de tarefas.

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


## Equipe e tarefas por processo (v4)

O acesso atual por APP_PASSWORD continua como **Administrador**. Em **Equipe**, cadastre nome e e-mail do estagiário, gere o convite e copie o link para compartilhar diretamente. Nenhum e-mail é enviado automaticamente. O link vale por 48 horas e permite que a pessoa crie uma senha de 12 a 128 caracteres uma única vez. Os acessos seguintes ficam em **Sou da equipe**, com e-mail e senha individual.

Abra um processo e escolha **Nova tarefa**. Informe título, orientações, responsável, prazo interno e prioridade. Em **Tarefas**, filtre por OAB, tribunal, responsável, status ou atraso. O painel conta tarefas a fazer, em andamento, para revisão e concluídas. A lista de tarefas atualiza a cada minuto enquanto está aberta, sem tokens de IA.

O estagiário vê somente processos com tarefas atribuídas a ele e somente as suas tarefas, incluindo publicações e anotações desses processos. Pode atualizar o status até **Para revisão** e registrar comentários. O administrador atribui responsáveis, altera os campos e conclui ou reabre o trabalho. Coleta, importação, exportação, marcações de leitura, configurações da carteira e gestão de acessos ficam com o administrador. Essas permissões são verificadas pela API.

Cada tarefa mantém histórico de alterações e comentários com autor e data. Edições concorrentes exigem reabrir a versão atual; não sobrescrevem silenciosamente o trabalho de outra pessoa. O prazo é um controle interno definido pelo escritório, sem cálculo automático de prazo processual.

Em Equipe, **Desativar** bloqueia novas requisições das sessões existentes, preservando tarefas e histórico. **Redefinir acesso** invalida a senha e os links anteriores e gera outro convite. O estagiário também pode alterar a própria senha em Configurações; as outras sessões são invalidadas. Senhas individuais são armazenadas com PBKDF2-HMAC-SHA256 e salt aleatório; o banco guarda apenas o hash dos convites.

A migração 0004 é aditiva: cria as tabelas de pessoas, tarefas, eventos e comentários. Ela é aplicada no build da Vercel, preserva a carteira atual e não exige novas variáveis de ambiente. Contas individuais e convites estão habilitados na versão **Vercel**. O painel Sites e o coletor local continuam com seu mecanismo de acesso existente. O backup JSON das publicações e o Excel não incluem pessoas, tarefas nem comentários; esses dados exigem backup do banco.


## Clientes e WhatsApp (v5)

A aba **Clientes** reúne contatos com nome, WhatsApp, e-mail e observações internas. Um cliente pode ter vários processos, e um processo pode ter vários clientes. Cadastre o contato e vincule os processos pela ficha ou pela seção **Clientes deste processo** no histórico. Os nomes dos clientes vinculados aparecem também na lista principal dos processos. A busca dos processos reconhece o nome do cliente cadastrado.

Em **Todos os processos**, consulte todo o acervo capturado da seleção e filtre por **Sem cliente vinculado** para completar o cadastro. Os nomes estruturados da fonte ficam visíveis como referência; nenhum destinatário ou parte contrária é cadastrado automaticamente como cliente. Confirme o nome correto ao criar o vínculo. Os filtros de OAB e tribunal continuam valendo para a carteira.

Em **Avisar clientes**, as publicações capturadas sem envio informado aparecem para cada cliente vinculado. O histórico já existente também aparece até que a equipe registre o envio; preparar uma mensagem não remove a pendência. A fila considera o identificador da publicação, não cria um novo aviso para cada reconciliação do mesmo registro e não substitui a coleta do DJEN.

Use **Compartilhar no WhatsApp** em uma publicação ou **Preparar WhatsApp** na aba Clientes. Confira o destinatário, telefone e texto; gere o link e clique em **Abrir WhatsApp**. A mensagem contém nome do cliente, CNJ, tribunal, data e trecho do teor, com a certidão oficial quando disponível. Publicações canceladas são identificadas no texto. O conteúdo pode ser editado antes de abrir a conversa. Nenhum resumo ou interpretação jurídica é gerado por IA.

Esta integração usa o link oficial **wa.me** com texto preenchido. Você conclui o envio no WhatsApp usando sua própria conta. O site não envia mensagens sozinho, não precisa de token da API da Meta e não confirma entrega ou leitura. Depois de enviar, clique em **Já enviei · registrar envio**. O histórico guarda o texto e o telefone usados, autor, data e eventual confirmação manual. A equipe também pode registrar o envio pela ficha do cliente.

O administrador cadastra, edita, arquiva e vincula contatos. Estagiários acessam somente contatos vinculados aos processos atribuídos a eles, sem as observações gerais privadas do cliente. Podem preparar mensagens das publicações desses processos e informar o envio. A API verifica as permissões, o vínculo e a versão do contato antes de gerar o link.

Para números brasileiros, informe DDD e telefone; o sistema acrescenta 55. Para outros países, use + e o código internacional. O telefone é validado quanto ao formato; a existência de uma conta no WhatsApp é verificada ao abrir a conversa.

A migração **0005** acrescenta clientes, vínculos e registros de mensagens. Preserva publicações, equipe e tarefas e não exige novas variáveis de ambiente. Contatos e mensagens ficam no banco entre deploys. O Excel e o JSON de publicações não contêm esses cadastros nem registros de envio: faça backup do banco para preservá-los.

Referência oficial da integração: https://faq.whatsapp.com/5913398998672934


## Escolher contato no WhatsApp Web (v5.1)

Nas publicações do painel, do histórico e de Avisar clientes, use **Escolher contato no WhatsApp Web**. O Juris carrega a publicação autorizada, monta uma mensagem editável com CNJ, tribunal, data e teor e abre o WhatsApp Web com o texto. Você escolhe o contato na sua conta e clica em Enviar. O atalho funciona mesmo sem cliente ou telefone cadastrado no Juris.

Há também **Copiar mensagem** e um link alternativo oficial do WhatsApp com texto preenchido. A sessão do WhatsApp Web é mantida pelo próprio WhatsApp; entre ou conecte seu aparelho na página dele quando necessário. Nenhuma credencial ou lista de contatos do WhatsApp é acessada pelo Juris.

Como o destinatário é escolhido fora do site, esse atalho não confirma entrega, não cria registro de envio por cliente e não remove pendências da fila. A opção **Usar contato cadastrado** continua disponível para preparar e registrar uma comunicação vinculada a um cliente no Juris.

O backend exige o acesso ao processo para fornecer o texto; estagiários continuam restritos às tarefas atribuídas. A atualização não exige migração nem novas variáveis de ambiente.


## Importação de planilha em JSON (v5.2)

Em **Importar**, selecione o JSON convertido da planilha e informe a OAB/UF à qual deseja vincular o cadastro. O formato aceita uma lista direta com as colunas **Número** (CNJ como texto) e **Título**, preservando os demais campos. Primeiro clique em **Analisar arquivo**, confira novos, existentes e repetições e depois em **Confirmar importação**. Até 1.000 registros e 2 MB por arquivo; o painel envia lotes de 100 e pode repetir os lotes após uma falha.

O CNJ normalizado identifica o processo dentro do escritório. Reimportar o mesmo CNJ atualiza seus campos da planilha e o vínculo com a OAB, preservando publicações oficiais, anotações, favoritos, tarefas e clientes já vinculados. Se houver linhas repetidas no mesmo arquivo, prevalece a primeira. A lista principal agrupa um único processo por CNJ, inclusive quando a fonte usa rótulos diferentes de tribunal.

Os cadastros ficam separados das publicações. A ficha exibe **Dados da planilha**, com todos os campos originais; o último histórico da planilha não conta como publicação oficial, não aumenta o ranking nem cria pendências de WhatsApp. Os processos importados permitem notas, favoritos, tarefas e vínculos com clientes, com as mesmas restrições de acesso dos estagiários. O campo Cliente da planilha não cria um contato automaticamente: confirme a pessoa representada antes de vincular.

Sem tribunal informado, o cadastro usa **Não informado**; se já houver publicações do CNJ, usa o tribunal de uma publicação recente. Nenhum acesso ao SEEU ou aos autos é inferido da importação. A coleta por OAB continua dependendo da cobertura do DJEN.

Em Configurações, **Cadastros importados em JSON** baixa os campos da planilha vinculados à OAB/tribunal selecionados. Excel e Publicações em JSON continuam exportando apenas publicações capturadas. O backup do banco inclui cadastros e vínculos.

A migração aditiva **0006** cria o catálogo e suas relações de OAB, sem alterar publicações existentes ou exigir novas variáveis. Os testes automatizados usam somente registros fictícios, inclusive um lote de 720 processos, sem incluir a planilha real no repositório.


## Busca por OAB e verificação da atividade por processo

As datas da busca são livres, inclusive anteriores a dois anos. O período escolhido localiza publicações vinculadas à OAB. Para cada CNJ encontrado, uma etapa separada verifica a existência de publicação não cancelada nos últimos dois anos, considerando a data atual de São Paulo. O limite de dois anos vale para a atividade do processo, não para as datas disponíveis no formulário.

Por exemplo, uma busca em 2018 pode encontrar um processo que também teve publicação em 2026: ele entra na carteira com seus registros antigos encontrados e a evidência recente. Um processo cuja última publicação é de dois anos ou mais fica fora da inclusão automática. A verificação se refere às publicações do DJEN, sem afirmar cobertura de todos os movimentos do tribunal.

Publicações recentes já conhecidas ou presentes na página consultada dispensam nova consulta de atividade. Quando necessário, a API consulta o mesmo CNJ independentemente da OAB e do período histórico escolhido. Só registros com o CNJ exato são aceitos; publicações canceladas, futuras ou sem data válida não comprovam atividade. Uma consulta negativa pode ser reutilizada no mesmo dia, mas uma nova evidência de atividade sempre prevalece.

Cada página descoberta fica em uma fila interna e é verificada de forma retomável. Registros pendentes não aparecem como processos nem publicações no painel. A verificação faz no máximo uma página de consulta por CNJ em cada etapa. Falhas, HTTP 429 e interrupções preservam a fila; nenhuma falha é interpretada como ausência de atividade. A paginação da descoberta avança somente depois que todos os candidatos da página foram decididos, usando a quantidade original de registros da fonte.

Casos elegíveis mantêm o histórico anterior capturado. Registros previamente salvos e tarefas manuais são preservados; o catálogo importado explicitamente por planilha continua separado da coleta automática. Datas antigas seguem disponíveis para futuras buscas.

A migração aditiva 0008 cria a fila de candidatos, o checkpoint da página e o cache diário de verificações negativas. Não exige novas variáveis de ambiente. A 0007 continua fornecendo o índice de atividade por CNJ. As consultas não usam tokens de IA.


## Pendências por processo

A aba **Pendências** organiza as tarefas existentes por CNJ. Cada cartão mostra o cliente vinculado (ou o nome informado pela fonte), tribunal, OABs, progresso e até quatro itens do filtro, com acesso à lista completa. As tarefas anteriores continuam disponíveis na aba Tarefas e no mesmo histórico; não existe uma segunda base de pendências.

O resumo destaca itens em aberto, atrasados, com vencimento hoje, para revisão, sem responsável e sem data. Há filtros por pessoa, prioridade, cliente, CNJ, texto, hoje, próximos sete dias e concluídas. A ordenação padrão prioriza atrasos, hoje e a semana antes dos itens sem prazo. Os próximos sete dias incluem hoje. Os totais respeitam o acesso da pessoa e a seleção de OAB, tribunal, busca, responsável e prioridade; os atalhos de status/data selecionam os cartões dentro desse resumo.

Na lista de Processos, o indicador mostra as pendências e os atrasos de cada processo. Abra o indicador para ir diretamente à seção **O que falta tratar**, posicionada no início da ficha. Ela mostra itens em aberto por padrão e permite consultar também as concluídas. O administrador cria e atribui pendências. Estagiários veem somente seus itens, atualizam até Para revisão e comentam. A conclusão permanece com o administrador, com controle de versão e histórico das alterações.

As ações **Iniciar**, **Enviar para revisão**, **Concluir** e **Reabrir** usam as mesmas regras da API de tarefas. Uma alteração concorrente exige carregar a versão atual. A tela atualiza a cada minuto enquanto está aberta. O painel não envia notificações fora do site e não substitui a conferência dos prazos pela equipe.

Abrir a ficha do processo não marca todas as publicações como lidas. Em cada publicação, **Marcar como lida** registra a leitura explicitamente; isso não conclui pendências. **Criar pendência** abre um cadastro com CNJ, data e teor da publicação como referência. A pessoa informa responsável e prazo após conferir a fonte, sem cálculo automático de prazo judicial. A opção de leitura em lote da seleção continua disponível para o administrador como ação explícita.

A coleta do DJEN não comprova cobertura de todas as movimentações do tribunal. Dados ausentes, falhas de coleta e prazos não cadastrados impedem qualquer garantia de ausência de perdas. O painel torna visíveis as lacunas de cadastro, sem inventar obrigações ou datas a partir do texto de uma publicação. A migração aditiva 0009 acrescenta índices de tarefas e preserva os dados.

## Identificação e conferência de prazos

A aba **Conferir prazos** recebe todas as publicações reais já salvas e as novas publicações recebidas pelo Juris, inclusive as antigas e as já marcadas como lidas. Cadastros de processos importados por planilha não se transformam em publicações fictícias. A fila não depende do filtro de atividade dos últimos dois anos da descoberta por OAB. O filtro de OAB usa os vínculos de cada publicação e não duplica a conferência quando a mesma publicação pertence a mais de uma carteira.

A identificação é determinística e não consome tokens de IA: destaca períodos explícitos em algarismos ou por extenso, quantidade e unidade, indicação de dias úteis/corridos e algumas datas explícitas acompanhadas de expressões como “até o dia”. Não determina a obrigação jurídica, o destinatário correto, nem a incidência de uma regra processual. Número divergente do valor por extenso é sinalizado. “Prazo legal”, datas incompletas e texto sem período reconhecido continuam aguardando leitura; ausência de indicação reconhecida nunca equivale a ausência de prazo. Há até 12 indicações por conferência, com aviso para leitura integral e cadastro manual dos demais itens quando houver mais.

O fluxo é **publicação → indicações encontradas → conferência → tarefa com vencimento e responsável**. Abra **Conferir publicação**, leia o teor integral e a certidão oficial, defina o responsável e confirme cada vencimento. Pode acrescentar providências não reconhecidas. Indicações não utilizadas exigem justificativa. **Registrar sem novo prazo** exige leitura confirmada e motivo, ficando no histórico como decisão do administrador. A conferência pode ser reaberta. Não existe descarte automático por leitura ou por falta de palavras reconhecidas.

Para períodos inequívocos em dias, a simulação exige o termo inicial explicitamente informado (excluído da contagem) e a escolha de dias úteis ou corridos, sem presumir que a disponibilização seja publicação, intimação, ciência ou início. A quantidade indicada no texto é preservada; exceções exigem data manual conferida. Datas sem expediente são excluídas nos dias úteis e só prorrogam o fim nos corridos se essa opção for marcada. Datas de suspensão são excluídas em ambos os modos. A suspensão de 20/12 a 20/01 e a prorrogação do vencimento são opções explícitas, desmarcadas por padrão. O escritório informa o calendário e decide se as opções se aplicam ao caso.

Não há sincronização automática com calendários de feriados, suspensões de tribunais ou indisponibilidades. A simulação não implementa automaticamente as regras de citação, ciência eletrônica, intimação pessoal, prazos em dobro, suspensões penais e outras exceções. O SEEU não recebe uma regra civil presumida. Períodos em horas, meses ou anos e quantidades contraditórias exigem conferência manual da data; períodos em horas exigem também o horário de Brasília. O horário fica nas orientações e no registro de origem, enquanto os indicadores de vencimento das tarefas continuam por data, sem alarme por hora.

A confirmação exige usuário administrador, leitura verificada, responsável ativo e data válida. Cria tarefas de alta prioridade nas pendências do CNJ e grava, na mesma transação, trecho, texto de origem, versão da fonte, parâmetros usados, vencimento, autor e instante da revisão. Confirmações repetidas ou concorrentes não duplicam tarefas: a versão da conferência é verificada atomicamente. Estagiários recebem as tarefas atribuídas a eles e podem consultar sua origem; não encerram conferências nem acessam tarefas de outras pessoas.

Correções e cancelamentos da fonte reabrem a fila e incrementam a versão de origem. Os prazos e o histórico anteriores são preservados, com aviso ao abrir a tarefa. A nova revisão exige conferir esses itens; não muda ou apaga datas silenciosamente. Publicação cancelada não pode gerar novos prazos pelo fluxo de confirmação. O resumo da carteira, a aba de conferências e o atalho dentro do processo tornam a revisão pendente visível. A tela aberta é atualizada a cada minuto; a detecção depende da coleta já existente e não é uma integração em tempo real com todos os tribunais.

A migração aditiva **0010_publication_deadline_reviews.sql** cria a fila, os vínculos de origem e o histórico, inclui as publicações existentes e instala gatilhos para novas entradas e alterações. É aplicada pelo build habitual; não exige novas variáveis, serviços de IA ou dependências de produção.

As regras de cada processo devem ser verificadas nas fontes oficiais: [CPC, arts. 219 a 224 e 231](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm), [CPP, arts. 798 e 798-A](https://www.planalto.gov.br/ccivil_03/decreto-lei/del3689.htm) e [orientações do CNJ sobre DJEN e Domicílio Judicial Eletrônico](https://www.cnj.jus.br/cnj-alerta-tribunais-sobre-novas-regras-de-contagem-de-prazos-processuais/). O recurso organiza a conferência e não permite garantir ausência absoluta de perda de prazo.

APIs: `GET /api/deadlines` (filtros de OAB, tribunal, CNJ, texto e status), `GET /api/deadlines/:id` (fonte, indicações, tarefas e histórico), `POST /api/deadlines/:id` (confirmar, registrar sem novo prazo ou reabrir). O histórico de tarefas inclui `deadlineSource` somente após a verificação do acesso à tarefa.

Os testes cobrem extração, ambiguidade, ausência de indicação, datas inválidas, contagem explícita, migração de publicações existentes, leitura independente, múltiplos prazos, responsáveis, escopo por OAB/tribunal, isolamento de escritórios e estagiários, concorrência, correção, cancelamento e o fluxo completo da página com banco em memória.
