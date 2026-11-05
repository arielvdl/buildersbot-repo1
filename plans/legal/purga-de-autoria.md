# Plano — Titularidade total e purga de origem

**Objetivo:** o Builders Bot passa a ser obra da Cultura Builder — titularidade, licença, nomes, infraestrutura, lojas e história. Nenhuma referência, URL, conta, certificado, classe ou crédito do projeto anterior. Nada quebra para quem já usa.

**Base medida:** `/Users/arielsilva/Projects/buildersbot-local`, branch `builders-bot`, exportada com `git archive` para `/Users/arielsilva/Projects/buildersbot-repo1` (commit de origem em `docs/titulo/dossie.md`). O espelho arqueológico está em `/Users/arielsilva/Projects/.archive/buildersbot-local.git`.
**Status:** F0, F2, F4 (com os identificadores persistidos mantidos), F6 e F7 executadas em 02/11/2026. Restam F1 (contrato), F3 (DNS e serviços próprios), F5 (certificados e lojas) e F8 (verificação em máquina limpa).
**Portão duro:** nenhum build de cliente sai antes da F1 assinada.

## Titular

A titularidade é da pessoa jurídica abaixo, e é ela que assina a cessão, figura no `LICENSE`, no `NOTICE` e nos metadados de build. O nome fantasia "Cultura Builder" pode aparecer na UI; os atos jurídicos usam sempre a razão social e o CNPJ.

| Campo | Valor |
|---|---|
| Razão social | **CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA** |
| CNPJ | **62.995.760/0001-33** |
| Sede | Presidente Prudente – SP |
| Papel | cessionária, titular do copyright e licenciante |
| Repositório novo | `https://github.com/nextlevelcommunity/buildersbot-repo1.git` |
| Pasta de trabalho nova | `/Users/arielsilva/Projects/buildersbot-repo1` |

O desenvolvimento passa a acontecer **no repositório novo, com história nova**. O `buildersbot-local` deixa de ser local de trabalho e vira apenas espelho arqueológico: nada de `upstream`, nada de tags, nada de SHA antigo no que for publicado. A árvore é exportada, não clonada com `.git`.

---

## 0. A verdade jurídica primeiro

Não existe "trocar o arquivo LICENSE". A PolyForm é a licença da camada de baixo, e nós não somos donos dela. Só existem quatro caminhos:

| Caminho | O que resolve | Custo | Prazo |
|---|---|---|---|
| **A. Cessão total de direitos** (recomendado) | Tudo. O código vira nosso, relicenciável sob qualquer termo, sem aviso obrigatório | Negociação + notário | 2–6 semanas |
| **B. Licença perpétua, exclusiva, irrevogável, sublicenciável e com direito de relicenciar** | Quase tudo: podemos relicenciar e apagar avisos, mas a titularidade fica com eles | Menor | 1–3 semanas |
| **C. Compra da sociedade / do ativo** | Tudo, com passivo junto | Alto | 2–4 meses |
| **D. Reescrita clean-room** | Independência real, sem contrato | Muito alto (12–18 meses) | 12–18 meses |

**Recomendação: A.** Se eles recusarem A, B entrega o mesmo resultado prático (podemos apagar a PolyForm e relicenciar), mas a frase "isto é nosso" fica juridicamente mais fraca. D é o plano de fuga, não o plano.

### 0.1 Quem é o dono, medido por linha

| Titular | Linhas | % | Situação |
|---|---:|---:|---|
| Synthetify Labs (4 identidades do núcleo) | 1.759.655 | **90,3%** | o único interlocutor que importa |
| Cultura Builder (Ariel) | 120.112 | 6,2% | nosso, mas ainda em nome pessoal — precisa de cessão para a pessoa jurídica |
| Terceiros que assinaram o CLA | ~7.344 | 0,4% | cobertos, mas o CLA está endereçado ao repo errado |
| Terceiros sem assinatura | ~61.231 | 3,1% | **pendência** — 20+ pessoas |

Isso é uma posição excelente: **um contrato resolve 90%**. O resto é cauda curta e tratável.

### 0.2 O defeito que ninguém viu

