# PLAYSCREEN — aplicativo Windows e site para espectadores

Projeto experimental para Windows 11 x64. Ainda não compilado nem testado em
Windows neste ambiente. Não contém executável pronto. Consulte COMO-GERAR.txt.

O aplicativo abre uma janela dedicada de vídeo em WebView2. Seu perfil de
navegador é distinto do perfil do painel, gerando um processo separado. Um
helper C++ captura a árvore desse processo via Application Loopback do Windows,
com PCM16 stereo 48 kHz. O áudio é entregue a um AudioWorklet e a uma faixa
MediaStream, substituindo o sender de áudio WebRTC existente. Não há captura
padrão do microfone, mistura com o Discord ou fallback para áudio do sistema.
O helper só é iniciado por uma ação explícita do usuário e encerra junto da
captura, da guia ou do aplicativo.

Apenas o HTML local confiável pode solicitar a captura ao host nativo. A janela
com páginas externas não tem canal de mensagens nativas habilitado. Os convites
copiam o URL público do GitHub Pages, não o endereço local do aplicativo.

Os testes JS simulam sinalização, controles de reprodução e o buffer PCM. Não
substituem testes de captura real, negociação de codecs, sites de vídeo, redes
restritas ou reprodução em celulares. STUN continua igual ao site existente;
TURN e SFU não foram adicionados. A qualidade e os limites de bitrate continuam
manuais. Não há ajuste específico de codificação por GPU.

Build no Windows: CMake + MSVC/Windows SDK moderno para native, .NET 8 SDK para
app. A receita em .github/workflows/windows.yml usa um runner Windows e gera
um download com todos os arquivos necessários. WebView2 Runtime deve existir
no PC de destino. Sem assinatura de código e sem instalador nesta versão.

Referências de implementação:
- https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.browserprocessid
