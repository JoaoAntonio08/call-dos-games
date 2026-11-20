# Atualizações Windows

O comando de atualização do cliente retorna um erro até o projeto configurar a assinatura. O cliente novo não baixa ou executa instaladores por esse comando. Clientes antigos precisam de substituição por um instalador obtido por um canal confiável.

Para habilitar o [updater oficial do Tauri 2](https://v2.tauri.app/plugin/updater/), configure a chave pública do projeto em `plugins.updater.pubkey` e um endpoint HTTPS fixo do projeto. Guarde a chave privada exclusivamente nos segredos do processo de publicação. Gere os bundles com `bundle.createUpdaterArtifacts`, publique os artefatos assinados junto com os metadados esperados pelo plugin e faça a verificação e instalação pelo plugin nativo.

Antes de publicar, teste no Windows uma atualização válida e confirme a rejeição de um artefato adulterado, de uma assinatura ausente e de uma assinatura feita com outra chave.
