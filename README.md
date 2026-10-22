<p align="center">
  <img src="assets/logo.png" width="144" alt="Logo do YouTube Fast Skipper">
</p>

<h1 align="center">YouTube Fast Skipper</h1>

<p align="center"><strong>Uma alternativa aos bloqueadores: controle os anúncios no próprio player.</strong></p>

Extensão para Chrome que controla anúncios e velocidade no YouTube. Sem conta,
servidor ou dependências em execução. Instalação manual com Manifest V3.

## Outra forma de lidar com anúncios

**O YouTube Fast Skipper não é um bloqueador de propaganda tradicional.**
Ele mantém o carregamento dos anúncios e oferece controle sobre a reprodução:
silenciar, acelerar se você quiser e acionar o botão Pular quando disponível.
Não intercepta requisições de publicidade nem usa listas de bloqueio.

A proposta é conciliar o conforto de quem assiste com a continuidade da
exibição de publicidade nos canais. Isso não comprova que a receita do criador
seja preservada: a cobrança varia por formato e campanha. Em anúncios com
cobrança por visualização, por exemplo, o Google considera tempo assistido ou
interação. Portanto, não prometemos impacto zero na monetização ao pular ou
acelerar anúncios. [Como funciona a cobrança dos anúncios em vídeo](https://support.google.com/google-ads/answer/2375464?hl=pt-BR).

## Recursos

- Aciona o botão **Pular** quando ele estiver disponível e habilitado.
- Silencia anúncios e restaura o estado anterior do áudio, sem alterar o volume.
- Permite escolher se os anúncios serão acelerados a **16×** ou reproduzidos a **1×**.
- Restaura a velocidade escolhida para o vídeo após cada anúncio.
- Controla a velocidade entre **0,25× e 16×**, com atalhos e preferência salva.
- Oferece configurações no ícone do Chrome e na engrenagem dentro do vídeo.
- Inclui diagnóstico copiável para investigar falhas no pulo.

Isso não bloqueia o carregamento de anúncios nem libera botões antes do prazo.
Mudanças no player do YouTube podem exigir atualizações da extensão.

## Painel

<img src="docs/popup.png" width="350" alt="Painel do YouTube Fast Skipper com controles de pulo, áudio e aceleração">

Prévia local com o painel expandido. No Chrome, o popup permite rolar as opções.

## Instalação

Requer **Chrome 120 ou superior**. Não é necessário Node.js para usar a extensão.

1. Baixe o código pelo botão **Code → Download ZIP** do GitHub, ou um ZIP da extensão em Releases, se disponível.
2. Extraia o ZIP para uma pasta permanente.
3. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
4. Selecione **Carregar sem compactação** e escolha a pasta que contém `manifest.json`.
5. Confirme as permissões solicitadas pelo Chrome e atualize a página do YouTube.

Para atualizar, substitua os arquivos na mesma pasta, clique em **Recarregar** na
extensão e atualize as abas do YouTube. Mantenha uma única cópia ativa.
Se estiver atualizando a antiga Video Turbo, use sua pasta já instalada para
preservar a identidade da extensão e as preferências.

## Configurações

| Opção | Comportamento |
| --- | --- |
| Pular automaticamente | Habilita ou desabilita as tentativas automáticas de pulo. |
| Pular Anúncios | Usa o clique do navegador para compatibilidade com botões que ignoram cliques por script. Depende de Pular automaticamente. |
| Silenciar anúncios | Mantém o anúncio mudo e restaura o estado anterior ao terminar. |
| Acelerar anúncios | Ligada: 16× durante anúncios. Desligada: 1×. A velocidade do conteúdo fica preservada. |
| Lembrar velocidade | Salva a velocidade preferida para os próximos vídeos. |
| Passo dos controles | Define o incremento dos botões e atalhos. |

As opções de anúncios vêm ligadas por padrão. Escolhas salvas, inclusive opções
desligadas, continuam sendo respeitadas após a atualização.

No painel do vídeo, `<<` e `>>` alteram a velocidade. Clicar no número volta a 1×.
O campo na engrenagem aceita uma velocidade personalizada. Durante anúncios,
esses ajustes definem a velocidade de retorno para o conteúdo.
Use `+` ou `=` para aumentar e `-` para diminuir; atalhos são ignorados em campos
de texto. O painel acompanha a visibilidade da barra de progresso nativa.

## Por que aparece uma barra de depuração?

**Pular Anúncios** usa `chrome.debugger` para produzir um clique do próprio
navegador. Esse mecanismo foi adotado porque alguns botões ignoram eventos
gerados por JavaScript. Enquanto ele é usado, o Chrome pode mostrar uma barra
indicando a depuração. A extensão desconecta a sessão ao concluir cada tentativa.

A extensão não pode ocultar esse aviso pelas APIs normais. Fechar a barra pode
encerrar a sessão; nesse caso, o cancelamento é respeitado até reativar a opção
ou recarregar a extensão. Há uma opção de inicialização do Chrome voltada a
ferramentas de desenvolvimento que suprime o aviso, mas isso depende de como o
navegador é iniciado, não de uma configuração distribuída pela extensão.

Para deixar de usar esse mecanismo, desligue **Pular Anúncios**. O clique por
script continua disponível se **Pular automaticamente** estiver ligado, mas
pode não funcionar em alguns anúncios. Silenciamento, velocidade e as demais
configurações continuam independentes.

Referências: [API de depuração](https://developer.chrome.com/docs/extensions/reference/api/debugger)
e [opções para ferramentas do Chrome](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md).

## Permissões e privacidade

| Permissão | Uso |
| --- | --- |
| `storage` | Salvar configurações localmente neste perfil do navegador. |
| `debugger` | Enviar o clique do navegador no botão Pular. É uma permissão ampla; as restrições abaixo são verificadas pelo código. |
| `https://www.youtube.com/*` | Executar no YouTube e verificar o endereço da aba antes do clique. |

O worker verifica remetente, quadro principal, endereço, aba ativa, janela em
foco, anúncio, alvo habilitado e visível, centro livre e intervalo entre
tentativas. Não mantém a depuração conectada entre as tentativas.

A extensão não envia dados para servidores, não inclui telemetria e não usa
cookies ou histórico. O diagnóstico fica na memória da aba e só sai dela se
você o copiar e compartilhar. Ele contém estado, versão e dados dos candidatos
ao clique; não inclui a URL da página. As dependências npm são apenas de teste
e não são carregadas pela extensão.

Funciona no quadro principal de `www.youtube.com`; não atua no aplicativo móvel
ou em vídeos incorporados em outros sites. Em janela anônima, é necessário
permitir a execução da extensão nas configurações do Chrome.

## Desenvolvimento e testes

Requer **Node.js 22.12+** (recomendado: 24) e npm. Para gerar o ZIP, Python 3.9+.

```sh
npm ci --ignore-scripts
npm run check
npm test
python scripts/package.py
```

O ZIP instalável fica em `dist/youtube-fast-skipper-2.9.1.zip`. O empacotamento
usa uma lista explícita de arquivos: testes, dependências e arquivos pessoais
ficam fora do pacote. Não há etapa de compilação para executar a extensão.
O arquivo `dist/youtube-fast-skipper-source-2.9.1.zip` reúne os fontes e a
documentação para envio ao GitHub, sem dependências instaladas ou histórico local.

Os testes cobrem áudio e restauração, seleção de botões, tentativas, proteções
do worker, preferências e interfaces. São testes locais com DOM e APIs simulados;
não comprovam, por si só, o resultado em anúncios reais. Após mudanças no player,
confira manualmente pulo, áudio e velocidade no YouTube.

O GitHub Actions executa as verificações e gera um artefato ZIP em pushes e pull
requests. Para contribuir ou publicar uma versão, veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE). Projeto independente, sem afiliação com YouTube ou Google.