O `CLA.md` atual chama-se "Builders Bot Contributor Assignment Agreement", mas foi escrito em 2026-10-16 e assinado por gente que contribuía para o repositório do Ciclo I; o texto da assinatura aponta para o repositório antecessor. O contrato define "Project" como o repositório `Hub-Next-Level/buildersbot-cb`. Ou seja: **as 47 assinaturas existentes cobrem mal o trabalho feito antes do fork**. Precisa de CLA v2, com a cessionária identificada por razão social e CNPJ, e com:

- definição de "Project" que inclua o repositório antecessor e todo commit anterior;
- cláusula retroativa com anexo de SHAs;
- texto de assinatura sem URL de fora;
- cessão de patentes, não só licença;
- concordância de não exercer direitos morais;
- direito expresso de relicenciar sob termos proprietários e de apagar avisos.

---

## 1. Inventário de rastro (o que precisa sumir)

### 1.1 Superfície de produto

| Vetor | Volume | Onde |
|---|---:|---|
| Nome antigo | 423 linhas / 167 arquivos | `apps/`, `src/`, `packages/`, `scripts/`, `docs/` |
| Hosts de runtime do projeto anterior | 6 domínios | `invite-links.ts`, `auth-api`, `site-router`, `mobile`, `remote/` |
| Analytics de terceiro deles | 2 hosts + client ID | `scripts/telemetry-destinations.ts` |
| Bundle mobile | `run.buildersbot.mobile` + 2 extensões | `apps/mobile/app.json` |
| Firebase | `buildersbot-a3328` | `apps/mobile/google-services.json` |
| Imagem Docker | `ghcr.io/nextlevelcommunity/buildersbot-repo1` | `release.yml`, `docs/aws-ecs.md` |
| Handles | `@BuildersBot_`, `@meetBuildersBot` | docs, site, rodapé |
| Pastas/banco/Keychain | `.buildersbot`, `buildersbot.db`, `BuildersBot Safe Storage` | migração |

### 1.2 Rastro jurídico e de marca

| Vetor | Ocorrências | Observação |
|---|---:|---|
| `polyform` | **54 linhas / 30 arquivos** | `LICENSE`, `NOTICE`, `package.json` (3), `Dockerfile`, `flake.nix`, `nix/package.nix`, podspecs, páginas do site, FAQ, `llms-txt`, comparativos |
| `Synthetify` | 17 linhas | `LICENSE`, `NOTICE`, README, rodapé, termos, página de licença comercial, página de download, `docs/RELEASING.md`, `release.yml` |
| org antecessor | 93 linhas | docs, links, badges, manifests |
| `Required Notice:` | `LICENSE` e `NOTICE` | some por completo com a cessão |
| "derivado"/"derived"/"proprietary" | README, rodapé, termos, licença | precisa virar "nosso" |

### 1.3 Rastro de infraestrutura deles

| Vetor | Situação |
|---|---|
| Conta Azure Trusted Signing `synthetifyartifactsign`, perfil `SYNTHETIFY` | certificado de assinatura Windows é deles |
| Publisher do instalador `SYNTHETIFY LABS…` | aparece no SmartScreen e no `app-update.yml` |
| Contas de loja (Apple/Google/Microsoft) | se o app está publicado, a listagem é deles |
| Certificados macOS/Android/iOS | provavelmente deles |
| Org GitHub `Hub-Next-Level` | precisa decisão: nossa ou nova |
| Firebase/Cloudflare/EAS | projeto e contas deles |
| `upstream` no git + 128 tags | história e SHAs deles |

### 1.4 Rastro de código (o mais difícil)

Nomes genéricos não denunciam, mas alguns são impressão digital: `buildersbot_metadata`, `buildersbot_browser`, `buildersbot-database`, `buildersbot-tool-router`, `damage_probe`, `blocker`, `pi-client`, `Build Boat` (este é de terceiro — fica), `Acp*` (protocolo padrão — fica), `Blobatar` (terceiro — fica).

Classificar cada nome em três grupos:

| Grupo | Exemplos | Ação |
|---|---|---|
| **Sem migração** — invisível em disco/protocolo | classes, módulos, funções, eventos de log, fixtures, prosa de erro | renomear livremente |
| **Com migração** — persistido ou contratual | tabelas SQLite, chaves de config, campos de protocolo, headers, env vars, rotas, params de deep link | renomear com alias de leitura e migração idempotente |
| **Fica** — de terceiro | `boat`, `Blobatar`, `ACP`, `pi`, `Codex`, `Claude`, `Grok`, `Font Awesome` | não tocar |

