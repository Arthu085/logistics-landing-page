# Nexo Logística · Landing page e DevSecOps

Landing page responsiva de uma empresa fictícia de logística, com transporte de cargas, distribuição, entregas expressas, diferenciais e contato demonstrativo. A aplicação usa HTML, CSS e SVG locais, sem JavaScript no navegador, backend, banco de dados ou serviços externos. O endereço `contato@nexo.example` é ilustrativo: o link abre o cliente de e-mail, mas não representa um atendimento real. Para usar outro contato, altere o link e o texto em `src/index.html`.

A entrega utiliza **Build → Sonar → Trivy → Push → Deploy** no GitHub Actions. A imagem é construída uma única vez, analisada, publicada no Docker Hub e implantada por digest no kind local. A configuração dos serviços externos e a execução completa precisam ser concluídas antes de considerar a demonstração ponta a ponta validada.

## Tecnologias e estrutura

- Node.js 24 e npm: testes nativos, build e servidor de prévia, sem dependências de terceiros.
- Nginx sem privilégios: arquivos estáticos em um contêiner na porta 8080.
- Docker, Kubernetes e kind: execução local em um cluster dedicado.
- GitHub Actions, SonarQube Cloud e Trivy: automação, Quality Gate e análise de segurança.
- Docker Hub: repositório **público** da imagem, permitindo pull pelo kind sem credenciais no cluster.

```text
src/                         Página, estilos e ilustrações
scripts/build.mjs            Gera dist/, healthz e version.json
scripts/serve.mjs            Prévia HTTP local
scripts/deploy.sh            Deploy por digest e verificação HTTP
Dockerfile                   Build Node e runtime Nginx
nginx.conf                   Servidor estático e cabeçalhos de segurança
kind/cluster.yaml            Cluster logistics e mapeamento de porta
k8s/                         Namespace, Deployment e Service
.github/workflows/ci.yml      Validação de pull requests em runner hospedado
.github/workflows/devsecops.yml  As cinco etapas da entrega
sonar-project.properties     Análise e espera pelo Quality Gate
```

## Verificação do ambiente WSL

Antes de instalar ferramentas, execute:

```bash
cat /etc/os-release
uname -a
command -v git node npm docker kubectl kind gh
git --version
node --version
npm --version
docker version
kubectl version --client
kubectl config get-contexts
kind version
kind get clusters
gh auth status
git remote -v
```

O kernel deve identificar WSL2. Use Node.js 24 ou superior. `docker version` precisa mostrar cliente **e servidor**. No Docker Desktop do Windows, habilite **Settings → Resources → WSL Integration → sua distribuição** quando necessário. Mantenha o Docker Desktop em execução. Reutilize as ferramentas já instaladas. Se houver necessidade de privilégio administrativo, autenticação ou configuração no Windows, conclua essa ação manual antes de continuar.

