import { describe, it, beforeEach, expect, vi } from 'vitest';
import { MessageBridge, IframeManager } from '../../src';


describe('MessageBridge', () => {
    let postMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessageSpy = vi.fn();

        vi.spyOn(IframeManager, 'connect').mockResolvedValue(undefined);
        vi.spyOn(IframeManager, 'postMessage').mockImplementation((id, message) => {
            const event = new MessageEvent('message', {
                data: message,
                origin: 'http://localhost',
                source: window,
            });
            window.dispatchEvent(event);
        });

        MessageBridge.init();
    });

    it('should send and receive a promise-based message (child -> parent)', async () => {
        const iframeId = 'test-iframe';

        MessageBridge.toParent().listenFor('ping').subscribe(({ request, source }) => {
            MessageBridge.toParent().respond(request.uid, { pong: true });
        });

        const result = await MessageBridge.toChild(iframeId).sendRequest('ping');
        expect(result).toEqual({ pong: true });
    });

    it('should send and receive a promise-based message (parent -> iframe)', async () => {
        vi.spyOn(window.parent, 'postMessage').mockImplementation((msg: any) => {
            const event = new MessageEvent('message', {
                data: msg,
                origin: 'http://localhost',
                source: window,
            });
            setTimeout(() => window.dispatchEvent(event), 10);
        });

        const action = 'test-request';

        MessageBridge.toParent().listenFor(action).subscribe(({ request, source }) => {
            MessageBridge.toParent().respond(request.uid, { ok: true });
        });

        const result = await MessageBridge.toChild('fake-id').sendRequest(action);
        expect(result).toEqual({ ok: true });
    });

    it('should send and receive observable-based messages (parent -> iframe)', async () => {
        const iframeId = 'test-iframe';
        const ticks = [1, 2, 3];

        const received: number[] = [];

        const sub = MessageBridge.toChild(iframeId).sendObservable<number>('tick').subscribe({
            next: (val) => received.push(val),
            complete: () => {
                expect(received).toEqual(ticks);
            }
        });

        for (const val of ticks) {
            const response = {
                uid: Array.from(MessageBridge['responseListeners'].keys())[0], // access the UID dynamically
                type: 'response',
                payload: val,
                done: false,
            };
            window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(response), source: window }));
        }

        // Simulate final 'done' response
        const uid = Array.from(MessageBridge['responseListeners'].keys())[0];
        const doneMsg = { uid, type: 'response', payload: null, done: true };
        window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(doneMsg), source: window }));

        sub.unsubscribe();
    }, 10000);

    it('should send and receive observable-based messages (iframe -> parent)', async () => {
        const ticks = ['a', 'b'];
        let index = 0;

        const action = 'letters';
        const fakeUid = 'abc123';

        MessageBridge.toParent().listenFor(action).subscribe(({ request }) => {
            const interval = setInterval(() => {
                const payload = ticks[index];
                MessageBridge.toParent().respond(request.uid, payload, index === ticks.length - 1);
                index++;
                if (index >= ticks.length) clearInterval(interval);
            }, 10);
        });

        const values: string[] = [];

        const sub = MessageBridge.toChild('fake-iframe').sendObservable<string>(action).subscribe({
            next: (val) => values.push(val),
            complete: () => {},
        });

        const request = {
            uid: fakeUid,
            type: 'request',
            action,
            mode: 'observable',
        };
        const event = new MessageEvent('message', {
            data: JSON.stringify(request),
            origin: 'http://localhost',
            source: window,
        });
        setTimeout(() => window.dispatchEvent(event), 20);

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                sub.unsubscribe();
                reject(new Error('Observable timeout'));
            }, 5000);

            const interval = setInterval(() => {
                if (values.length === ticks.length) {
                    clearTimeout(timeout);
                    clearInterval(interval);
                    sub.unsubscribe();
                    resolve();
                }
            }, 10);
        });

        expect(values).toEqual(ticks);
    }, 10000);
});