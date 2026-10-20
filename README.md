# Prime Açaí Gestão

Aplicação web de gestão da açaiteria. O código da aplicação está em
[`acai-gestao/`](./acai-gestao/); o pacote local compartilhado de autenticação,
consumido pela dependência `file:../Login_projetos`, está em
[`Login_projetos/`](./Login_projetos/).

## Nomes de integração

O nome padrão do projeto é `prime-acai-gestao` para o repositório GitHub e para
o projeto Cloudflare Pages. A aplicação usa Neon para PostgreSQL, Neon Data API
e autenticação. Não armazene credenciais neste arquivo ou no Git.

## Desenvolvimento

Consulte [`acai-gestao/README.md`](./acai-gestao/README.md) para requisitos,
instalação, configuração do `.env`, migrações, testes, build e deploy.

No PowerShell, a partir da raiz:

```powershell
Set-Location .\acai-gestao
npm ci
npm test
npm run validar:migracoes
npm run build
```
