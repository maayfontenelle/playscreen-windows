(() => {
  if (!window.chrome?.webview) return;
  let context, node, destination, nativeTrack=null, session=null, initializing=false;
  const host=window.chrome.webview;
  copyRoomLink=async function(){
    const url=new URL('https://maayfontenelle.github.io/playscreen/');url.searchParams.set('sala',currentRoom);
    try{await navigator.clipboard.writeText(url.href);notify('Link do site copiado. Funciona no computador e no celular.');}
    catch{notify('Link para seus amigos: '+url.href);}
  };
  const nativeDisplay=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia=options=>nativeDisplay({...options,audio:false,systemAudio:'exclude',windowAudio:'exclude'});
  const baseOutgoing=outgoingAudioTrack;
  outgoingAudioTrack=function(){return stream&&nativeTrack?.readyState==='live'?nativeTrack:baseOutgoing();};
  const originalStop=stopShare;
  stopShare=function(...args){stopNative();return originalStop(...args);};
  const actions=document.querySelector('.audio-actions');
  const row=document.createElement('div');
  const start=document.createElement('button');start.className='primary';start.textContent='Som da guia de vídeo';
  const stop=document.createElement('button');stop.className='secondary';stop.textContent='Parar som da guia';stop.hidden=true;
  const status=document.createElement('small');status.textContent='Abre uma guia de vídeo separada no programa. Cole o link do vídeo nela; o Discord fica fora da captura.';
  row.append(start,stop);actions?.prepend(row);actions?.append(status);
  // Whole-system audio is unsuitable for this use case.
  for(const id of ['systemAudioButton','tabAudioButton','stopTabAudio'])document.getElementById(id)?.setAttribute('hidden','');
  start.onclick=async()=>{
    if(initializing)return;initializing=true;start.disabled=true;
    try{await setup();await context.resume();host.postMessage({kind:'choose-tab'});status.textContent='Abrindo a guia de vídeo. Cole o link nela e dê play.';}
    catch(e){notify(e.message);initializing=false;start.disabled=false;}
  };
  stop.onclick=async()=>{stopNative();await updateTracks();renderAudioStatus();};
  function stopNative(){
    host.postMessage({kind:'stop-app'});nativeTrack?.stop();nativeTrack=null;session=null;
    node?.port.postMessage({clear:true});stop.hidden=true;initializing=false;start.disabled=false;
    status.textContent='Som da guia desligado. A guia de vídeo pode continuar aberta.';
  }
  async function setup(){
    if(context&&context.state!=='closed'){
      if(destination?.stream.getAudioTracks()[0]?.readyState==='live')return;
      node?.disconnect();destination=context.createMediaStreamDestination();node.connect(destination);return;
    }
    context=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    if(context.sampleRate!==48000){await context.close();throw Error('O dispositivo não aceitou áudio a 48 kHz.');}
    await context.audioWorklet.addModule('pcm-worklet.js');
    node=new AudioWorkletNode(context,'playscreen-pcm',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
    destination=context.createMediaStreamDestination();node.connect(destination);
    // Do not connect to speakers: the video tab already plays its own sound.
  }
  host.addEventListener('message',async({data:m})=>{
    if(m.kind==='native-ready'){
      session=m.session;nativeTrack=destination.stream.getAudioTracks()[0];
      node.port.postMessage({clear:true});stop.hidden=false;status.textContent='Som somente da guia de vídeo do PLAYSCREEN. Abra o vídeo nela e dê play.';
      initializing=false;start.disabled=false;
      try{await updateTracks();}catch(e){stopNative();notify(e.message);}
    }else if(m.kind==='native-pcm'&&m.session===session&&nativeTrack){
      const bytes=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));
      node.port.postMessage({pcm:bytes.buffer},[bytes.buffer]);
    }else if(['native-error','native-ended','native-cancel'].includes(m.kind)){
      stopNative();try{await updateTracks();}catch{}if(m.message)notify(m.message);
    }
  });
  window.addEventListener('beforeunload',()=>stopNative());
})();
