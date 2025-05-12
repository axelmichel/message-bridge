import { Observable, Subject } from 'rxjs';
import { Observer } from 'rxjs/internal/types';
import { IframeManager } from './iframe-manager';
import { WindowManager } from "./window-manager";

type MessageBridgeConfig = {
    bridgeIdentifier?: string;
    debug?: boolean;
};

type MessageRequest = {
    uid: string;
    type: 'request';
    action: string;
    payload?: any;
    mode?: 'promise' | 'observable';
};

type MessageResponse<T = any> = {
    uid: string;
    type: 'response';
    payload: T;
    done?: boolean;
};

export class MessageBridge {
    private static responseListeners = new Map<string, (payload: any) => void>();
    private static messageSubject = new Subject<MessageEvent>();
    private static debug = false;
    private static identifier = 'message-bridge';

    static init(config: MessageBridgeConfig = {}): void {
        if (typeof window !== 'undefined') {
            if ((window as any).__messageBridgeInitialized) return;
            (window as any).__messageBridgeInitialized = true;

            const {bridgeIdentifier = 'message-bridge', debug = false} = config;

            MessageBridge.identifier = window.location === top?.location
                ? `parent-${bridgeIdentifier}` : `child-${bridgeIdentifier}`;
            MessageBridge.debug = debug;

            window.addEventListener('message', (event) => {
                if (typeof event.data !== 'string') return;

                try {
                    const message = JSON.parse(event.data);
                    MessageBridge.log('Received message', message);

                    if (message.type === 'response' && MessageBridge.responseListeners.has(message.uid)) {
                        const listener = MessageBridge.responseListeners.get(message.uid);
                        listener?.(message.payload);
                        if (message.done !== false) {
                            MessageBridge.responseListeners.delete(message.uid);
                        }
                    } else if (message.type === 'request') {
                        MessageBridge.messageSubject.next(event);
                    } else if (message.type === 'handshake-request') {
                        const iframeId = (window as any).name || 'unknown-iframe';
                        const sourceWindow = event.source as Window;
                        sourceWindow.postMessage(JSON.stringify({type: 'handshake', iframeId}), '*');
                    }
                } catch {
                    MessageBridge.log('Invalid JSON', event.data);
                }
            });
        }
    }

    static async connect(targets: string | HTMLIFrameElement | Window | (string | HTMLIFrameElement | Window)[], timeout = 10000): Promise<void> {
        const allTargets = Array.isArray(targets) ? targets : [targets];

        MessageBridge.log('connect', 'Attempting to connect to targets', allTargets);

        await Promise.all(
            allTargets.map((target) => {
                if (typeof target === 'string' || target instanceof HTMLIFrameElement) {
                    return IframeManager.connect(target, timeout);
                } else if (typeof Window !== 'undefined' && target instanceof Window && !target.closed) {
                    return WindowManager.connect(target, timeout);
                } else {
                    return Promise.reject(new Error('Invalid target type'));
                }
            })
        );

        MessageBridge.log('connect', 'All targets connected successfully');
    }

    static toChild(iframeOrId: string | HTMLIFrameElement) {
        const iframeId = typeof iframeOrId === 'string' ? iframeOrId : iframeOrId.id;
        const connectFn = () => IframeManager.connect(iframeOrId);
        const postMessageFn = (msg: string) => IframeManager.postMessage(iframeId, msg);
        return MessageBridge.createBridge(postMessageFn, connectFn);
    }

    static toParent(targetWindow: Window = window.parent) {
        const postMessageFn = (msg: string) => targetWindow.postMessage(msg, '*');
        return MessageBridge.createBridge(postMessageFn);
    }

    static toWindow(targetWindow: Window) {
        const connectFn = () => WindowManager.connect(targetWindow);
        const postMessageFn = (msg: string) => targetWindow.postMessage(msg, '*');
        return MessageBridge.createBridge(postMessageFn, connectFn);
    }

