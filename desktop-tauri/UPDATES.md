# Atualizações do cliente Windows

O cliente 2.0.1 consulta o manifesto fixo `https://github.com/JoaoAntonio08/call-dos-games/releases/download/desktop-latest/latest.json`. Esse endereço é separado das releases do site, que podem ser publicadas depois do cliente Windows. O plugin oficial do Tauri 2 compara versões, exige assinatura válida do instalador e verifica se a versão assinada corresponde à anunciada antes de instalar. O site não fornece URLs ao atualizador nativo. A verificação ocorre na abertura; o menu da bandeja permite verificar e instalar manualmente. A instalação pede confirmação em uma janela nativa do Windows. Só o site configurado pode chamar os comandos nativos. O progresso também é enviado à interface web existente.

Sem `CDG_UPDATER_PUBKEY` no **build** do cliente, a atualização permanece desativada. O código nunca aceita instalador sem assinatura. Isso é intencional até a chave e a publicação estarem prontas.

## Preparação da assinatura

1. O proprietário autoriza a criação de um par de chaves exclusivo do updater. Gerar com o Tauri CLI `tauri signer generate`, fora do repositório. Fazer cópia protegida da chave privada; sua perda impede futuras atualizações dos clientes que confiam nessa chave.
2. Guardar a chave privada no segredo `TAURI_SIGNING_PRIVATE_KEY` do ambiente GitHub `windows-updater` e a senha, se houver, em `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Colocar **somente** a chave pública em `CDG_UPDATER_PUBKEY` como variável do repositório. Não guardar chaves em commits ou logs.
3. Proteger o ambiente `windows-updater` com aprovação de publicação. Rodar a verificação de Windows no PR. Depois do merge, disparar manualmente `Build signed Windows draft` na `main`.
4. O workflow cria apenas uma release **rascunho**. Conferir versão 2.0.1, instalador NSIS, artefato updater, arquivo `.sig`, conteúdo e URLs de `latest.json`. Conferir que a chave pública embutida no executável corresponde à privada que assinou o artefato.
5. Testar em uma VM Windows isolada: atualização válida, manifesto inválido, artefato adulterado, assinatura ausente/incorreta, versão igual/inferior, falha de rede, download interrompido, confirmação negada e instalação/reinício. Só publicar a release versionada depois dessas verificações e aprovação do proprietário.
6. Disparar manualmente `Promote signed Windows update` com a versão publicada. O workflow confere o manifesto e grava somente `latest.json` na release fixa `desktop-latest`, marcada como pré-release para não substituir a release geral do projeto.

O cliente 2.0.0 anterior tem o atualizador inseguro desativado. Ele não receberá a versão 2.0.1 automaticamente; usuários existentes devem instalar manualmente o primeiro cliente assinado a partir de um canal confiável. Não reativar o fluxo antigo para essa transição.

Não usar build Linux como evidência de funcionamento do instalador Windows. O workflow de PR verifica a compilação e testes Rust no Windows, inclusive uma assinatura Tauri de arquivo sintético e rejeição de adulterações. A instalação real precisa do teste separado acima.
