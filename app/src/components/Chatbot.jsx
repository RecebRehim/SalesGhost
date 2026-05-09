import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearAllNotifications, getNotifications } from '../utils/database';
import { isRemoteSyncConfigured, pullRemoteAndMerge } from '../utils/remoteSync';

const isN8nMessage = (item) =>
  item?.channel === 'n8n' || item?.metadata?.source === 'n8n';

export function Chatbot({ onRefresh }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(() =>
    getNotifications().filter(isN8nMessage),
  );
  const bottomRef = useRef(null);
  const seenN8nIdsRef = useRef(new Set());
  const didHydrateRef = useRef(false);

  const refresh = useCallback(() => {
    setItems(getNotifications().filter(isN8nMessage));
    onRefresh?.();
  }, [onRefresh]);

  useEffect(() => {
    window.addEventListener('salesghost-sync', refresh);
    return () => window.removeEventListener('salesghost-sync', refresh);
  }, [refresh]);

  useEffect(() => {
    const onClear = () => {
      seenN8nIdsRef.current = new Set();
      didHydrateRef.current = false;
      refresh();
    };
    window.addEventListener('salesghost-notifications-cleared', onClear);
    return () => window.removeEventListener('salesghost-notifications-cleared', onClear);
  }, [refresh]);

  /** Auto-open when a new n8n message id appears (skip first hydration so we don't open on page load). */
  useEffect(() => {
    if (!didHydrateRef.current) {
      items.forEach((msg) => seenN8nIdsRef.current.add(msg.id));
      didHydrateRef.current = true;
      return;
    }
    let hasNew = false;
    for (const msg of items) {
      if (!seenN8nIdsRef.current.has(msg.id)) {
        seenN8nIdsRef.current.add(msg.id);
        hasNew = true;
      }
    }
    if (hasNew) setOpen(true);
  }, [items]);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [open, items.length]);

  const sortedForChat = useMemo(() => [...items].reverse(), [items]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {open && (
        <div className="pointer-events-auto flex max-h-[min(420px,70vh)] w-[min(100vw-2rem,380px)] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b bg-brand-600 px-4 py-3 text-white">
            <div>
              <p className="font-bold">SalesGhost Assistant</p>
              <p className="text-xs text-brand-100">Messages from your automation (n8n)</p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-white/10 px-2 py-1 text-sm hover:bg-white/20"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {sortedForChat.length === 0 ? (
              <p className="text-center text-sm text-slate-500">
                No messages yet. When n8n POSTs to <code className="rounded bg-slate-100 px-1">/api/chat-message</code>, they appear here.
              </p>
            ) : (
              sortedForChat.map((msg) => (
                <div
                  key={msg.id}
                  className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm shadow-sm"
                >
                  <p className="font-semibold text-slate-800">{msg.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{msg.message}</p>
                  <p className="mt-2 text-xs text-slate-400">
                    {new Date(msg.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          <div className="border-t bg-slate-50 px-3 py-2">
            <button
              type="button"
              className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              onClick={() => {
                if (!window.confirm('Delete all notifications and chat messages?')) return;
                clearAllNotifications();
                setOpen(false);
                refresh();
              }}
            >
              Clear all messages & notifications
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-lg transition hover:bg-brand-700"
        aria-label="Open chat"
        onClick={() => {
          setOpen((o) => !o);
          refresh();
          if (isRemoteSyncConfigured()) pullRemoteAndMerge().then(refresh);
        }}
      >
        💬
      </button>
    </div>
  );
}
