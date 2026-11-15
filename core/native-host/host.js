const net = require('net');

const PIPE_NAME = '\\\\.\\pipe\\zdm_native_host';
let socket = null;
let inputBuffer = Buffer.alloc(0);
let connecting = false;

function connect() {
  if (socket || connecting) return;
  connecting = true;
  const s = net.createConnection(PIPE_NAME);
  s.on('connect', () => {
    connecting = false;
    socket = s;
    s.write(JSON.stringify({ type: 'hello' }) + '\n');
  });
  s.on('data', (data) => {
    const resLines = data.toString().split('\n');
    for (const res of resLines) {
      if (!res.trim()) continue;
      const resMsg = Buffer.from(res, 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(resMsg.length, 0);
      process.stdout.write(lenBuf);
      process.stdout.write(resMsg);
    }
  });
  s.on('close', () => {
    socket = null;
    connecting = false;
    setTimeout(connect, 2000);
  });
  s.on('error', () => {
    connecting = false;
    socket = null;
  });
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length >= 4 + msgLen) {
      const msgBuf = inputBuffer.slice(4, 4 + msgLen);
      inputBuffer = inputBuffer.slice(4 + msgLen);
      const msgStr = msgBuf.toString('utf8');
      if (!socket) connect();
      if (socket) {
        try { socket.write(msgStr + '\n'); } catch { /* reconnecting */ }
      }
    } else {
      break;
    }
  }
});

connect();
