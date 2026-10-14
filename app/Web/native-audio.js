(() => {
 if(!window.chrome?.webview)return;
 const host=window.chrome.webview;
 let context,node,destination,nativeTrack=null,session=null,preparing=false,prepared;
 const baseOutgoing=outgoingAudioTrack;
 outgoingAudioTrack=()=>stream&&nativeTrack?.readyState==='live'?nativeTrack:baseOutgoing();
 copyRoomLink=async()=>{const url=new URL('https://maayfontenelle.github.io/playscreen/');url.searchParams.set('sala',currentRoom);try{await navigator.clipboard.writeText(url.href);notify('Link do site copiado.')}catch{notify(url.href)}};
 const capture=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
 navigator.mediaDevices.getDisplayMedia=options=>capture({...options,audio:false,systemAudio:'exclude',windowAudio:'exclude'});
 $('shareSoundMode').replaceChildren();for(const [value,label] of [['native','Som somente da guia de vídeo'],['none','Sem som']]){const option=document.createElement('option');option.value=value;option.textContent=label;$('shareSoundMode').append(option)}
 $('nativeAudioStop').hidden=true;
 const originalStop=stopShare;stopShare=async(...args)=>{stop();return originalStop(...args)};
 async function prepare(){
  if(preparing)return prepared;
  preparing=true;
  prepared=(async()=>{
   if(!context||context.state==='closed'){
    context=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    const resumed=context.resume(); // Start directly from the share button's user gesture.
    if(context.sampleRate!==48000)throw Error('O dispositivo não aceitou áudio a 48 kHz.');
    await context.audioWorklet.addModule('pcm-worklet.js');
    node=new AudioWorkletNode(context,'playscreen-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    await resumed;
   }else await context.resume();
   if(!destination||destination.stream.getAudioTracks()[0].readyState!=='live'){node.disconnect();destination=context.createMediaStreamDestination();node.connect(destination)}
  })();
  try{await prepared}finally{preparing=false}
 }
 async function start(){await prepare();host.postMessage({kind:'choose-tab'});$('topAudioStatus').textContent='Abrindo a guia de vídeo. Cole o link e dê play.';}
 function stop(){host.postMessage({kind:'stop-app'});nativeTrack?.stop();nativeTrack=null;session=null;node?.port.postMessage({clear:true});$('nativeAudioStop').hidden=true;$('topAudioStatus').textContent='Som desligado.';updateTracks().catch(()=>{})}
 window.playscreenNative={prepare,start,stop};
 host.addEventListener('message',async({data:m})=>{
  if(m.kind==='native-ready'){
   if(!stream){stop();return;}
   session=m.session;nativeTrack=destination.stream.getAudioTracks()[0];node.port.postMessage({clear:true});$('nativeAudioStop').hidden=false;
   $('topAudioStatus').textContent='Guia conectada. Abra o vídeo na janela própria e dê play.';
   try{await updateTracks()}catch(e){stop();notify(e.message)}
  }else if(m.kind==='native-pcm'&&m.session===session&&nativeTrack){
   const bytes=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));node.port.postMessage({pcm:bytes.buffer},[bytes.buffer]);
   $('topAudioStatus').textContent='Recebendo som da guia de vídeo.';
  }else if(['native-error','native-ended'].includes(m.kind)){stop();$('topAudioStatus').textContent=m.message||'Captura de áudio encerrada.';if(m.message)notify(m.message)}
 });
 window.addEventListener('beforeunload',stop);
})();
