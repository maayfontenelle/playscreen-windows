using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PlayScreen;
internal static class Program {
    [STAThread] static void Main() {
        using var mutex=new Mutex(true,"Local\\PLAYSCREEN.VideoTab",out bool first);
        if(!first){MessageBox.Show("O PLAYSCREEN já está aberto. Use a janela existente.");return;}
        ApplicationConfiguration.Initialize();Application.Run(new MainWindow());
    }
}
sealed class MainWindow : Form {
    const string Origin="https://playscreen.local";
    readonly WebView2 web=new(){Dock=DockStyle.Fill};
    Process? capture;
    CancellationTokenSource? captureCancellation;
    long sequence;
    bool choosing;
    VideoTab? videoTab;
    public MainWindow() {
        Text="PLAYSCREEN • Windows • versão de teste";Width=1280;Height=850;
        MinimumSize=new Size(700,500);Controls.Add(web);
        Shown+=async (_,_)=>await Initialize();
        FormClosing+=(_,_)=>{StopCapture();videoTab?.Close();};
    }
    async Task Initialize() {
        try {
            if(!OperatingSystem.IsWindowsVersionAtLeast(10,0,22000))throw new Exception("Esta versão foi preparada para Windows 11.");
            var data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PLAYSCREEN","Browser");
            var env=await CoreWebView2Environment.CreateAsync(null,data);
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("playscreen.local",Path.Combine(AppContext.BaseDirectory,"Web"),CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.Settings.AreHostObjectsAllowed=false;
            web.CoreWebView2.NavigationStarting+=(_,e)=>{
                if(!IsTrusted(e.Uri)) {e.Cancel=true;StopCapture();}
            };
            web.CoreWebView2.NewWindowRequested+=(_,e)=>e.Handled=true;
            web.CoreWebView2.WebMessageReceived+=async (_,e)=>{
                if(!IsTrusted(e.Source))return;
                try {
                    using var json=JsonDocument.Parse(e.WebMessageAsJson);
                    var root=json.RootElement;var command=root.GetProperty("kind").GetString();
                    if(command=="choose-tab"&&!choosing){choosing=true;try{await CaptureVideoTab();}finally{choosing=false;}}
                    else if(command=="stop-app")StopCapture();
                }catch(Exception ex){Send(new{kind="native-error",message=ex.Message});}
            };
            web.CoreWebView2.PermissionRequested+=(_,e)=>{
                // Camera is permitted through the regular prompt; no automatic microphone grants.
                if(!IsTrusted(e.Uri))e.State=CoreWebView2PermissionState.Deny;
            };
            web.Source=new Uri(Origin+"/index.html");
        }catch(Exception ex){MessageBox.Show(this,"Não foi possível abrir o PLAYSCREEN.\n\n"+ex.Message+"\n\nConfira se o Microsoft Edge WebView2 Runtime está instalado.","PLAYSCREEN");Close();}
    }
    static bool IsTrusted(string address)=>Uri.TryCreate(address,UriKind.Absolute,out var uri)&&uri.Scheme=="https"&&uri.Host=="playscreen.local"&&uri.IsDefaultPort;
    void Send(object message) {
        if(!IsDisposed&&web.CoreWebView2!=null)web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }
    void StopCapture() {
        ++sequence;
        captureCancellation?.Cancel();captureCancellation?.Dispose();captureCancellation=null;
        var old=capture;capture=null;
        if(old!=null){try{if(!old.HasExited)old.Kill(true);}catch{}old.Dispose();}
    }
    async Task CaptureVideoTab() {
        if(videoTab==null||videoTab.IsDisposed){
            videoTab=new VideoTab();
            videoTab.FormClosed+=(_,_)=>{StopCapture();Send(new{kind="native-ended",message="A guia de vídeo foi fechada."});};
            videoTab.Show(this);
            await videoTab.Initialize();
        }else{videoTab.Show();videoTab.Activate();}
        uint targetPid=videoTab.BrowserProcessId;
        if(targetPid==0)throw new Exception("A guia de vídeo ainda não está pronta.");
        if(targetPid==web.CoreWebView2.BrowserProcessId)throw new Exception("O navegador não separou a guia do painel. A captura foi recusada para evitar eco.");
        StopCapture();long current=sequence;
        var exe=Path.Combine(AppContext.BaseDirectory,"PlayScreenAudio.exe");
        if(!File.Exists(exe))throw new Exception("PlayScreenAudio.exe não foi encontrado na pasta do programa.");
        var processCapture=new Process{StartInfo=new ProcessStartInfo(exe){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}};
        processCapture.StartInfo.ArgumentList.Add(targetPid.ToString());
        captureCancellation=new CancellationTokenSource();var token=captureCancellation.Token;
        capture=processCapture;
        if(!processCapture.Start())throw new Exception("Não foi possível iniciar a captura da guia.");
        string? ready;
        try{ready=await processCapture.StandardError.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(12));}
        catch{StopCapture();throw new Exception("A captura da guia não iniciou. Confira a instalação do WebView2 e tente novamente.");}
        if(ready!="READY"){StopCapture();throw new Exception("Não foi possível capturar o som da guia. "+ready);}
        if(current!=sequence)return;
        Send(new{kind="native-ready",session=current,name="guia de vídeo do PLAYSCREEN"});
        // Drain stderr immediately to prevent a blocked native process.
        var errors=processCapture.StandardError.ReadToEndAsync();
        try {
            var packet=new byte[1920]; // 10 ms PCM16 / 48 kHz / stereo
            while(!token.IsCancellationRequested){
                int offset=0;
                while(offset<packet.Length){int count=await processCapture.StandardOutput.BaseStream.ReadAsync(packet.AsMemory(offset),token);if(count==0)break;offset+=count;}
                if(offset==0)break;
                if(current!=sequence)break;
                Send(new{kind="native-pcm",session=current,data=Convert.ToBase64String(packet,0,offset)});
                if(offset!=packet.Length)break;
            }
            if(current==sequence){await processCapture.WaitForExitAsync(token);var details=await errors;Send(new{kind="native-ended",message=processCapture.ExitCode==0?"A guia foi fechada. A captura de áudio terminou.":"A captura do áudio da guia falhou. "+details});}
        }catch(OperationCanceledException){}catch(ObjectDisposedException){}catch(Exception ex){if(current==sequence)Send(new{kind="native-error",message=ex.Message});}
        finally{if(current==sequence)StopCapture();}
    }
 }
