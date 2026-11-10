// A local matchmaking (signalling) server for browser tests, so they never depend on the public one.
import { PeerServer } from 'peer';

PeerServer({ host: '127.0.0.1', port: 9000, path: '/' });
console.log('signal server on :9000');
