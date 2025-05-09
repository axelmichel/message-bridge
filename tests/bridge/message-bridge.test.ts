import { describe, it, beforeEach, expect, vi } from 'vitest';
import { MessageBridge } from '../../src';
import { IframeManager } from '../../src/bridge/iframe-manager';

const mockWindowMap = new Map<string, Window>();

vi.mock('../../src/bridge/window-manager', () => ({
    WindowManager: {
        connect: vi.fn(() => Promise.resolve()),
        register: vi.fn((name: string, win: Window) => mockWindowMap.set(name, win)),
        postMessage: vi.fn((name: string, message: any) => {
            const win = mockWindowMap.get(name);
            win?.postMessage(message, '*');
        }),
    },
}));

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

    it('should send and receive message using toWindow (window.open)', async () => {
        const mockWindow = {
            postMessage: vi.fn((msg: string) => {
                // simulate response
                const parsed = JSON.parse(msg);
                if (parsed.type === 'request') {
                    const response = {
                        uid: parsed.uid,
                        type: 'response',
                        payload: { reply: 'hi' },
                    };
                    // simulate receiving the message
                    setTimeout(() => {
                        window.dispatchEvent(new MessageEvent('message', {
                            data: JSON.stringify(response),
                            origin: 'http://localhost',
                            source: mockWindow,
                        }));
                    }, 10);
                }
            }),
        } as unknown as Window;

        mockWindowMap.set('popup-1', mockWindow);

        MessageBridge.init(); // in case not already initialized

        const result = await MessageBridge.toWindow(mockWindow).sendRequest('hello');
        expect(result).toEqual({ reply: 'hi' });
    });

    it('should broadcast a request to multiple iframes', async () => {
        const iframeIds = ['iframe1','iframe2'];
        vi.spyOn(IframeManager, 'getAllIframeIds').mockReturnValue(iframeIds);

        MessageBridge.toParent().listenFor('ping').subscribe(({ request, source }) => {
            MessageBridge.toParent().respond(request.uid, { pong: true });
        });


        const result = await MessageBridge.broadcastRequest('ping', {});
        expect(result).toEqual({"iframe1": {"pong": true}, "iframe2": {"pong": true}});
    });

    it('should broadcast observable messages to multiple iframes', async () => {
        const iframeIds = ['iframe1', 'iframe2'];
        vi.spyOn(IframeManager, 'getAllIframeIds').mockReturnValue(iframeIds);

        const values: { iframeId: string; value: string }[] = [];
        const sub = MessageBridge.broadcastObservable<string>('stream').subscribe((msg) => values.push(msg));

        iframeIds.forEach((id) => {
            const uid = Array.from(MessageBridge['responseListeners'].keys()).find((key) => key.includes(id)) ?? `${id}_uid`;
            const response = {
                uid,
                type: 'response',
                payload: `tick-${id}`,
                done: false,
            };
            setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(response), source: window })), 10);
        });

        await new Promise((res) => setTimeout(res, 20));
        sub.unsubscribe();

        expect(values).toContainEqual({ iframeId: 'iframe1', value: 'tick-iframe1' });
        expect(values).toContainEqual({ iframeId: 'iframe2', value: 'tick-iframe2' });
    });


    it('should connect to multiple iframes', async () => {
        const iframe = document.createElement('iframe');
        const iframe2 = document.createElement('iframe');
        iframe.id = 'frame1';
        iframe2.id = 'frame2';
        document.body.appendChild(iframe);
        document.body.appendChild(iframe2);

        const connectSpyIframe = vi.spyOn(IframeManager, 'connect').mockResolvedValue();

        await MessageBridge.connect([iframe, iframe2]);

        expect(connectSpyIframe).toHaveBeenCalledWith(iframe, expect.any(Number));
        expect(connectSpyIframe).toHaveBeenCalledWith(iframe2, expect.any(Number));
    });
});