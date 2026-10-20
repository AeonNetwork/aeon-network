// One upstream poll, fanned out to every connected browser over SSE.

const clients = new Set();

export function sseHandler(onConnect) {
  return (req, res) => {
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 4000\n\n');
    const client = { res };
    clients.add(client);
    onConnect?.((event, data) => send(client, event, data));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(client);
    });
  };
}

function send(client, event, data) {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(event, data) {
  for (const c of clients) send(c, event, data);
}

export const clientCount = () => clients.size;
