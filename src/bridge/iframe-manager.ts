export class IframeManager {
    private static iframes = new Map<string, HTMLIFrameElement>();
    private static readyPromises = new Map<string, Promise<void>>();

    static connect(iframeOrId: string | HTMLIFrameElement, timeout = 10000): Promise<void> {
        const iframeId = typeof iframeOrId === 'string' ? iframeOrId : iframeOrId.id;

        const existingReady = this.readyPromises.get(iframeId);
        if (existingReady) {
            return existingReady;
        }

        const readyPromise = new Promise<void>((resolve, reject) => {
            const iframe = typeof iframeOrId === 'string'
                ? document.getElementById(iframeOrId) as HTMLIFrameElement | null
                : iframeOrId;

            if (!iframe) {
                return reject(new Error(`Iframe '${iframeId}' not found`));
            }

            const contentWindow = () => iframe?.contentWindow;

            const onMessage = (event: MessageEvent) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'handshake' && msg.iframeId === iframeId) {
                        if (retryInterval) clearInterval(retryInterval);
                        if (timer) clearTimeout(timer);
                        window.removeEventListener('message', onMessage);
                        this.iframes.set(iframeId, iframe!);
                        this.readyPromises.set(iframeId, Promise.resolve());
                        resolve();
                    }
                } catch {
                    // ignore
                }
            };

            window.addEventListener('message', onMessage);

            const retryInterval = setInterval(() => {
                if (contentWindow()) {
                    contentWindow()?.postMessage(JSON.stringify({ type: 'handshake-request' }), '*');
                }
            }, 200);

            const timer = setTimeout(() => {
                clearInterval(retryInterval);
                window.removeEventListener('message', onMessage);
                reject(new Error(`Handshake timeout for iframe '${iframeId}'`));
            }, timeout);
        });

        this.readyPromises.set(iframeId, readyPromise);
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