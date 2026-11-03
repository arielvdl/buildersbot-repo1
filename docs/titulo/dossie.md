# Dossiê de Titularidade — Registro de Exportação

Produto: **Builders Bot**
Titular: **CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA** (CNPJ 62.995.760/0001-33),
Presidente Prudente – SP, Brasil.

## 1. Commit de origem da exportação

O repositório `github.com/nextlevelcommunity/buildersbot` foi constituído a
partir da exportação do estado de desenvolvimento consolidado registrado no commit:

- **Commit de origem:** `7a11fb3dab90ad9e0b6f39d21e75aaf9ec62577f`

Todo o histórico anterior a esse ponto compõe o acervo transferido, sendo
alcançado pela cláusula retroativa do CLA v2 ([CLA.md](../../CLA.md)) e pelos
instrumentos de cessão listados na seção 4.

## 2. Data

- **Data da exportação / constituição do repositório:** 02/11/2026.

## 3. Escopo de arquivos da exportação

A exportação compreende o código-fonte e os ativos integrais do produto, em
particular:

- Aplicativo desktop (processo principal, preload e renderer, Electron);
- Pacotes de workspace (`packages/*`: brand, contracts, i18n, logging,
  team-client, telemetry, ui, user-errors);
- Aplicativos complementares (`apps/*`: auth-api, chrome-extension, mobile,
  site-router, status; além dos espaços somente de documentação discord-app,
  slack-app e telegram-app);
- API e infraestrutura de servidor remoto (`remote/api`);
- Infraestrutura de build, empacotamento e distribuição (`docker/`, `nix/`,
  `flake.nix`, `electron-builder.yml`, configurações de assinatura, Fastlane);
- Documentação, recursos estáticos, scripts operacionais e metadados
  associados.

O inventário completo e verificável dos SHAs acompanha o [anexo técnico](anexo-shas.md), com o
hash da lista, tendo como commit-base o listado na seção 1.

## 4. Publicação

- **Commit de publicação:** o commit apontado pela tag `v1.0.0`, sem ancestral em comum com os repositórios antecessores.
- **Tag:** `v1.0.0`, assinada com a chave GPG `BAD0392AD4E7BFF2` (Cultura Builder <dev@culturabuilder.com>).
- **Release:** `https://github.com/nextlevelcommunity/buildersbot/releases/tag/v1.0.0`.
- **Remote único:** `origin` = `https://github.com/nextlevelcommunity/buildersbot.git`.
- **Espelho arqueológico:** espelho integral do acervo antecessor, guardado fora do disco de trabalho.

## 5. Pendências contratuais em acompanhamento

As seguintes questões contratuais permanecem em fase de formalização e devem ser
acompanhadas até conclusão:

1. **Instrumento de cessão com a titular anterior** — formalização (ou confirmação
   documental) da cessão integral dos direitos patrimoniais relativos ao produto
   e ao histórico de desenvolvimento anterior, em favor da Cultura Builder;
2. **Cláusula de residuals (resíduos)** — pactuação expressa do direito de a
   Cultura Builder utilizar conhecimentos gerais, técnicas e resíduos
   desenvolvidos durante o projeto, sem restrições de licença de terceiros;
3. **CLA retroativo** — consolidação das assinaturas do CLA v2 com efeito
   retroativo junto aos contribuintes de commits anteriores à criação do
   repositório `nextlevelcommunity/buildersbot`, cobrindo inclusive
   contribuições vertidas nos repositórios antecessores e no ciclo anterior do
   projeto.

Enquanto não concluídas, estas pendências constituem o mapa de risco jurídico do
projeto e devem constar das tratativas de licenciamento comercial.