---

## 2. Fases

### F0 — Congelar, criar o repositório novo e as guardas (1–2 dias) — **feito**

- `git clone --mirror` do `buildersbot-local` para fora do disco de trabalho, com todos os refs. É o arquivo morto; o `buildersbot-local` sai do circuito.
- Criar `/Users/arielsilva/Projects/buildersbot-repo1` **sem `.git` herdado**: exportar a árvore com `git archive` (ou cópia sem `.git`, `node_modules`, `dist`, `out`, `*.tsbuildinfo`, `.buildersbot-build`), e `git init` com branch `main`.
- Primeiro commit: árvore exportada, autor `Cultura Builder <dev@culturabuilder.com>`, mensagem `Builders Bot` — sem trailer, sem coautor, sem SHA antigo.
- `git remote add origin https://github.com/nextlevelcommunity/buildersbot-repo1.git`; **nenhum remote de upstream**.
- Congelar os outros cinco clones como leitura.
- Quatro guardas novas, todas no CI, todas falhando fechado:
  - `scripts/license-provenance-guard.ts` — reprova `polyform`, `polyformproject.org`, `synthetify`, o org antecessor, `buildersbot`, `Required Notice`, "derivado", "proprietary". Allowlist começa cheia e **termina vazia**.
  - `scripts/network-egress-guard.ts` — lista fechada de hosts, varre fonte, config, workflow, build e pacote.
  - `scripts/metadata-guard.ts` — reprova autor, e-mail, trailer, tag, remote e URL de repositório não aprovados; o único remote permitido é o `origin` novo.
  - `scripts/fingerprint-guard.ts` — reprova identificadores distintivos que sobrarem depois da F4 (lista versionada).
- E2E de captura de rede em perfil limpo: login, convite, sessão remota, site, update, marketplace, link mobile.
- Linha de base verde antes de tocar em qualquer coisa.

**Aceite:** `buildersbot-repo1` existe, com um commit e um único remote; `git log` já nasce só nosso; as quatro guardas rodam no CI e a dívida atual está listada.

### F1 — Título: cessão, residuals e CLA v2 (2–6 semanas) — **portão**

1. **Due diligence de cadeia de título.** Gerar dossiê: mapa de autores, mapa de linhas por arquivo, lista de commits por autor, lista de arquivos exclusivos de terceiros. Congelar como anexo do contrato.
2. **Carta de intenção** para Synthetify Labs: cessão total, escopo, preço, prazo, o que fica com eles (nada de código), o que passa (marca? domínios? contas?). Cessionária identificada por razão social e CNPJ, com poderes de representação comprovados.
3. **Contrato de Cessão Total de Direitos Autorais e de Patentes**, entre **CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA, CNPJ 62.995.760/0001-33, sede em Presidente Prudente – SP** (cessionária) e **Synthetify Labs spółka z ograniczoną odpowiedzialnością** (cedente, com KRS e representação a confirmar na due diligence), com:
   - cessão de todos os direitos patrimoniais, mundial, por todo o prazo, todos os campos de exploração;
   - direito de relicenciar sob qualquer termo, inclusive proprietário e fechado, e de sublicenciar em cadeia;
   - direito de modificar, renomear, **remover avisos** e de não atribuir;
   - concordância de não exercer direitos morais (na Polônia não se renuncia, se acorda não exercer);
   - **cessão de patentes**, não licença;
   - cláusula de contribuições futuras até a data de corte;
   - garantia de cadeia de título e indenização por reivindicação de terceiro;
   - anexo com os SHAs e o dossiê do item 1;
   - lei brasileira, foro da comarca de Presidente Prudente – SP, firma reconhecida, procuração.