Instale apenas ferramentas ausentes, seguindo as fontes oficiais: [Docker com WSL](https://docs.docker.com/desktop/features/wsl/), [kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/), [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) e [GitHub CLI](https://cli.github.com/). Verifique os checksums dos binários. O cluster usa Kubernetes 1.36.4; mantenha `kubectl` dentro da compatibilidade de uma versão minor do servidor.

Confira o acesso e o Actions:

```bash
gh repo view Arthu085/logistics-landing-page
gh api repos/Arthu085/logistics-landing-page/actions/permissions
gh secret list --repo Arthu085/logistics-landing-page
gh variable list --repo Arthu085/logistics-landing-page
```

O campo `enabled` do Actions deve ser `true`. Esses comandos listam nomes de configuração e não exibem valores de secrets. Não apague nem altere clusters de outros projetos.

## Executar e validar a página

```bash
npm ci --ignore-scripts
npm test
npm run build
npm start
```

Abra **http://localhost:3000** no navegador do Windows ou WSL. O servidor de prévia escuta somente em `127.0.0.1`. Para outra porta, use `PORT=3001 npm start`. Interrompa com `Ctrl+C`. O build gera apenas arquivos estáticos em `dist/`; essa pasta não é versionada.

Os testes verificam os destinos da navegação, a existência dos arquivos, requisitos básicos de acessibilidade, o contato demonstrativo e a identificação da revisão no build. Testes do script de deploy usam comandos simulados para verificar a rejeição de imagens mutáveis, o contexto dedicado, rollout, HTTP e falhas por revisão incorreta, sem acessar um cluster real. Verifique também desktop e celular no navegador, incluindo o foco com `Tab` e os links das seções.

## Docker

```bash
docker build --build-arg BUILD_REVISION="$(git rev-parse HEAD)" -t logistics-landing-page:local .
docker run --detach --name logistics-preview --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m -p 127.0.0.1:8081:8080 logistics-landing-page:local
curl --fail http://localhost:8081/healthz
curl --fail http://localhost:8081/version.json
```

Abra **http://localhost:8081**. `/healthz` retorna `ok` e `/version.json` mostra o commit usado no build. Sem o argumento de build, a revisão será `local`. O processo Nginx usa UID/GID 101, sem privilégios, com arquivos temporários em `/tmp` e cabeçalhos que impedem scripts e recursos de terceiros. A imagem atualiza os pacotes Alpine no build; ela deve ser reconstruída e passar novamente pelo Trivy para incorporar correções futuras.

Para remover somente o contêiner de prévia criado acima:

```bash
docker stop logistics-preview
docker rm logistics-preview
```

## Criar ou reutilizar o kind dedicado

O nome do cluster é `logistics`, o contexto é `kind-logistics` e o namespace é `logistics`. A configuração fixa uma imagem de nó Kubernetes 1.36.4 por digest. Examine os clusters existentes antes da criação:

```bash
kind get clusters
kubectl config get-contexts
```

Se **não** existir `logistics`, crie:

```bash
kind create cluster --config kind/cluster.yaml --wait 120s
```

Se existir, reutilize-o após verificar se possui o mapeamento `127.0.0.1:8080 → 30080` previsto no arquivo. Não exclua um cluster para corrigir o mapeamento sem avaliar seu conteúdo. Se a porta 8080 estiver ocupada ou um cluster existente não possuir o mapeamento, use o port-forward descrito abaixo. Todos os comandos de deploy selecionam explicitamente `kind-logistics`; não é necessário trocar o contexto de outros projetos.

Para validar localmente antes de configurar o Docker Hub:

```bash
docker build -t logistics-landing-page:local .
kind load docker-image logistics-landing-page:local --name logistics
kubectl --context kind-logistics apply -f k8s/namespace.yaml
sed 's|IMAGE_PLACEHOLDER|logistics-landing-page:local|g' k8s/app.yaml | kubectl --context kind-logistics apply -f -
kubectl --context kind-logistics -n logistics rollout status deployment/logistics --timeout=180s
kubectl --context kind-logistics -n logistics get deployment,service,pods -o wide
curl --fail http://localhost:8080/healthz
```

Abra **http://localhost:8080**. Há duas réplicas, probes de saúde, limites de recursos e um Service NodePort. O namespace aplica Pod Security `restricted`; os pods não recebem token de ServiceAccount, não podem elevar privilégios e têm filesystem raiz somente leitura.

Como alternativa de acesso, mantenha em outro terminal:

```bash
kubectl --context kind-logistics -n logistics port-forward service/logistics 8082:80 --address 127.0.0.1
```

Abra **http://localhost:8082**. Se o encaminhamento automático do WSL para o Windows não estiver disponível, confirme primeiro a configuração de rede do WSL e a integração do Docker Desktop.

Uma imagem local com a mesma tag não altera automaticamente os pods. Para repetir esse teste local, reconstrua, execute novamente `kind load` e use `kubectl --context kind-logistics -n logistics rollout restart deployment/logistics`, seguido de `rollout status`. A pipeline usa digests distintos e não depende desse reinício manual.

## Configurações externas obrigatórias

Não envie senhas ou tokens no chat nem salve credenciais no repositório. Insira os valores secretos diretamente nas configurações dos serviços.

### SonarQube Cloud

1. Acesse [SonarQube Cloud](https://sonarcloud.io/) e entre com a conta GitHub autorizada para o repositório.
2. Crie ou vincule a organização e importe `Arthu085/logistics-landing-page`. Confirme a elegibilidade e as condições do plano antes de selecioná-lo; não é necessário contratar um plano para os arquivos deste projeto.
3. No projeto, abra **Administration → Analysis Method**, selecione análise com **GitHub Actions** e desative a análise automática para não executar dois métodos concorrentes.
4. Copie a **organization key** e a **project key** exatamente como apresentadas no tutorial. Configure `main` como branch principal.
5. Gere um token de análise com a menor permissão disponível, em **My Account → Security** ou na opção de token da organização disponível no seu plano.
6. Cadastre o token como secret `SONAR_TOKEN` no GitHub. Cadastre `SONAR_ORGANIZATION` e `SONAR_PROJECT_KEY` como variables.
7. Mantenha um Quality Gate ativo no projeto. O scanner espera o resultado por até 300 segundos e reprova a etapa se o gate falhar.

O Sonar analisa a página, os scripts de infraestrutura, o Dockerfile e os manifestos Kubernetes/kind. Como o frontend não possui JavaScript executável, somente `scripts/**` fica excluído da métrica de cobertura de aplicação; os scripts continuam sujeitos à análise estática. Os testes nativos validam navegação, assets, contato e build. Essa configuração não altera os critérios do Quality Gate do projeto.

A URL de conexão usa a região EU padrão (`https://sonarcloud.io`). Se sua organização estiver em outra região, ajuste `SONAR_HOST_URL` e a URL do relatório no workflow conforme o tutorial do Sonar antes de executar. O relatório fica no painel do projeto; o link aparece no resumo da etapa. O artefato `sonar-report-*` preserva `report-task.txt` quando a análise consegue gerá-lo, inclusive se o Quality Gate reprovar. Não existe relatório remoto quando a autenticação ou a configuração falha antes do envio.

### Docker Hub

1. Acesse [Docker Hub](https://hub.docker.com/) e crie um repositório **público** chamado `logistics-landing-page` na sua conta ou organização.
2. Em **Account settings → Personal access tokens**, gere um token com leitura e escrita para publicar nesse repositório. Não use sua senha no workflow.
3. Cadastre o token como secret `DOCKERHUB_TOKEN` no GitHub.
4. Cadastre `DOCKERHUB_USERNAME` como variable com o usuário que autentica no Docker Hub.
5. Cadastre `DOCKERHUB_IMAGE` como variable no formato `usuario-ou-organizacao/logistics-landing-page`, sem `https://`, sem `docker.io/` e sem tag. O namespace precisa pertencer à conta ou permitir escrita pelo usuário configurado.

O repositório precisa ser público para o kind fazer pull sem `imagePullSecrets`. Usar repositório privado exige uma configuração adicional que não está incluída nesta entrega.

### GitHub Secrets, Variables e ambiente

Acesse [Settings → Secrets and variables → Actions](https://github.com/Arthu085/logistics-landing-page/settings/secrets/actions).

| Tipo | Nome | Conteúdo |
| --- | --- | --- |
| Secret | `SONAR_TOKEN` | Token de análise Sonar |
| Secret | `DOCKERHUB_TOKEN` | Token Docker Hub com escrita |
| Variable | `SONAR_ORGANIZATION` | Chave da organização Sonar |
| Variable | `SONAR_PROJECT_KEY` | Chave do projeto Sonar |
| Variable | `DOCKERHUB_USERNAME` | Usuário de autenticação Docker Hub |
| Variable | `DOCKERHUB_IMAGE` | `usuario-ou-organizacao/logistics-landing-page` |

Em **Settings → Environments**, crie `kind-local` e configure **Deployment branches and tags → Selected branches and tags** para permitir somente a branch `main`. O workflow também verifica o repositório de origem, o evento autorizado e a referência `refs/heads/main` antes de chegar ao runner local.

O workflow está vinculado a `Arthu085/logistics-landing-page`. Ao copiar o projeto para outro repositório, atualize conscientemente as duas verificações `github.repository` e as URLs de documentação. Não remova a restrição à `main`.

### Runner self-hosted no WSL

1. Garanta que Docker Desktop e o cluster `logistics` estejam ativos. O usuário que executará o runner precisa ter acesso ao kubeconfig que contém `kind-logistics`.
2. No GitHub, abra [Settings → Actions → Runners](https://github.com/Arthu085/logistics-landing-page/settings/actions/runners), escolha **New self-hosted runner → Linux → x64**.
3. Crie uma pasta fora do checkout, como `~/actions-runner-logistics`, e siga os comandos de download e checksum apresentados pelo GitHub. Eles variam conforme a versão; use os comandos atuais da tela.
4. Execute o comando `./config.sh` da tela para registrar o runner **neste repositório**, acrescentando `--name logistics-wsl --labels kind-logistics`. Use o token temporário apenas nessa configuração local. Não o salve nos arquivos do projeto.
5. Na mesma sessão/conta do runner, valide:

```bash
command -v git bash kubectl curl grep sed
kubectl --context kind-logistics cluster-info
kubectl --context kind-logistics auth can-i create deployments -n logistics
kubectl --context kind-logistics auth can-i create namespaces
```

6. Se necessário, acrescente a pasta dos binários ao `PATH` da sessão do runner. Execute `./run.sh` a partir da pasta do runner e mantenha o terminal WSL aberto. Não execute o runner como root.
7. Confirme no GitHub o status **Idle** e as labels `self-hosted`, `Linux`, `X64`, `kind-logistics`.

O deploy não usa um kubeconfig em Secrets: ele utiliza o acesso local do runner e seleciona explicitamente o contexto. O runner necessita de acesso para aplicar o namespace e os recursos deste projeto. A porta local 18080 precisa estar livre durante o teste HTTP do deploy; ela é aberta temporariamente e fechada pelo script.

Somente mantenha um runner local neste repositório se as alterações de workflows forem revisadas. A pipeline de PR usa apenas runners hospedados, sem secrets de publicação, e não chama o deploy. Em **Settings → Actions → General → Fork pull request workflows**, exija aprovação para todos os colaboradores externos e não aprove workflows desconhecidos. Proteja a `main` e revise modificações em `.github/workflows/` antes de integrá-las. O runner é exclusivo deste repositório; não compartilhe sua label com jobs de projetos não confiáveis.

## Pipeline e relatórios

A pipeline principal roda em push na `main` ou por execução manual da própria `main`. Execuções manuais de outras branches e cópias em outros repositórios são ignoradas. Há somente uma execução principal ativa por vez, sem cancelar o deploy anterior.

| Etapa | Execução | Critério de aprovação |
| --- | --- | --- |
| 1 · Build | GitHub-hosted | Testes, build estático e build Docker; preserva o tar e seu SHA-256 |
| 2 · Sonar | GitHub-hosted | Análise e Quality Gate aprovados |
| 3 · Trivy | GitHub-hosted | Nenhuma vulnerabilidade HIGH/CRITICAL na imagem ou dependências, nem secret HIGH/CRITICAL no repositório |
| 4 · Push | GitHub-hosted | Publica o mesmo tar aprovado; baixa a imagem por digest e confere seu image ID |
| 5 · Deploy | Self-hosted WSL | Aplica o digest publicado, confirma a disponibilidade da nova revisão pelo rollout, testa HTTP e a revisão do commit |

A disponibilidade da nova revisão é validada por `kubectl rollout status deployment/logistics`. Pods de revisões antigas ainda em terminação não entram em uma espera adicional de prontidão por label.

A tag tem o formato `sha-<commit-completo>-<run-id>-<tentativa>`. O fluxo **não reconstrói** a imagem após o scan e **não usa `latest`** no deploy. O tar validado por SHA-256 passa entre os jobs como artefato de uma mesma execução. O Push valida seu image ID antes e depois da publicação, obtém o digest confirmado pelo Docker Hub e transmite `docker.io/namespace/logistics-landing-page@sha256:...` ao Deploy. Essa referência é aplicada diretamente ao Deployment.

O Trivy reprova vulnerabilidades HIGH/CRITICAL **mesmo sem correção disponível**, sem `ignore-unfixed` ou lista de exceções. Ele também analisa dependências e secrets no diretório do repositório. Os dois scans produzem JSON, e o artefato `trivy-reports-*` é enviado mesmo quando uma verificação reprova. Falhas de instalação ou rede anteriores ao scan podem não produzir JSON; os logs da etapa continuam disponíveis. Os relatórios e metadados Sonar ficam disponíveis por 14 dias; o tar da imagem, por 3 dias. Não é possível retomar o Push de uma execução cujo tar expirou: inicie uma nova execução completa.

Para executar manualmente:

1. Abra **Actions → Build → Sonar → Trivy → Push → Deploy → Run workflow**.
2. Selecione `main` e confirme a execução. Ou use:

```bash
gh workflow run devsecops.yml --ref main --repo Arthu085/logistics-landing-page
gh run list --workflow devsecops.yml --repo Arthu085/logistics-landing-page
```

3. Abra a execução para consultar os cinco jobs, o resumo com relatório Sonar/imagem/status do deploy e a seção **Artifacts**.
4. Consulte o painel do Sonar pelo link do resumo. Baixe os relatórios Trivy na seção de artefatos ou com `gh run download ID_DA_EXECUCAO --name trivy-reports-ID_DA_EXECUCAO-TENTATIVA`.

Se Sonar ou Trivy reprovarem, Push e Deploy não executam. Corrija o problema e rode novamente o fluxo completo. Não reduza o gate para produzir uma demonstração verde. Se o Deploy ficar na fila, verifique as labels e o status do runner. Se falhar, confira logs, eventos e acesso ao cluster; o script exibe recursos e eventos no erro.

## Conferir a implantação e demonstrar

Depois do Push, copie a referência **pública** por digest do resumo. Para uma implantação manual da imagem já aprovada:

```bash
bash scripts/deploy.sh docker.io/SEU_USUARIO/logistics-landing-page@sha256:DIGEST_REAL
```

Substitua os dois marcadores por valores reais em minúsculas; o digest deve ter 64 caracteres hexadecimais. O script rejeita tags mutáveis e imagens que não sejam do Docker Hub. O teste de revisão do commit é obrigatório no Actions (`EXPECTED_REVISION`) e opcional no uso manual.

Para consultar o estado:

```bash
kubectl --context kind-logistics -n logistics get deployment,service,pods -o wide
kubectl --context kind-logistics -n logistics rollout status deployment/logistics --timeout=180s
kubectl --context kind-logistics -n logistics get deployment logistics -o jsonpath='{.spec.template.spec.containers[0].image}'
curl --fail http://localhost:8080/healthz
curl --fail http://localhost:8080/version.json
```

Roteiro para apresentação:

1. Mostre a execução com os cinco jobs aprovados e as dependências entre eles.
2. Abra o painel Sonar com Quality Gate aprovado e o artefato JSON do Trivy.
3. Abra a tag publicada no repositório Docker Hub e compare seu digest com o resumo do Push e a imagem no Deployment.
4. Mostre duas réplicas prontas, o Service e o rollout concluído no terminal.
5. Abra a página em **http://localhost:8080**, navegue pelas seções e demonstre a versão móvel.
6. Altere um conteúdo da página em uma branch e integre o PR revisado à `main`. Verifique uma nova execução, nova tag/digest, rollout e o novo commit em `/version.json`. A integração do PR deve ser feita explicitamente pelo responsável; o fluxo de implementação não faz merge automático.

A validação completa exige contas configuradas, secrets cadastrados, runner online, imagem publicada e as cinco etapas executadas com sucesso. Um teste com imagem carregada localmente no kind comprova o funcionamento local, mas não comprova Sonar, publicação no Docker Hub ou o deploy pelo Actions.

## Referências

- [SonarQube Cloud com GitHub Actions](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/ci-based-analysis/github-actions-for-sonarcloud/)
- [Trivy: análise de imagem e opções](https://trivy.dev/docs/latest/references/configuration/cli/trivy_image/)
- [kind: mapeamento de portas](https://kind.sigs.k8s.io/docs/user/configuration/#extra-port-mappings)
- [GitHub Actions: uso seguro de runners](https://docs.github.com/en/actions/reference/security/secure-use)
- [Nginx sem privilégios](https://github.com/nginx/docker-nginx-unprivileged)
