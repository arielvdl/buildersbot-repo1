# Pendências de título e imagem

Itens que o texto já corrigiu e que ainda dependem de um binário ou de uma captura nova. O cartão
social foi regerado; as capturas de tela ainda não refletem a marca atual. O texto
alternativo e a legenda descrevem o que a imagem deve mostrar; a imagem em si é atualizada
quando refeita.

## Infraestrutura e assinatura

- **Azure Trusted Signing:** criar a conta `culturabuilderartifactsign` e o perfil `CULTURABUILDER`
  no East US, com o CN `CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA`. `electron-builder.windows-signing.yml`
  já aponta para esses nomes; enquanto não existirem, o build Windows assinado falha de propósito
  (`forceCodeSigning`). O CN precisa ser o do certificado, senão o auto-update de uma build já
  instalada recusa a atualização.
- **DNS:** os registros abaixo ainda não existem. Até criá-los, o acesso remoto e os sites
  publicados não resolvem. Criar na zona `culturabuilder.com`:

  | Nome | Tipo | Destino | Proxy |
  | --- | --- | --- | --- |
  | `signal.buildersbot` | CNAME | `signal.bb-aws.culturabuilder.com` | DNS only |
  | `turn.buildersbot` | CNAME | `turn.bb-aws.culturabuilder.com` | DNS only |
  | `api.buildersbot` | CNAME | `buildersbot.culturabuilder.com` | proxied |
  | `status.buildersbot` | CNAME | `nextlevelcommunity.github.io` | proxied |
  | `analytics.buildersbot` | CNAME | `analytics.openbot.run` | DNS only |
  | `discord.buildersbot` | CNAME | `buildersbot.culturabuilder.com` | proxied |
  | `updates.buildersbot` | CNAME | `buildersbot.culturabuilder.com` | proxied |
  | `*.sites.buildersbot` | CNAME | `buildersbot.culturabuilder.com` | proxied |

  O token OAuth do wrangler não tem `dns_records:edit`; usar um API token com `Zone.DNS: Edit`.
- **Deploy do Worker:** `cd apps/auth-api && bun run build && ../../node_modules/.bin/wrangler deploy --config dist/server/wrangler.json --keep-vars`.
  A sessão OAuth do wrangler serve; os secrets já estão no Worker e `--keep-vars` os preserva. A
  chave `.env.keys` do dotenvx só é necessária para trocar um secret.
- **Publicação:** feita em 02/11/2026: um commit, `origin` único, `v1.0.0` assinada, release publicada
  e `main` protegida. O build de release ainda depende dos dois itens acima.
- **Release do runtime de desktop remoto:** o `native-runtime.lock.json` ainda aponta para
  `nightly-labs/openbot`, onde os artefatos e os patches `*-openbot.patch` estão publicados.
  Republicar o runtime aqui com os nomes novos exige um build do Sunshine que hoje falha no macOS
  por incompatibilidade de OpenSSL (`ASN1_BIT_STRING` opaco). Até lá, `verify` aceita os dois nomes
  de source e o build usa o runtime publicado lá.

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
  projeto antigo (`openbot-a3328`). Criar o projeto novo no console do Firebase com o pacote
  `run.buildersbot.mobile`, baixar o `google-services.json` real e conferir o `storage_bucket`;
  while the project does not exist, the Android build with push and crashlytics fails.