4. **Residual de 3,1%.** Três caminhos, nesta ordem: assinatura retroativa do CLA v2; release escrito por e-mail com o mesmo efeito; reescrita clean-room do arquivo. Priorizar por linhas: `sysrootix` (12k), `qiyuechen114` (11k), `moretti.a` (8,5k), `ardakrt` (7k), `paulovitin` (6,7k) e cauda.
5. **CLA v2** publicado, com anexo retroativo e texto de assinatura sem URL externa.
6. **Cessão interna:** os 6,2% em nome pessoal de Ariel passam para a pessoa jurídica por contrato de cessão, com a mesma cláusula de patente e de direitos morais, para a empresa ser titular única.
7. **Registro:** contrato, dossiê e assinaturas em `docs/titulo/` (ou repositório privado), com hash e data.

**Aceite:** contrato assinado cobrindo ≥ 99,5% das linhas; residuals com release assinado ou arquivo reescrito; parecer jurídico de cadeia de título.

### F2 — Licença nova e remoção de todo rastro legal (2–3 dias) — **feito**

- **Decidir a licença** (seção 4). Recomendação: EULA proprietária nossa + licença comercial; alternativa: licença própria proprietary.
- `LICENSE` novo, escrito por nós, sem PolyForm e sem URL de terceiro. Linha de copyright exata:

  ```text
  Copyright 2026 CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA (CNPJ 62.995.760/0001-33)
  ```

- `NOTICE` novo: só dependências de terceiro (Blobatar, Font Awesome, moby, recharts) — **nenhuma menção ao projeto anterior, a Synthetify ou a `buildersbot`**. A titularidade do produto aparece no topo com a razão social e o CNPJ.
- `package.json`: `license` novo (3 arquivos), `author` = razão social, CNPJ e `licenses@culturabuilder.com`, `contributors`, `repository` = `git+https://github.com/nextlevelcommunity/buildersbot-repo1.git`, `homepage` e `bugs` no repositório novo.
- Página de licença comercial reescrita: uma camada só, sem "derivative", sem "earlier work", sem "required notices".
- Termos de uso, rodapé do site, página de download, FAQ, `llms-txt`, comparativos.
- `Dockerfile`, `flake.nix`, `nix/package.nix`, podspecs, `marketplace/production-catalog/README.md`.
- `docs/licensing.md` reescrito do zero; `docs/history.md` opcional, sem nomes.
- `README` e `AGENTS.md` sem "derivado de", sem crédito, sem link.
- Remover `Required Notice:` de tudo.

**Aceite:** `license-provenance-guard` verde com allowlist vazia; nenhuma ocorrência de `polyform`, `synthetify`, org antecessor, `Required Notice`, `derived`, `derivado` no HEAD.

### F3 — Infraestrutura própria, zero ping (1–2 semanas)

Mapa de domínios:

| Serviço | Hoje | Novo |
|---|---|---|
| App/landing/API | `buildersbot.culturabuilder.com` | mantém |
| Fallback de auth | `auth-buildersbot.culturabuilder.com` | mantém |
| Signal | `signal.buildersbot.culturabuilder.com` | `signal.buildersbot.culturabuilder.com` |
| TURN | `turn.buildersbot.culturabuilder.com` | `turn.buildersbot.culturabuilder.com` |
| Sites publicados | `*.sites.buildersbot.culturabuilder.com` | `*.bb.culturabuilder.com` (curto) ou `*.sites.buildersbot.culturabuilder.com` |
| Feed de update | inexistente | `updates.buildersbot.culturabuilder.com` (R2) |
| Status | `status.buildersbot.culturabuilder.com` | `status.buildersbot.culturabuilder.com` |
| Docs | `buildersbot.culturabuilder.com/docs` | `buildersbot.culturabuilder.com/docs` |
| Convite | `api.buildersbot.culturabuilder.com/join` | `buildersbot.culturabuilder.com/join` |
| E-mail | domínio deles | `send.buildersbot.culturabuilder.com` |
| Analytics | OpenPanel deles | `analytics.buildersbot.culturabuilder.com` (próprio) ou desligado |
| Firebase | `buildersbot-a3328` | projeto novo nosso |

Ordem: DNS/certificados → Signal/TURN próprios → feed assinado → wildcard de sites com 301 → analytics → status/docs/links/e-mail → Firebase. Dupla escrita e rollback por serviço em cada passo.

**Aceite:** nenhuma chamada de runtime a host fora da matriz; E2E de rede verde; rollback testado.

