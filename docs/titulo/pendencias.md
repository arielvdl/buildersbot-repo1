# Pendências de título e imagem

Itens que o texto já corrigiu e que ainda dependem de um binário ou de uma captura nova. O cartão
social foi regerado; as capturas de tela ainda não refletem a marca atual. O texto
alternativo e a legenda descrevem o que a imagem deve mostrar; a imagem em si é atualizada
quando refeita.

## Upgrade por cima de uma instalação antiga

A decisão é que nada do nome anterior fique no código, nem como compatibilidade. O custo está
abaixo e é consciente.

- **Perfil:** a pasta de perfil é a do nome atual, então um upgrade abre um perfil novo e vazio. O
  dado antigo continua em disco, intocado, mas não é lido. Copiar a pasta de volta é um arquivo só e
  custa voltar a citar o nome antigo.
- **Segredos:** o item de Keychain do `safeStorage` tem o nome do aplicativo, então mesmo copiando a
  pasta os arquivos cifrados não abrem. O leitor trata valor ilegível como ausente: o usuário entra
  de novo e re-digita as chaves de provedor.
- **Deep link:** só `buildersbot://` está registrado. Um convite antigo não abre a build nova.
- **Instalação anterior no macOS:** o `preinstall` não apaga mais a pasta, o comando e o LaunchAgent
  do nome antigo, porque apagá-los custa escrever o nome. Quem atualiza fica com os três em disco; o
  agente só age quando o app antigo é aberto, então na prática é lixo parado. Limpar é um `rm` de três
  linhas no fim do mesmo script, e o nome volta a aparecer nele.
- **Site publicado:** só `<slug>.culturabuilder.com` resolve. Site antigo precisa de 301.
- **`appId`:** mudou junto com o nome, então o macOS e o Windows tratam a build nova como outro
  aplicativo. Como `publish` é nulo (não há feed), o custo fica restrito ao re-login acima.

## Repositório e contas

- **Conta do GitHub:** o repositório vive em `nextlevelcommunity`, que é uma **conta de usuário**
  chamada "Cultura Builder Community", não uma organização. Toda URL de código, release, issue e
  pacote carrega esse nome. Mover para uma organização com o nome da empresa é a única forma de
  tirá-lo, e depende de o dono criar a organização e transferir o repositório.
- **CODEOWNERS:** aponta para a conta que revisa hoje. Um handle que não existe quebra a exigência
  de revisão do ruleset, então a troca precisa ser feita junto com a criação do handle da empresa.
- **Registry da imagem:** `ghcr.io/nextlevelcommunity/buildersbot` acompanha a conta, então também
  muda se o repositório mudar.
- **Versões herdadas:** `release-announcement.json` e `nix/sources.json` estavam em `0.56.0` com o
  pacote em `1.0.0`, e o `release.yml` compara os dois — a release falharia. Corrigido para `1.0.0`.

## Infraestrutura e assinatura

- **Azure Trusted Signing:** criar a conta `culturabuilderartifactsign` e o perfil `CULTURABUILDER`
  no East US, com o CN `CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA`. `electron-builder.windows-signing.yml`
  já aponta para esses nomes; enquanto não existirem, o build Windows assinado falha de propósito
  (`forceCodeSigning`). O CN precisa ser o do certificado, senão o auto-update de uma build já
  instalada recusa a atualização.
- **DNS:** criado em 03/11/2026, sem ACM. O certificado grátis cobre um nível
  (`culturabuilder.com`, `*.culturabuilder.com`), então só os nomes de dois níveis continuam
  existindo, e esses são DNS-only com certificado no próprio servidor:

  | Nome | Tipo | Destino | Proxy |
  | --- | --- | --- | --- |
  | `signal.buildersbot` | A | `95.216.243.233` | DNS only |
  | `turn.buildersbot` | A | `95.216.243.233` | DNS only |
  | `bb-status` | CNAME | `nextlevelcommunity.github.io` | proxied |
  | `bb-updates` | CNAME | `buildersbot` | proxied |
  | `bb-discord` | CNAME | `buildersbot` | proxied |
  | `*` | CNAME | `buildersbot` | proxied |

  O analytics não ganhou host próprio: o serviço de conta fala direto com a API do OpenPanel.

  O `*` serve os sites publicados (`<slug>.culturabuilder.com`) e foi reaproveitado do antigo
  CloudFront, que respondia 403 em todo nome sem registro. Como os sites agora dividem
  `culturabuilder.com` com o app, um site pode gravar cookie em `.culturabuilder.com`: por isso
  `SITE_COOKIE_ISOLATION_READY` continua `true`, mas a isolação é menor que a de antes.
