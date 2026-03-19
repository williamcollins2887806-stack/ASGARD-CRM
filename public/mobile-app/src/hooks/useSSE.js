import { useEffect, useRef } from 'react';
import { api } from '@/api/client';

/**
 * useSSE — SSE-подключение к /api/sse/stream
 * Слушает chat:new_message, chat:message_edited, chat:message_deleted,
 * chat:typing, chat:reaction
 */
export function useSSE(onEvent) {
  const esRef = useRef(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const token = api.getToken();
    if (!token) return;

    let es = new EventSource(`/api/sse/stream?token=${token}`);
    esRef.current = es;

    const events = [
      'chat:new_message',
      'chat:message_edited',
      'chat:message_deleted',
      'chat:typing',
      'chat:reaction',
    ];

    const handler = (eventName) => (e) => {
      try {
        const key = eventName.replace('chat:', '');
        onEventRef.current(key, JSON.parse(e.data));
      } catch {}
    };

    const handlers = {};
    events.forEach((ev) => {
      handlers[ev] = handler(ev);
      es.addEventListener(ev, handlers[ev]);
    });

    es.onerror = () => {
      es.close();
      // Reconnect after 3s
      setTimeout(() => {
        if (!esRef.current) return;
        const t = api.getToken();
        if (!t) return;
        es = new EventSource(`/api/sse/stream?token=${t}`);
        esRef.current = es;
        events.forEach((ev) => es.addEventListener(ev, handlers[ev]));
      }, 3000);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return esRef;
}