### F4 — Superfície e nomes internos (4–6 dias) — **feito, com identificadores persistidos mantidos**

- Strings de UI, erros, títulos, `about`, diálogos, notificações, e-mails, páginas, marketplace.
- Pastas, banco, Keychain, caches, locks, sockets, nome de processo, `User-Agent`, `clientInfo`, headers residuais.
- Migração na primeira execução: copia e converte, preserva o original por uma release.
- Renomear identificadores distintivos conforme a classificação 1.4 — com migração onde há persistência.
- Revisão de prosa: mensagens de erro que explicam conceitos com jargão deles.

**Aceite:** upgrade por cima de instalação antiga preserva sessões, agentes, bancos, chaves e servidores; `fingerprint-guard` verde.

### F5 — Build, assinatura e lojas próprias (1–2 semanas)

- Conta Azure Trusted Signing nossa, perfil e CN nossos. O CN do certificado e o publisher do instalador usam **CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA**, com o CNPJ nos metadados do pacote.
- Certificados macOS (Developer ID), Android, iOS — nossos, não reutilizar os deles.
- `appId` desktop mantido; mobile trocado **se** não houver base publicada.
- Ícones, splash, DMG, instalador, AppImage, nome do executável, metadados, `copyright` do `electron-builder.yml`.
- Imagem Docker em registry nosso, com label `org.opencontainers.image.vendor` = razão social.
- **Lojas próprias:** Apple Developer, Google Play, Microsoft Store (se aplicável) — contas nossas, listagem nova, screenshots novas, política de privacidade nossa, e-mail de suporte nosso.
- Se já houver app publicado em conta deles: plano de transição (nova listagem + aviso in-app; manter bundle antigo só enquanto durar a base instalada).

**Aceite:** pacote assinado por nós, instalável, atualizável pelo feed nosso; loja aceita o binário; SmartScreen mostra nosso publisher.

### F6 — Conteúdo, docs e SEO (3–4 dias) — **feito, exceto imagens**

- `README`, `docs/*`, `CONTRIBUTING`, `SECURITY`, `SUPPORT`, `PRIVACY`, `ANALYTICS`, `TROUBLESHOOTING`, `RELEASING`, `AGENTS`.
- `CHANGELOG` nosso, começando na versão de corte.
- Screenshots regerados; imagens com UI antiga trocadas.
- Comparativos e páginas de SEO revisados.
- Todos os links de repositório, issue, release e badge apontando para `nextlevelcommunity/buildersbot-repo1`.
- 301, canonical, sitemap, Search Console.

**Aceite:** nenhum texto publicado cita origem, projeto, empresa ou URL anterior.

### F7 — Publicação no repositório novo (1 dia, por último) — **feito**

O repositório já nasce órfão na F0, então aqui só se publica o que passou pelas fases anteriores.

- Confirmar `origin` único: `https://github.com/nextlevelcommunity/buildersbot-repo1.git`.
- Primeiro push com `--no-follow-tags`; nenhuma tag antiga é enviada.
- Tag nova `v1.0.0`, assinada, no commit de corte.
- GitHub: descrição, topics, social preview, releases sem menção à origem, `cla-signatures` novo no repo novo.
- Se a história intermediária de trabalho tiver sido commitada em `main`, achatar antes do push com `git reset --soft` no commit inicial, para não sobrar mensagem de fase.
- Mirror arqueológico guardado fora do disco de trabalho.

**Aceite:** `git remote -v` só mostra `origin`; `git log --format='%an %ae'` só nosso; sem tag, trailer ou mensagem antiga; `git log -S buildersbot` vazio no HEAD.

Executado: repositório público `nextlevelcommunity/buildersbot-repo1`, um único commit, `origin` único, tag `v1.0.0` assinada, release publicada, `cla-signatures` criado, branch `main` protegida por ruleset com os checks `guards` e `check`.

### F8 — Verificação e corte (2–3 dias) — **pendente**

- Suíte completa, quatro guardas, E2E de rede, scan de pacote.
- Máquina limpa em macOS, Windows, Linux, Android, iOS.
- Upgrade a partir da última versão antiga em cada plataforma.
- `strings` em `.app`, `.exe`, `.AppImage`, `.apk`, `.ipa`, `app.asar`.
- **Red team de 30 minutos:** alguém sem contexto tenta descobrir a origem e falha.
- Só então apagar aliases de compatibilidade e desligar o espelho arqueológico.