    private static createBridge(postMessageFn: (msg: string) => void, connectFn?: () => Promise<void>) {
        return {
            async sendRequest<T = unknown>(action: string, payload?: any, timeout = 10000): Promise<T> {
                const uid = Math.random().toString(36).slice(2);
                const message: MessageRequest = { uid, type: 'request', mode: 'promise', action, payload };
                MessageBridge.log('sendRequest', message);

                if (connectFn) await connectFn();

                return new Promise<T>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        MessageBridge.responseListeners.delete(uid);
                        reject(new Error(`Timeout after ${timeout}ms`));
                    }, timeout);

                    MessageBridge.responseListeners.set(uid, (data) => {
                        clearTimeout(timer);
                        resolve(data);
                    });

                    postMessageFn(JSON.stringify(message));
                });
            },

            sendObservable<T = unknown>(action: string, payload?: any): Observable<T> {
                const uid = Math.random().toString(36).slice(2);
                const message: MessageRequest = {
                    uid,
                    type: 'request',
                    mode: 'observable',
                    action,
                    payload,
                };

                MessageBridge.log('sendObservable', message);

                return new Observable<T>((observer: Observer<T>)  => {
                    MessageBridge.responseListeners.set(uid, (data) => {
                        if (data?.done) {
                            observer.complete();
                            MessageBridge.responseListeners.delete(uid);
                        } else {
                            observer.next(data);
                        }
                    });

                    const doPost = () => postMessageFn(JSON.stringify(message));
                    connectFn ? connectFn().then(doPost).catch(observer.error) : doPost();

                    return () => MessageBridge.responseListeners.delete(uid);
                });
            },

            listenFor<T = any>(action: string): Observable<{ request: MessageRequest; source: Window }> {
                return new Observable((observer: Observer<{ request: MessageRequest; source: Window }>) => {
                    const sub = MessageBridge.onMessages().subscribe((event) => {
                        try {
                            const message: MessageRequest = JSON.parse(event.data);
                            if (message.type === 'request' && message.action === action) {
                                observer.next({ request: message, source: event.source as Window });
                            }
                        } catch { /* ignore */ }
                    });
                    return () => sub.unsubscribe();
                });
            },

            reactTo<T = any, R = any>(
                action: string,
                handler: (payload: T) => R | Promise<R>
                ): void {
                    const sub = MessageBridge.onMessages().subscribe((event) => {
                    try {
                        const message: MessageRequest = JSON.parse(event.data);
                        if (message.type === 'request' && message.action === action) {
                            const result = handler(message.payload);
                            Promise.resolve(result).then((resolved) => {
                                const response: MessageResponse<R> = {
                                    uid: message.uid,
                                    type: 'response',
                                    payload: resolved,
                                    done: true,
                                };
                                postMessageFn(JSON.stringify(response));
                            });
                            sub.unsubscribe(); // auto-cleanup after one call
                        }
                    } catch {
                        // ignore
                    }
                });
            },

            respond<T>(uid: string, payload: T, done = true) {
                const response: MessageResponse<T> = { uid, type: 'response', payload, done };
                postMessageFn(JSON.stringify(response));
            },

            onResponse(): Observable<MessageEvent> {
                return MessageBridge.onMessages();
            }
        };
    }

    static broadcastRequest<T = any>(action: string, payload?: any, timeout = 10000): Promise<Record<string, T>> {
        const uid = Math.random().toString(36).slice(2);
        const message: MessageRequest = { uid, type: 'request', mode: 'promise', action, payload };

        const iframeIds = IframeManager.getAllIframeIds();
        const responses: Record<string, T> = {};
        MessageBridge.log('broadcastRequest', 'message', message);
        return new Promise((resolve, reject) => {
            let remaining = iframeIds.length;
            const timer = setTimeout(() => {
                MessageBridge.responseListeners.delete(uid);
                reject(new Error(`Timeout after ${timeout}ms, responses: ${JSON.stringify(responses)}`));
            }, timeout);

            iframeIds.forEach((id) => {
                const localUid = `${uid}_${id}`;
                const localMessage = { ...message, uid: localUid };

                MessageBridge.responseListeners.set(localUid, (data) => {
                    responses[id] = data;
                    remaining -= 1;

                    if (remaining === 0) {
                        clearTimeout(timer);
                        resolve(responses);
                    }
                });

                IframeManager.postMessage(id, JSON.stringify(localMessage));
            });
        });
    }

    static broadcastObservable<T = any>(action: string, payload?: any): Observable<{ iframeId: string; value: T }> {
        const uid = Math.random().toString(36).slice(2);
        const message: MessageRequest = { uid, type: 'request', mode: 'observable', action, payload };
        const iframeIds = IframeManager.getAllIframeIds();
        MessageBridge.log('Parent broadcastObservable', JSON.stringify(message));
        return new Observable((observer: Observer<{ iframeId: string; value: T }>) => {
            iframeIds.forEach((id) => {
                const localUid = `${uid}_${id}`;
                const localMessage = { ...message, uid: localUid };

                MessageBridge.responseListeners.set(localUid, (data) => {
                    if (data?.done) {
                        MessageBridge.responseListeners.delete(localUid);
                    } else {
                        observer.next({ iframeId: id, value: data });
                    }
                });

                IframeManager.postMessage(id, JSON.stringify(localMessage));
            });

            return () => {
                iframeIds.forEach((id) => {
                    MessageBridge.responseListeners.delete(`${uid}_${id}`);
                });
            };
        });
    }

    private static onMessages(): Observable<MessageEvent> {
        return this.messageSubject.asObservable();
    }

    private static log(context: string, ...args: any[]) {
        if (!this.debug) return;
        console.log(`[MessageBridge - ${this.identifier}] ${context}:`, ...args);
    }
}