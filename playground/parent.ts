import {MessageBridge} from "../src";

MessageBridge.init({debug: true});

const iframe = document.getElementById('child-frame') as HTMLIFrameElement;


const sendTick = () => {
    MessageBridge.toChild(iframe).sendObservable('tick', {
        time: new Date().toISOString(),
    }).subscribe({
        next: (res) => {
            console.log('[parent] Tick ack from iframe:', res);
        },
        error: (err) => {
            console.error('[parent] Tick failed:', err);
        },
    });
}


MessageBridge.connect(iframe).then(() => {
    console.log('[parent] Iframe connected');
    MessageBridge.toChild(iframe).sendRequest('ping').then((res) => {
        console.log('[parent] Ping response from iframe:', res);
    });

    sendTick();

    setInterval(() => {
        console.log('[parent] Tick triggered');
        sendTick()
    }, 20000);

})