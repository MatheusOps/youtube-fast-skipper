# Contribuindo

Use Node.js 22.12+ (24 recomendado). Instale as dependências com
`npm ci --ignore-scripts`, execute `npm run check` e `npm test`.
Os arquivos da extensão são carregados diretamente; não existe build obrigatório.

## Estrutura

- `manifest.json`: versão, permissões e pontos de entrada.
- `content.js`: controles, velocidade, áudio e detecção do botão Pular.
- `background.js`: clique do navegador e suas verificações.
- `popup.*`: configurações e diagnóstico no ícone do Chrome.
- `anuncio.css`: aparência da barra durante anúncios.
- `icons/`: ícones usados pelo Chrome e pelo popup.
- `assets/`: logo original fornecida para o projeto.
- `tests/`: cenários locais com DOM e APIs simulados.
- `scripts/`: validação e empacotamento reproduzível.

## Alterações

Preserve as verificações de remetente, endereço, foco, alvo, cancelamento e
limpeza no worker. Não mantenha sessões de depuração abertas entre tentativas.
Evite dependências e requisições de rede no código distribuído.

Adicione testes para mudanças de comportamento. Nos relatos de falha, informe
as versões do Chrome e da extensão, os passos e, quando útil, o diagnóstico
copiável. Revise o texto antes de compartilhá-lo e não inclua dados pessoais.

Faça uma conferência manual após atualizar a extensão e recarregar a aba:

1. Anúncio inicialmente com som e vídeo inicialmente já mudo.
2. Restauração do áudio e da velocidade depois do anúncio.
3. Acelerar anúncios ligado e desligado, inclusive durante um anúncio.
4. Botão Pular habilitado, contagem regressiva e anúncios consecutivos.
5. Opções alteradas no popup e na engrenagem permanecendo sincronizadas.

## Publicação no GitHub

O diretório que contém este arquivo é a raiz do repositório. Nome sugerido:
`youtube-fast-skipper`. Envie os fontes, testes, documentação e `package-lock.json`.
`node_modules/` e `dist/` são ignorados pelo Git.

Antes de uma versão, sincronize o número em `manifest.json`, `package.json`,
`content.js` e `popup.html`, atualize o lockfile e o changelog. Execute as
verificações e `python scripts/package.py`. O ZIP em `dist/` pode ser anexado
manualmente a uma Release; não é preciso publicar na Chrome Web Store.
O ZIP com `source` no nome reúne o repositório para compartilhamento; o outro
contém somente a extensão instalável e seus arquivos de instrução/licença.

O workflow valida pull requests e pushes com acesso de leitura ao repositório,
e disponibiliza o ZIP como artefato. Ele não cria Releases nem publica código
automaticamente em outros serviços.
