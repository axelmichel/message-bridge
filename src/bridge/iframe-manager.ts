export class IframeManager {
    private static iframes = new Map<string, HTMLIFrameElement>();
    private static readyPromises = new Map<string, Promise<void>>();

    static connect(iframeOrId: string | HTMLIFrameElement, timeout = 5000): Promise<void> {
        const iframeId =
            typeof iframeOrId === 'string' ? iframeOrId : iframeOrId.id;

        console.log('connecting to iframe:', iframeId);

        const existingReady = this.readyPromises.get(iframeId);
        if (existingReady) {
            console.log('already connected to iframe:', iframeId);
            return existingReady
        }

        const start = Date.now();

        const readyPromise = new Promise<void>((resolve, reject) => {
            const tryRegister = () => {
                const iframe =
                    typeof iframeOrId === 'string'
                        ? document.getElementById(iframeOrId) as HTMLIFrameElement | null
                        : iframeOrId;

                if (!iframe) {
                    if (Date.now() - start >= timeout) {
                        return reject(new Error(`Iframe with id '${iframeId}' not found after ${timeout}ms`));
                    }
                    return setTimeout(tryRegister, 100);
                }

                const contentWindow = iframe.contentWindow;
                if (!contentWindow) {
                    if (Date.now() - start >= timeout) {
                        return reject(new Error(`Iframe '${iframeId}' did not become ready after ${timeout}ms`));
                    }
                    return setTimeout(tryRegister, 100);
                } else {
                    console.log(`[iframe] Found iframe '${iframeId}' with contentWindow`);
                }

                const onMessage = (event: MessageEvent) => {
                    try {
                        const msg = JSON.parse(event.data);
                        console.log('[iframe] Received message:', msg);
                        if (msg.type === 'handshake' && msg.iframeId === iframeId) {
                            clearTimeout(timer);
                            console.log(`[iframe] Handshake successful for iframe '${iframeId}'`);
                            window.removeEventListener('message', onMessage);
                            this.iframes.set(iframeId, iframe);
                            this.readyPromises.set(iframeId, Promise.resolve());
                            resolve();
                        }
                    } catch {
                        // ignore
                    }
                };

                window.addEventListener('message', onMessage);

                const timer = setTimeout(() => {
                    window.removeEventListener('message', onMessage);
                    reject(new Error(`Handshake timeout for iframe '${iframeId}'`));
                }, timeout - (Date.now() - start));

                console.log('posting handshake request to iframe:', iframeId);

                // Send handshake request
                contentWindow.postMessage(
                    JSON.stringify({ type: 'handshake-request' }),
                    '*'
                );
            };

            tryRegister();
        });

        return readyPromise;
    }

    static getAllIframeIds(): string[] {
        return Array.from(this.iframes.keys());
    }

    static postMessage(id: string, message: any) {
        const iframe = this.iframes.get(id);
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(message, '*');
        }
    }
}