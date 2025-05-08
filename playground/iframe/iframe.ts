import {MessageBridge} from "../../src";
MessageBridge.init({debug: true});

let ticks = 0;

MessageBridge.toParent().listenFor('tick').subscribe(({ request, source }) => {
    console.log('[iframe] Tick received:', request.payload);
    ticks++;
    // @ts-ignore
    document.getElementById('tick-info').innerHTML =`Ticks: ${ticks}`;
    MessageBridge.toParent().respond(request.uid, { received: true }, false);
});