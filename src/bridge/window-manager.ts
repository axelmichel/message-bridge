export class WindowManager {
    private static readyWindows = new WeakMap<Window, Promise<void>>();

    static connect(targetWindow: Window, timeout = 10000): Promise<void> {
        if (!targetWindow || typeof targetWindow.postMessage !== 'function' || targetWindow.closed) {
            return Promise.reject(new Error('Invalid window reference'));
        }

        const existing = this.readyWindows.get(targetWindow);
        if (existing) {
            return existing;
        }

        const start = Date.now();
        const handshakeId = Math.random().toString(36).slice(2);

        const readyPromise = new Promise<void>((resolve, reject) => {
            const pollHandshake = () => {
                const elapsed = Date.now() - start;
                if (elapsed >= timeout || targetWindow.closed) {
                    return reject(new Error('Popup window did not respond to handshake in time'));
                }

                const onMessage = (event: MessageEvent) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'handshake' && msg.iframeId === handshakeId) {
                            clearTimeout(timeoutTimer);
                            window.removeEventListener('message', onMessage);
                            resolve();
                        }
                    } catch {
                        // ignore
                    }
                };

                window.addEventListener('message', onMessage);

                const timeoutTimer = setTimeout(() => {
                    window.removeEventListener('message', onMessage);
                    pollHandshake();
                }, 200);

                try {
                    targetWindow.postMessage(JSON.stringify({ type: 'handshake-request', iframeId: handshakeId }), '*');
                } catch {
                    // targetWindow might not be ready, retry
                }
            };

            pollHandshake();
        });

        this.readyWindows.set(targetWindow, readyPromise);
        return readyPromise;
    }
}
