import {MessageBridge} from "../src";
console.log('playground/parent.ts');

MessageBridge.init('parent-frame');

// Setup
const iframe = document.getElementById('child-frame') as HTMLIFrameElement;

const sendTick = () => {
    MessageBridge.child(iframe).sendObservable('tick', {
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

setInterval(() => {
    console.log('[parent] Tick triggered');
    sendTick()
}, 20000);

console.log('[parent] Tick initialized');
sendTick()