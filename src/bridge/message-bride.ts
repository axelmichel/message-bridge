import { Observable, Subject } from 'rxjs';
import { IframeManager } from './iframe-manager';

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
    private static debug = true;
    private static identifier = 'message-bridge';

    static init(instance:string = 'message-bridge'): void {
        if ((window as any).__messageBridgeInitialized) return;
        (window as any).__messageBridgeInitialized = true;
        MessageBridge.identifier = instance;
        console.log(`[MessageBridge] Initialized with instance: ${instance}`, window.name);

        window.addEventListener('message', (event) => {
            console.log('this is the event', event);
            if (typeof event.data !== 'string') return;

            try {
                const message = JSON.parse(event.data);
                MessageBridge.log('Message Event', `Received message: ${event.data}`);
                if (message.type === 'response' && MessageBridge.responseListeners.has(message.uid)) {
                    const listener = MessageBridge.responseListeners.get(message.uid);
                    listener?.(message.payload);
                    if (message.done !== false) {
                        MessageBridge.responseListeners.delete(message.uid);
                    }
                } else if (message.type === 'request') {
                    MessageBridge.messageSubject.next(event);
                } else if (message.type === 'handshake-request') {
                    console.log('Received handshake-request');
                    const iframeId = (window as any).name || 'unknown-iframe';
                    const sourceWindow = event.source as Window;
                    sourceWindow.postMessage(JSON.stringify({ type: 'handshake', iframeId }), '*');
                }
            } catch {
                MessageBridge.log('Message Event', `Invalid JSON: ${event.data}`);
                // Ignore invalid JSON
            }
        });
    }

    private static onMessages(): Observable<MessageEvent> {
        return this.messageSubject.asObservable();
    }

    static child(iframeOrId: string | HTMLIFrameElement) {
        const iframeId = typeof iframeOrId === 'string' ? iframeOrId : iframeOrId.id;
        console.log(iframeId);

        return {
            async sendRequest<T = unknown>(action: string, payload?: any, timeout = 10000): Promise<T> {
                const uid = Math.random().toString(36).slice(2);
                const message: MessageRequest = { uid, type: 'request', action, payload, mode: 'promise' };
                MessageBridge.log('Child sendRequest', JSON.stringify(message));

                await IframeManager.connect(iframeOrId);

                return new Promise<T>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        MessageBridge.responseListeners.delete(uid);
                        reject(new Error(`Timeout after ${timeout}ms`));
                    }, timeout);

                    MessageBridge.responseListeners.set(uid, (data) => {
                        clearTimeout(timer);
                        resolve(data);
                    });

                    IframeManager.postMessage(iframeId, JSON.stringify(message));
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
                MessageBridge.log('Child sendObservable', JSON.stringify(message));
                return new Observable<T>((observer) => {
                    MessageBridge.responseListeners.set(uid, (data) => {
                        if (data?.done) {
                            observer.complete();
                            MessageBridge.responseListeners.delete(uid);
                        } else {
                            observer.next(data);
                        }
                    });

                    IframeManager.connect(iframeOrId)
                        .then(() => IframeManager.postMessage(iframeId, JSON.stringify(message)))
                        .catch((e) => observer.error(e));

                    return () => {
                        MessageBridge.responseListeners.delete(uid);
                    };
                });
            },

            listenFor<T = any>(action: string): Observable<{ request: MessageRequest; source: Window }> {
                MessageBridge.log('Child listenFor', action);
                return new Observable((observer) => {
                    const sub = MessageBridge.onMessages().subscribe((event) => {
                        try {
                            const message: MessageRequest = JSON.parse(event.data);
                            if (message.type === 'request' && message.action === action) {
                                observer.next({ request: message, source: event.source as Window });
                            }
                        } catch {
                            // Ignore
                        }
                    });

                    return () => sub.unsubscribe();
                });
            },

            respond<T>(uid: string, payload: T, done = true) {
                const response: MessageResponse<T> = { uid, type: 'response', payload, done };
                MessageBridge.log('Child respond', JSON.stringify(response));
                window.parent.postMessage(JSON.stringify(response), '*');
            },

            onResponse(): Observable<MessageEvent> {
                return MessageBridge.onMessages();
            },
        };
    }

    static broadcastRequest<T = any>(action: string, payload?: any, timeout = 10000): Promise<Record<string, T>> {
        const uid = Math.random().toString(36).slice(2);
        const message: MessageRequest = { uid, type: 'request', mode: 'promise', action, payload };

        const iframeIds = IframeManager.getAllIframeIds();
        const responses: Record<string, T> = {};
        MessageBridge.log('Parent broadcastRequest', JSON.stringify(message));
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
        return new Observable((observer) => {
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

    static parent() {
        return {
            sendRequest<T = unknown>(action: string, payload?: any, timeout = 10000): Promise<T> {
                const uid = Math.random().toString(36).slice(2);
                const message: MessageRequest = { uid, type: 'request', mode: 'promise', action, payload };
                MessageBridge.log('Parent sendRequest', JSON.stringify(message));
                return new Promise<T>((resolve, reject) => {
                    const timer = setTimeout(() => {
                        MessageBridge.responseListeners.delete(uid);
                        reject(new Error('Timeout'));
                    }, timeout);

                    MessageBridge.responseListeners.set(uid, (data) => {
                        clearTimeout(timer);
                        resolve(data);
                    });

                    window.parent.postMessage(JSON.stringify(message), '*');
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
                MessageBridge.log('Parent sendObservable', JSON.stringify(message));
                return new Observable<T>((observer) => {
                    MessageBridge.responseListeners.set(uid, (data) => {
                        if (data?.done) {
                            observer.complete();
                            MessageBridge.responseListeners.delete(uid);
                        } else {
                            observer.next(data);
                        }
                    });

                    window.parent.postMessage(JSON.stringify(message), '*');

                    return () => {
                        MessageBridge.responseListeners.delete(uid);
                    };
                });
            },

            listenFor<T = any>(action: string): Observable<{ request: MessageRequest; source: Window }> {
                MessageBridge.log('Parent listenFor', action);
                return new Observable((observer) => {
                    const sub = MessageBridge.onMessages().subscribe((event) => {
                        try {
                            const message: MessageRequest = JSON.parse(event.data);
                            if (message.type === 'request' && message.action === action) {
                                observer.next({ request: message, source: event.source as Window });
                            }
                        } catch {
                            // Ignore
                        }
                    });

                    return () => sub.unsubscribe();
                });
            },

            respond<T>(uid: string, payload: T, done = true) {
                const response: MessageResponse<T> = { uid, type: 'response', payload, done };
                MessageBridge.log('Parent respond', JSON.stringify(response));
                window?.top?.postMessage(JSON.stringify(response), '*');
            },
        };
    }

    private static log(method:string, message: string, ...args: any[]) {
        if (!MessageBridge.debug) return;
        console.log(`[MessageBridge ${MessageBridge.identifier} - ${method}]: ${message}`, ...args);
    }
}