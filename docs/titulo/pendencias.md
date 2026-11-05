# Pendências de título e imagem

Itens que o texto já corrigiu e que ainda dependem de um binário ou de uma captura nova. O cartão
social foi regerado; as capturas de tela continuam com o nome anterior na interface. O texto
alternativo e a legenda descrevem o que a imagem deve mostrar; a imagem em si continua com o nome
antigo até ser refeita.

## Infraestrutura e assinatura

- **Azure Trusted Signing:** criar a conta `culturabuilderartifactsign` e o perfil `CULTURABUILDER`
  no East US, com o CN `CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA`. `electron-builder.windows-signing.yml`
  já aponta para esses nomes; enquanto não existirem, o build Windows assinado falha de propósito
  (`forceCodeSigning`). O CN precisa ser o do certificado, senão o auto-update de uma build já
  instalada recusa a atualização.
- **DNS:** `signal.buildersbot.culturabuilder.com`, `turn.buildersbot.culturabuilder.com`,
  `status.buildersbot.culturabuilder.com`, `updates.buildersbot.culturabuilder.com` e
  `*.sites.buildersbot.culturabuilder.com` ainda não resolvem. Até lá o código continua lendo os
  hosts `*.buildersbot.culturabuilder.com` e `*.sites.buildersbot.culturabuilder.com`.
- **Publicação:** feita em 02/11/2026: um commit, `origin` único, `v1.0.0` assinada, release publicada
  e `main` protegida. O build de release ainda depende dos dois itens acima.

## Imagens a regerar

Todas mostram `BuildersBot` ou `Meet BuildersBot` na interface. Regenere com uma build atual e mantenha o
mesmo enquadramento, para que a legenda continue verdadeira.

| Caminho | O que mostra hoje com o nome antigo |
| --- | --- |
| `apps/auth-api/src/content/guides/media/buildersbot-101/a-thread.webp` | Título da janela "BuildersBot Local Dev Host" e a menção "BuildersBot documentation" na resposta. |
| `apps/auth-api/src/content/guides/media/buildersbot-101/a-channel.webp` | Título da janela e "BuildersBot 1.0" na mensagem da conversa. |
| `apps/auth-api/src/content/guides/media/buildersbot-101/a-routine.webp` | Título da janela e o painel lateral do routine. |
| `apps/auth-api/src/content/guides/media/buildersbot-101/pick-a-model.webp` | Título da janela no seletor de modelo. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/marketplace.png` | Cada listagem aparece "by BuildersBot". |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/marketplace-menu.png` | Menu do Marketplace sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/agent-detail.png` | Listagem de agente com o crédito antigo. |
| `apps/auth-api/src/content/guides/media/buildersbot-marketplace/github-plugin.png` | Listagem de plugin com o crédito antigo. |
| `apps/auth-api/src/content/guides/media/buildersbot-hosted-servers/pricing.png` | Rodapé "We can run BuildersBot on a dedicated Mac mini". |
| `apps/auth-api/src/content/guides/media/import-grok-bot-agents/import-source.png` | Tela de importação sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-grok-bot-agents/add-migrator.png` | Agente "Migrator by BuildersBot" no Grok Bot. |
| `apps/auth-api/src/content/guides/media/import-grok-bot-agents/export-instructions.png` | Instruções de exportação com o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/import-source.png` | "BuildersBot copies them to this computer" e "Another BuildersBot computer". |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/read-folder.png` | Controles de importação sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/install-command.png` | Comando de instalação da skill com o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/manual-setup.png` | Passo manual sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/review-profiles.png` | Revisão de perfis sob o nome antigo. |
| `apps/auth-api/src/content/guides/media/import-hermes-agents/import-finished.png` | Confirmação final sob o nome antigo. |

## Como regerar

1. Capture na build atual, com o mesmo tema, tamanho e enquadramento do arquivo original.
2. Grave no mesmo caminho, com o mesmo nome e formato. Os guias importam os arquivos, então um nome
   novo exige mudança de `import` no TSX correspondente.
3. Confira o texto alternativo e a legenda do bloco: eles não devem citar o nome antigo.
4. Ao terminar, remova a linha desta tabela.