---

## 3. O que não pode quebrar

| Contrato | Como preservar |
|---|---|
| Upgrade por cima | mesmo `appId`, publisher novo coordenado com o feed, migração idempotente |
| Convite antigo | host antigo aceito em leitura + 301 |
| Site publicado | DNS/Worker antigos servindo + 301 |
| Instalação existente | pastas, banco, Keychain e caches migrados, original intacto |
| App mobile instalado | mesmo bundle enquanto houver base |
| Servidor Docker/ECS | tag antiga publicada, nova no registry nosso |
| Extensão Chrome / host nativo | mesmos IDs e caminhos |
| Providers | downloads e logins inalterados |
| Marketplace | slugs e URLs de ícone estáveis |
| Webhooks | headers `X-BuildersBot-*` não mudam |

Regra: **nome novo escreve, nome antigo lê**. Se precisar escrever nome antigo, justificar por escrito.

---

## 4. Qual licença nova

| Opção | Prós | Contras |
|---|---|---|
| **EULA proprietária + licença comercial** (recomendada) | coerente com o modelo de assentos; nenhuma dependência de licença de terceiro; controle total | menos adoção por dev |
| Licença própria proprietary | adoção com controle | texto próprio exige revisão jurídica; quase igual à PolyForm em efeito |
| MIT/Apache | adoção máxima | concorrente pode clonar e vender |
| Dupla: nossa proprietary + comercial | equilíbrio | duas camadas nossas, não duas de terceiros |

**Recomendação:** EULA proprietária para binário + licença comercial por assento, com `LICENSE` curto e `docs/licensing.md` explicando em uma página. Zero menção a PolyForm.

---

## 5. Matriz de rede

| Nível | Hosts | Regra |
|---|---|---|
| 0 — nossa casa | `*.culturabuilder.com` | única saída padrão |
| 1 — provedores escolhidos pelo usuário | OpenAI, Anthropic, xAI e endpoints dos CLIs | permitido, visível na UI |
| 2 — dependências | npm, GitHub Releases de runtime, FCM/APNs | permitido, cache local quando possível |
| 3 — proibido | `*.buildersbot.culturabuilder.com`, `*.sites.buildersbot.culturabuilder.com`, `api.openpanel.dev`, `discord.buildersbot.culturabuilder.com`, `status.buildersbot.culturabuilder.com`, caminho de registro do org antecessor | falha a guarda |
| 4 — proibido por padrão | Sentry/PostHog/GA de terceiro | só com justificativa escrita |

Fonte da verdade única em `scripts/network-policy.ts`, consumida pela guarda de fonte, de pacote e pelo E2E.

---

## 6. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Synthetify recusa cessão | alto | plano B (licença exclusiva com direito de relicenciar); plano D (clean-room) para módulos críticos |
| Residual de 3,1% não responde | médio | reescrita clean-room dos arquivos, priorizada por linhas |
| Direito moral polonês é irrenunciável | baixo | cláusula de não exercício + publicação sem nome |
| Patente não acompanha copyright | médio | cessão de patente separada e explícita |
| Troca de publisher quebra update | alto | publisher novo junto com feed novo, teste real em cada SO |
| Troca de bundle mobile | alto | só se não houver base publicada |
| Cert wildcard de sites | médio | Cloudflare for SaaS / cert dedicado, teste antes do corte |
| Signal próprio fora do ar | alto | dupla escrita, health check, rollback por release |
| `filter-repo` quebra clones | baixo | o repo novo nasce sem história; ninguém precisa reescrever clone |
| Repo novo nasce com rastro | médio | exportar com `git archive`, nunca `clone` com `.git`; guarda de metadados barra remote, autor e tag |
| Guarda rígida trava o time | médio | allowlist com motivo e erro que ensina o conserto |

---

## 7. Rollback

- F1 não tem rollback técnico, tem plano B contratual.
- F2 é PR isolado e reversível.
- F3 tem rollback por variável de ambiente, sem rebuild.
- F4 tem rollback por flag `BUILDERSBOT_LEGACY_COMPAT`.
- F7 é irreversível no repo público: por isso é o penúltimo, com mirror pronto.
- Pior caso: restaurar o mirror, refazer a exportação para uma pasta limpa e republicar; binários distribuídos continuam funcionando porque a compatibilidade é só de leitura.