- **Token do deploy:** API token `buildersbot-ci` criado em 03/11/2026 com `DNS: Edit`,
  `Zone: Read`, `SSL and Certificates: Write`, `Workers Scripts: Edit`, `Workers Routes: Edit`,
  `D1: Edit`, `R2: Edit` e `Billing: Write` na conta, restrito à zona `culturabuilder.com`. Está no
  secret `CLOUDFLARE_PRODUCTION_DEPLOY_TOKEN`. A variable `CLOUDFLARE_ACCOUNT_ID` também existe.
- **Deploy do Worker:** feito pelo job `Deploy Cloudflare production` do CI a cada push na `main`.
  Manual: `cd apps/auth-api && bun run build && CLOUDFLARE_API_TOKEN=... ../../node_modules/.bin/wrangler deploy --config dist/server/wrangler.json --keep-vars`.
  `--keep-vars` preserva os secrets já gravados no Worker.
- **Publicação:** feita em 02/11/2026: um commit, `origin` único, `v1.0.0` assinada, release publicada
  e `main` protegida. O build de release ainda depende dos dois itens acima.
- **Release do runtime de desktop remoto:** publicado em 02/11/2026 neste repositório, com os
  patches `*-buildersbot.patch`. O `native-runtime.lock.json` já aponta para cá e o app instalado
  usa esse runtime.

## Imagens a regerar

Todas mostram texto desatualizado na interface. Regenere com uma build atual e mantenha o
mesmo enquadramento, para que a legenda continue verdadeira.

| Caminho | O que mostra hoje com o nome antigo |
| --- | --- |
| `apps/auth-api/src/content/guides/media/buildersbot-101/a-thread.webp` | Título da janela com a marca no nome da dev host, e a menção à documentação na resposta. |
| `apps/auth-api/src/content/guides/media/buildersbot-101/a-channel.webp` | Título da janela e o número de versão na mensagem da conversa. |
| `apps/auth-api/src/content/guides/media/buildersbot-101/a-routine.webp` | Título da janela e o painel lateral do routine. |
| `apps/auth-api/src/content/guides/media/buildersbot-101/pick-a-model.webp` | Título da janela no seletor de modelo. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/marketplace.png` | Cada listagem aparece com crédito de autoria desatualizado. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/marketplace-menu.png` | Menu do Marketplace sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/agent-detail.png` | Listagem de agente com o crédito antigo. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/github-plugin.png` | Listagem de plugin com o crédito antigo. |
| `apps/auth-api/src/content/guides/media/buildersbot-hosted-servers/pricing.png` | Rodapé sobre execução dedicada num Mac mini. |
| `apps/auth-api/src/content/guides/media/import-grok-bot-agents/import-source.png` | Tela de importação sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-grok-bot-agents/add-migrator.png` | Agente "Migrator" no Grok Bot, com crédito de autoria desatualizado. |
| `apps/auth-api/src/content/guides/media/import-grok-bot-agents/export-instructions.png` | Instruções de exportação com o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/import-source.png` | Frases da confirmação de importação desatualizadas. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/read-folder.png` | Controles de importação sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/install-command.png` | Comando de instalação da skill com o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/manual-setup.png` | Passo manual sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/review-profiles.png` | Revisão de perfis sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/import-finished.png` | Confirmação final sob o nome antigo. |

## Como regerar

1. Capture na build atual, com o mesmo tema, tamanho e enquadramento do arquivo original.
2. Grave no mesmo caminho, com o mesmo nome e formato. Os guias importam os arquivos, então um nome
   novo exige mudança de `import` no TSX correspondente.
3. Confira o texto alternativo e a legenda do bloco: eles devem citar apenas a marca atual.
4. Ao terminar, remova a linha desta tabela.

## Firebase do mobile

- **Projeto Firebase:** o `google-services.json` usa o placeholder `buildersbot-9f2c1` no lugar do
  projeto anterior. Criar o projeto novo no console do Firebase com o pacote
  `run.buildersbot.mobile`, baixar o `google-services.json` real e conferir o `storage_bucket`;
  while the project does not exist, the Android build with push and crashlytics fails.
