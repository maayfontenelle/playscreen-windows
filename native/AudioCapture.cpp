// PLAYSCREEN: capture only a selected process tree. No microphone or system fallback.
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>
#include <wrl/implements.h>
#include <vector>
#include <cstdio>
#include <cstdlib>
#include <io.h>
#include <fcntl.h>
using namespace Microsoft::WRL;
static HRESULT Check(HRESULT hr) { if (FAILED(hr)) { fwprintf(stderr,L"Falha de audio: 0x%08lX\n",(unsigned long)hr); } return hr; }
class Completion final : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IActivateAudioInterfaceCompletionHandler, FtmBase> {
public:
    HANDLE done = CreateEventW(nullptr,TRUE,FALSE,nullptr);
    HRESULT result = E_PENDING;
    ComPtr<IAudioClient> client;
    ~Completion() { CloseHandle(done); }
    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
        ComPtr<IUnknown> object;
        HRESULT activation = E_FAIL;
        result = operation->GetActivateResult(&activation,&object);
        if (SUCCEEDED(result)) result = activation;
        if (SUCCEEDED(result)) result = object.As(&client);
        SetEvent(done);
        return S_OK;
    }
};
int wmain(int argc,wchar_t** argv) {
    if (argc!=2) { fputs("Informe o PID do jogo.\n",stderr); return 1; }
    wchar_t* end=nullptr; unsigned long pid=wcstoul(argv[1],&end,10);
    if (!pid || !end || *end) return 1;
    if (FAILED(Check(CoInitializeEx(nullptr,COINIT_MULTITHREADED)))) return 2;
    AUDIOCLIENT_ACTIVATION_PARAMS params{};
    params.ActivationType=AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    params.ProcessLoopbackParams.TargetProcessId=pid;
    params.ProcessLoopbackParams.ProcessLoopbackMode=PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
    PROPVARIANT value{};value.vt=VT_BLOB;
    value.blob.cbSize=sizeof(params);value.blob.pBlobData=reinterpret_cast<BYTE*>(&params);
    auto completion=Make<Completion>();ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    HRESULT hr=ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,__uuidof(IAudioClient),&value,completion.Get(),&operation);
    if (FAILED(Check(hr))) return 3;
    if (WaitForSingleObject(completion->done,10000)!=WAIT_OBJECT_0) { fputs("Tempo limite ao abrir audio do aplicativo.\n",stderr);return 4; }
    if (FAILED(Check(completion->result))) return 5;
    auto client=completion->client;
    WAVEFORMATEX format{};format.wFormatTag=WAVE_FORMAT_PCM;format.nChannels=2;
    format.nSamplesPerSec=48000;format.wBitsPerSample=16;format.nBlockAlign=4;
    format.nAvgBytesPerSec=192000;
    hr=client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,200000,0,&format,nullptr);
    if (FAILED(Check(hr))) return 6;
    ComPtr<IAudioCaptureClient> capture;
    if (FAILED(Check(client->GetService(IID_PPV_ARGS(&capture))))) return 7;
    HANDLE audioEvent=CreateEventW(nullptr,FALSE,FALSE,nullptr);
    if(!audioEvent || FAILED(Check(client->SetEventHandle(audioEvent))))return 8;
    HANDLE target=OpenProcess(SYNCHRONIZE,FALSE,pid);
    if (!target) { fputs("Nao foi possivel abrir o jogo selecionado.\n",stderr);return 8; }
    _setmode(_fileno(stdout),_O_BINARY);setvbuf(stdout,nullptr,_IONBF,0);
    if (FAILED(Check(client->Start()))) { CloseHandle(target);return 9; }
    fputs("READY\n",stderr);fflush(stderr);
    std::vector<BYTE> silence;
    bool running=true;
    while(running && WaitForSingleObject(target,0)==WAIT_TIMEOUT) {
        WaitForSingleObject(audioEvent,20);
        UINT32 packet=0;
        if (FAILED(Check(capture->GetNextPacketSize(&packet)))) break;
        while(packet) {
            BYTE* data=nullptr;UINT32 frames=0;DWORD flags=0;
            if (FAILED(Check(capture->GetBuffer(&data,&frames,&flags,nullptr,nullptr)))) { running=false;break; }
            size_t bytes=static_cast<size_t>(frames)*format.nBlockAlign;
            if(flags&AUDCLNT_BUFFERFLAGS_SILENT) { silence.assign(bytes,0);data=silence.data(); }
            size_t written=fwrite(data,1,bytes,stdout);
            capture->ReleaseBuffer(frames);
            if(written!=bytes) { running=false;break; }
            if (FAILED(Check(capture->GetNextPacketSize(&packet)))) { running=false;break; }
        }

    }
    client->Stop();CloseHandle(target);CloseHandle(audioEvent);
    return running?0:10;
}