---

## 8. Critérios de aceite

**Jurídicos**
- [ ] Contrato de cessão assinado e registrado, identificando a cessionária por razão social e CNPJ, cobrindo ≥ 99,5% das linhas.
- [ ] Residual com release assinado ou arquivo reescrito.
- [ ] Parecer de cadeia de título.
- [ ] Patentes cedidas.
- [ ] `LICENSE` e `NOTICE` novos, com a linha de copyright da pessoa jurídica e o CNPJ, sem `Required Notice`, sem PolyForm, sem URL de terceiro.
- [ ] `package.json` com `author` = razão social + CNPJ, e `copyright` do instalador idem.

**Técnicos**
- [ ] `git remote -v` só mostra `origin` = `nextlevelcommunity/buildersbot-repo1`.
- [ ] `grep -ri` dos marcadores legais e do org antecessor no HEAD: zero.
- [ ] `git log` só com identidade nossa; sem tags, trailers ou remotes antigos.
- [ ] App usado sem uma conexão fora da matriz de rede.
- [ ] `strings` nos cinco formatos de binário: zero rastro.
- [ ] Upgrade da última versão antiga preserva dados e login em todas as plataformas.
- [ ] Convite, site e servidor antigos funcionando.
- [ ] Pacote assinado por nós, feed nosso, update aplicado de verdade.
- [ ] Lojas, site, docs, status e e-mails sem menção à origem.
- [ ] Quatro guardas verdes no CI.
- [ ] Red team de 30 minutos falha em identificar a origem.

---

## 9. Ordem e esforço

| Fase | Esforço | Depende de |
|---|---|---|
| F0 congelar e guardar | 1–2 d | — |
| F1 título | 2–6 sem | F0 |
| F2 licença nova | 2–3 d | F1 |
| F3 infra | 1–2 sem | F0, DNS |
| F4 superfície e nomes | 4–6 d | F2, F3 |
| F5 build e lojas | 1–2 sem | F1, F3, F4 |
| F6 conteúdo | 3–4 d | F2, F4 |
| F7 publicação no repo novo | 1 d | F2–F6 verdes |
| F8 verificação | 2–3 d | tudo |

Total: **~6 a 10 semanas**, com F1 e F3 em paralelo. F1 é o caminho crítico e o único que pode travar o resto.

---

## 10. Decisões

**Fechadas**

- Licença: EULA proprietária + licença comercial por assento.
- Analytics: mantido o OpenPanel, com o projeto existente.
- Mobile: bundle `run.buildersbot.mobile` mantido enquanto houver base instalada.
- Sites: `*.sites.buildersbot.culturabuilder.com`.
- Nível 1: provedores direto, sem proxy nosso na frente.
- Registro do contrato: cartório de Presidente Prudente.
- Titular: CULTURA BUILDER EDUCACAO E TECNOLOGIA LTDA, CNPJ 62.995.760/0001-33, Presidente Prudente – SP.
- Lei brasileira, foro da comarca de Presidente Prudente – SP.
- Repositório novo: `https://github.com/nextlevelcommunity/buildersbot-repo1.git`, pasta `/Users/arielsilva/Projects/buildersbot-repo1`, história do zero.

**Abertas**

1. **Abrir negociação de cessão com a Synthetify?** Preço-teto e quem assina pela Cultura Builder (sócio com poderes, conforme contrato social).
2. **Se recusarem:** aceita o plano B (licença exclusiva) ou vamos para clean-room?

**Fechadas na execução**

- Licença: EULA proprietária + licença comercial por assento.
- Sites: `*.sites.buildersbot.culturabuilder.com`.
- Mobile: bundle `run.buildersbot.mobile` mantido enquanto houver base instalada.
- Analytics: OpenPanel mantido, no projeto existente.
- Nível 1: provedores direto, sem proxy nosso na frente.
- Registro do contrato: cartório de Presidente Prudente.
- Publicação: `v1.0.0` assinada, um commit, `origin` único, `main` protegida.
