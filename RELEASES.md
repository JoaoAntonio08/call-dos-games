# Versões e releases

Tudo sai pela página de [Releases](https://github.com/JoaoAntonio08/call-dos-games/releases). Quem só quer instalar abre a **[versão mais nova](https://github.com/JoaoAntonio08/call-dos-games/releases/latest)** e baixa em **Assets**.

## Três números diferentes

| O quê | Tag | Onde fica o número | Quando sobe |
|---|---|---|---|
| **Call dos Games** (site + API) | `vX.Y.Z` (ex.: `v2.2.0`) | a tag | toda leva de novidades que vai para o servidor |
| **App de Windows** | `desktop-vX.Y.Z` (ex.: `desktop-v2.0.1`) | `desktop-tauri/src-tauri/tauri.conf.json` | só quando muda algo do app em si (atualizador, bandeja, captura de tela…) |
| **App de Android** | não tem tag própria | `android/app/build.gradle` (`VERSAO` e `versionCode`) | só quando muda a casca (ícone, nome, domínio, permissões) |

Os apps abrem o site ao vivo, então as novidades do site chegam neles **sem reinstalar**. Por isso o número dos apps anda mais devagar que o do site.

Padrão dos números (`X.Y.Z`): **Z** para correção, **Y** para novidade, **X** para mudança grande (ex.: troca do app de Electron para Rust no 2.0.0).

## Como fica a página de Releases

- **`vX.Y.Z` — "Call dos Games X.Y.Z — tema"**: a principal. Começa com a tabela **Baixar** e traz em Assets os instaladores atuais com nomes claros: `Call-dos-Games-Windows-<versão>.exe` e `Call-dos-Games-Android-<versão>.apk`. É sempre a marcada como **Latest**.
- **`desktop-vX.Y.Z` — "App de Windows X.Y.Z"**: arquivos assinados que o atualizador automático usa (`.exe`, `.sig`, `latest.json`). Não é marcada como Latest.
- **`desktop-latest` — "Canal de atualização do app de Windows"**: pré-release fixa com o `latest.json` que o app consulta. Ninguém baixa nada dela.
- As antigas ficam de histórico, com um aviso no topo apontando para a mais nova.

## Lançar uma versão do site (`vX.Y.Z`)

1. Trabalhe numa branch e abra PR para a `main` (a `main` é protegida: só entra por PR).
2. Depois do merge, crie a release `vX.Y.Z` na `main` com o título `Call dos Games X.Y.Z — tema` e as seções **Baixar**, **O que mudou** e **Para quem cuida do servidor**.
3. Anexe os instaladores atuais dos apps (os mesmos da release anterior, se não mudaram).
4. No servidor: `sudo bash /opt/calldosgames/app/backend/scripts/atualizar.sh`.

## Lançar uma versão do app de Windows (`desktop-vX.Y.Z`)

1. Suba a versão em `desktop-tauri/src-tauri/tauri.conf.json` (e no `Cargo.toml`), por PR.
2. Rode o workflow **Build signed Windows draft**: ele gera o instalador assinado num rascunho `desktop-vX.Y.Z`. Precisa da aprovação do ambiente `windows-updater`.
3. Baixe o instalador do rascunho, teste, e publique o rascunho.
4. Rode **Promote signed Windows update** com a versão: ele atualiza o `desktop-latest` e os apps 2.0.1+ passam a oferecer a atualização.
5. Atualize `public/apps/versao.json` (versão e link do Windows) por PR, para o site avisar quem tem app antigo.
6. Anexe o instalador, renomeado para `Call-dos-Games-Windows-X.Y.Z.exe`, na próxima release do site.

A chave de assinatura nunca é gerada de novo: um app instalado só aceita atualização assinada pela mesma chave.

## Lançar uma versão do app de Android

1. Suba `VERSAO` e `versionCode` em `android/app/build.gradle`.
2. Gere com `cd android && ./gradlew assembleRelease`, usando a chave de `android/keystore/` (fora do git; sem ela o APK novo não instala por cima).
3. Anexe como `Call-dos-Games-Android-X.Y.Z.apk` na release do site e atualize o Android em `public/apps/versao.json`.