// A separate WebView2 environment gives this video tab its own browser process tree.
// The native helper captures this tree, never the main player or external Chrome/Discord.
sealed class VideoTab : Form {
    readonly WebView2 browser=new(){Dock=DockStyle.Fill};
    readonly TextBox address=new(){Dock=DockStyle.Fill,Text="https://www.youtube.com/"};
    public uint BrowserProcessId=>browser.CoreWebView2?.BrowserProcessId??0;
    public VideoTab(){
        Text="PLAYSCREEN • Guia de vídeo • som separado";Width=1100;Height=720;
        var bar=new Panel{Dock=DockStyle.Top,Height=44,Padding=new Padding(6)};
        var go=new Button{Dock=DockStyle.Right,Width=100,Text="Abrir"};
        bar.Controls.Add(address);bar.Controls.Add(go);Controls.Add(browser);Controls.Add(bar);
        go.Click+=(_,_)=>Navigate();address.KeyDown+=(_,e)=>{if(e.KeyCode==Keys.Enter){e.SuppressKeyPress=true;Navigate();}};
    }
    public async Task Initialize(){
        var folder=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"PLAYSCREEN","VideoTab");
        var environment=await CoreWebView2Environment.CreateAsync(null,folder);
        await browser.EnsureCoreWebView2Async(environment);
        browser.CoreWebView2.Settings.IsWebMessageEnabled=false;
        browser.CoreWebView2.Settings.AreHostObjectsAllowed=false;
        browser.CoreWebView2.NewWindowRequested+=(_,e)=>e.Handled=true;
        browser.CoreWebView2.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
        browser.CoreWebView2.NavigationStarting+=(_,e)=>{if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out var u)||u.Scheme!="https")e.Cancel=true;};
        Navigate();
    }
    void Navigate(){
        if(browser.CoreWebView2==null)return;
        if(Uri.TryCreate(address.Text.Trim(),UriKind.Absolute,out var url)&&url.Scheme=="https")browser.Source=url;
        else MessageBox.Show(this,"Cole um endereço completo começando com https://", "Guia de vídeo");
    }
}
