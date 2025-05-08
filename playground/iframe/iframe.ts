

// Init the bridge in the iframe
import {MessageBridge} from "../../src";
console.log('playground/iframe.ts');

MessageBridge.init('child-frame');

let ticks = 0;

MessageBridge.parent().listenFor('tick').subscribe(({ request, source }) => {
    console.log('[iframe] Tick received:', request.payload);
    ticks++;
    // @ts-ignore
    document.getElementById('tick-info').innerHTML =`Ticks: ${ticks}`;
    MessageBridge.parent().respond(request.uid, { received: true }, false);
});